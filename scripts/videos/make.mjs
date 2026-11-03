// Make one explainer video:  node scripts/videos/make.mjs <name> [--no-record]
//   1. narration for every scene (local VoiceStudio voice, same voice + settings for all videos)
//   2. record the scenes in a headless browser against the LOCAL demo app (http://127.0.0.1:3418)
//   3. build the MP4 with voice + burned-in captions (+ .srt) in ~/Videos/pearl-crm-videos
// Needs: local Supabase with scripts/videos/demo-data.sql loaded, and the app started with
// scripts/videos/web-env.sh (see scripts/videos/README.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, newPage, ROOT } from "./lib/browser.mjs";
import { Director } from "./lib/director.mjs";
import { build } from "./lib/build.mjs";
import { ensureEmulator, Phone } from "./lib/phone.mjs";

const name = process.argv[2];
if (!name) throw new Error("usage: make.mjs <script name>");
const script = (await import(path.join(ROOT, "scripts/videos/scripts", `${name}.mjs`))).default;
const work = path.join(os.homedir(), "Videos/pearl-crm-videos/_work", name);
const audioDir = path.join(os.homedir(), "Videos/pearl-crm-videos/_voice");
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });

// 1. Narration (only new or changed lines are spoken again).
const scenes = script.scenes.filter((s) => s.say);
const linesFile = path.join(work, "lines.json");
fs.writeFileSync(linesFile, JSON.stringify(scenes.map((s) => ({ id: `${name}-${s.id}`, text: s.say }))));
const py = path.join(os.homedir(), ".config/VoiceStudio/runtime/project/.venv/bin/python");
execFileSync(py, [path.join(ROOT, "scripts/videos/tts.py"), linesFile, audioDir], {
  cwd: path.join(os.homedir(), ".config/VoiceStudio/runtime/project"),
  stdio: ["ignore", "inherit", "ignore"],
});
const durations = Object.fromEntries(
  Object.entries(JSON.parse(fs.readFileSync(path.join(audioDir, "durations.json"), "utf8")))
    .filter(([k]) => k.startsWith(`${name}-`))
    .map(([k, v]) => [k.slice(name.length + 1), v]),
);
const voiced = Object.fromEntries(Object.entries(durations).map(([k, v]) => [`${name}-${k}`, v]));

// 2. Record.
if (!process.argv.includes("--no-record")) {
  // Every video starts from the same fresh demo data (local database only).
  if (!process.argv.includes("--keep-data")) execFileSync(path.join(ROOT, "scripts/videos/reset-demo.sh"), { stdio: "inherit" });
  fs.rmSync(path.join(work, "frames"), { recursive: true, force: true });
  const browser = await chromium.launch({ channel: "chromium" });
  const page = await newPage(browser, script.page ?? {});
  try {
    if (script.setup) await script.setup(page);
    const d = new Director(page, work, voiced);
    fs.rmSync(path.join(work, "clips"), { recursive: true, force: true });
    if (script.scenes.some((s) => s.phone)) {
      await ensureEmulator();
      d.phone = new Phone();
      if (script.phoneSetup) await script.phoneSetup(d.phone);
    }
    await d.start();
    for (const s of script.scenes) {
      if (s.chapter) await d.chapter(s.chapter, s.description);
      else if (s.offscreen) await d.offscreen(s.offscreen);
      else if (s.phone) await d.phoneScene(`${name}-${s.id}`, s.say, s.run, s.phone === true ? "" : s.phone);
      else await d.scene(`${name}-${s.id}`, s.say, s.run);
    }
    await d.stop();
  } catch (e) {
    await page.screenshot({ path: path.join(work, "failed.png") }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
}

// 3. Build.
const output = path.join(os.homedir(), "Videos/pearl-crm-videos", script.file);
const r = build({ outDir: work, audioDir, durations: voiced, output, title: script.title });
console.log(`${output}  ${Math.floor(r.seconds / 60)} min ${Math.round(r.seconds % 60)} s, ${r.captions} captions`);
