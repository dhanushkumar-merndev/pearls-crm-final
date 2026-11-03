// Records one explainer video: every scene = one narration line + the clicks that go with it.
// Frames come from Playwright's screencast (headless, 1920 × 1080 JPEG), with its animated pointer.
// Each scene lasts as long as the longer of its narration and its clicks, so voice and picture stay
// together; build.mjs then lays the voice, captions and frames into the final MP4.
import fs from "node:fs";
import path from "node:path";

export const SIZE = { width: 1920, height: 1080 };

export class Director {
  constructor(page, outDir, durations) {
    this.page = page;
    this.outDir = outDir;
    this.durations = durations; // { id: { seconds } } from tts.py
    this.frames = []; // { file, t }
    this.scenes = []; // { id, say, start, end, phone? }
    this.clips = []; // phone recordings: { file, start, end, recStart, label }
    this.phone = null; // a Phone (lib/phone.mjs) when the video has phone scenes
    this.t0 = 0;
    this.n = 0;
    this.holding = false;
  }

  /**
   * Off camera: `run` happens with the video's clock stopped and no frames kept (e.g. driving the
   * phone's GPS for a minute between two phone scenes). The video carries on as if no time passed.
   */
  async offscreen(run) {
    this.holding = true;
    const t = Date.now();
    try {
      await run(this.phone, this.page);
    } finally {
      this.t0 += Date.now() - t;
      this.holding = false;
    }
    process.stdout.write(`  (off camera ${((Date.now() - t) / 1000).toFixed(1)} s)\n`);
  }

  now() {
    return (Date.now() - this.t0) / 1000;
  }

  async start() {
    fs.mkdirSync(path.join(this.outDir, "frames"), { recursive: true });
    this.t0 = Date.now();
    await this.page.screencast.start({
      size: SIZE,
      quality: 92,
      onFrame: ({ data }) => {
        if (this.holding) return;
        const file = path.join(this.outDir, "frames", `${String(this.n++).padStart(6, "0")}.jpg`);
        fs.writeFileSync(file, data);
        this.frames.push({ file, t: this.now() });
      },
    });
    // The pointer glides between actions; the action titles Playwright would print stay hidden.
    await this.page.screencast.showActions({
      cursor: "pointer",
      duration: 700,
      style: {
        point: "width: 26px; height: 26px; border-radius: 50%; background: rgba(16,163,127,.35); border: 2px solid #10a37f",
        highlight: "outline: 2px solid rgba(16,163,127,.9); outline-offset: 2px; border-radius: 10px",
        title: "display: none",
      },
    });
  }

  /** One scene: narration starts now; `run` does the clicks meanwhile. */
  async scene(id, say, run) {
    const seconds = this.durations[id]?.seconds;
    if (seconds === undefined) throw new Error(`no narration for ${id}`);
    const start = this.now();
    if (run) await run(this.page);
    const end = Math.max(this.now(), start + seconds + 0.45);
    while (this.now() < end) await this.page.waitForTimeout(Math.min(200, (end - this.now()) * 1000 + 5));
    this.scenes.push({ id, say, start, end: this.now() });
    process.stdout.write(`  ${id} ${(this.now() - start).toFixed(1)} s (voice ${seconds.toFixed(1)} s)\n`);
  }

  /**
   * One scene on the phone: the emulator films itself (screenrecord) while `run(phone, page)` taps;
   * build.mjs puts the clip on the left of the frame and the caption beside it.
   */
  async phoneScene(id, say, run, label) {
    const seconds = this.durations[id]?.seconds;
    if (seconds === undefined) throw new Error(`no narration for ${id}`);
    const clipStart = this.now();
    await this.phone.startRecording();
    const recStart = this.now() + 0.2; // screenrecord's first frame, roughly
    await this.page.waitForTimeout(500);
    const start = this.now();
    if (run) await run(this.phone, this.page);
    const end = Math.max(this.now(), start + seconds + 0.45);
    while (this.now() < end) await this.page.waitForTimeout(Math.min(200, (end - this.now()) * 1000 + 5));
    const file = path.join(this.outDir, "clips", `${String(this.clips.length).padStart(2, "0")}-${id}.mp4`);
    await this.phone.stopRecording(file);
    this.clips.push({ file, start: clipStart, end: this.now(), recStart, label });
    this.scenes.push({ id, say, start, end: this.now(), phone: true });
    process.stdout.write(`  ${id} ${(this.now() - start).toFixed(1)} s (voice ${seconds.toFixed(1)} s) [phone]\n`);
  }

  /** A full-screen title card between parts (drawn as an overlay on the page). */
  async chapter(title, description, ms = 2600) {
    await this.page.screencast.showChapter(title, description ? { description, duration: ms } : { duration: ms });
    await this.page.waitForTimeout(ms + 150);
  }

  async stop() {
    await this.page.waitForTimeout(600);
    await this.page.screencast.stop();
    const end = this.now();
    fs.writeFileSync(path.join(this.outDir, "timeline.json"), JSON.stringify({ end, frames: this.frames, scenes: this.scenes, clips: this.clips }, null, 1));
  }
}

/** Typing a person would do (visible letter by letter). */
export async function type(locator, text, delay = 55) {
  await locator.click();
  // Replace what is there (prices and quantities are often pre-filled).
  if ((await locator.inputValue().catch(() => "")) !== "") await locator.fill("");
  await locator.pressSequentially(text, { delay });
}

/** Smoothly scroll the main area (or the window) by `dy` pixels. */
export async function scroll(page, dy, ms = 900) {
  await page.evaluate(
    async ({ dy, ms }) => {
      const el = document.querySelector("main") ?? document.scrollingElement;
      const scroller = el && el.scrollHeight > el.clientHeight ? el : document.scrollingElement;
      const from = scroller.scrollTop;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          scroller.scrollTop = from + dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
          k < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    },
    { dy, ms },
  );
}

export const pause = (page, ms) => page.waitForTimeout(ms);
