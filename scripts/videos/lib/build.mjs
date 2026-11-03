// Frames + narration + captions → one MP4 (1920 × 1080, 30 fps, H.264 + AAC) and a sidecar .srt.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FPS = 30;

/** Caption chunks: at most two short lines each, broken at punctuation, then at word boundaries. */
export function captionChunks(text, maxChars = 84) {
  const parts = text.split(/(?<=[.,;:!?—])\s+/);
  const chunks = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + " " + p).trim().length <= maxChars) cur = (cur + " " + p).trim();
    else {
      if (cur) chunks.push(cur);
      if (p.length <= maxChars) cur = p;
      else {
        // A long clause: split by words.
        let w = "";
        for (const word of p.split(" ")) {
          if ((w + " " + word).trim().length > maxChars) (chunks.push(w), (w = word));
          else w = (w + " " + word).trim();
        }
        cur = w;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Wrap one chunk to two balanced lines for the screen. */
function twoLines(s, max = 46) {
  if (s.length <= max) return s;
  const words = s.split(" ");
  let best = s, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const d = Math.abs(a.length - b.length);
    if (d < bestDiff) (bestDiff = d), (best = `${a}\\N${b}`);
  }
  return best;
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};
const srtTime = (t) => assTime(t).replace(/^(\d+):/, (_, h) => `${String(h).padStart(2, "0")}:`).replace(".", ",") + "0";

/** Phone frame height on the 1920 × 1080 canvas, and its left edge. */
const PHONE_H = 1016;
const PHONE_X = 300;

/**
 * The phone's own screen inside a recording: screenrecord letterboxes the emulator's tall screen into
 * 720 × 1280 with black bars at the sides, which must not count as phone.
 */
function phoneCrop(file) {
  const log = spawnSync("ffmpeg", ["-v", "info", "-t", "3", "-i", file, "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"], {
    encoding: "utf8",
  }).stderr;
  const m = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
  return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
}

/** Where the phone ends and the label + side captions start (the same for every clip of a video). */
function phoneLayout(clips) {
  const crop = clips.length ? phoneCrop(clips[0].file) : null;
  const width = crop ? Math.round((PHONE_H * crop.w) / crop.h / 2) * 2 : 572;
  return { crop, textX: PHONE_X + width + 8 + 90 };
}

/**
 * One emulator recording → JPEG frames on a 1920 × 1080 canvas at 30 fps, timed on the video's clock.
 * `c.recStart` is when the phone's recording began, `c.label` the small heading beside the phone.
 */
function phoneFrames(c, dir, layout) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const font = execFileSync("fc-match", ["-f", "%{file}", "Noto Sans:style=Medium"]).toString();
  const label = (c.label ?? "").replace(/[:\\']/g, "");
  const crop = layout.crop ? `crop=${layout.crop.w}:${layout.crop.h}:${layout.crop.x}:${layout.crop.y},` : "";
  const vf = [
    `color=c=0x181818:s=1920x1080:r=${FPS}[bg]`,
    `[0:v]fps=${FPS},${crop}scale=-2:${PHONE_H}:flags=lanczos,pad=iw+8:ih+8:4:4:color=0x4a4a4a[ph]`,
    `[bg][ph]overlay=x=${PHONE_X}:y=(H-h)/2:shortest=1,` +
      `drawtext=fontfile=${font}:text='${label}':fontcolor=0x10a37f:fontsize=34:x=${layout.textX}:y=120,format=yuvj420p[v]`,
  ].join(";");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", c.file, "-filter_complex", vf, "-map", "[v]", "-q:v", "3", path.join(dir, "%06d.jpg")]);
  return fs
    .readdirSync(dir)
    .sort()
    .map((f, i) => ({ file: path.join(dir, f), t: c.recStart + i / FPS }))
    .filter((f) => f.t < c.end);
}

export function build({ outDir, audioDir, durations, output, title }) {
  const tl = JSON.parse(fs.readFileSync(path.join(outDir, "timeline.json"), "utf8"));

  // 1. Frames → concat list with each frame's on-screen time. Phone clips (emulator screen recordings)
  //    replace the browser's frames while they play: the phone on the left, its captions to the right.
  const clips = tl.clips ?? [];
  const inClip = (t) => clips.some((c) => t >= c.start && t < c.end);
  const frames = tl.frames.filter((f) => !inClip(f.t));
  const layout = phoneLayout(clips);
  clips.forEach((c, k) => frames.push(...phoneFrames(c, path.join(outDir, "phone", String(k)), layout)));
  frames.sort((a, b) => a.t - b.t);
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : tl.end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(next - f.t, 0.001).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  const list = path.join(outDir, "frames.ffconcat");
  fs.writeFileSync(list, lines.join("\n"));

  // 2. Narration: each line placed at its scene's start.
  const ins = [], filters = [];
  tl.scenes.forEach((s, i) => {
    ins.push("-i", path.join(audioDir, `${s.id}.wav`));
    filters.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round((s.start + 0.15) * 1000)}:all=1[a${i}]`);
  });
  const mix = `${tl.scenes.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tl.scenes.length}:normalize=0,apad,atrim=0:${tl.end.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  const narration = path.join(outDir, "narration.wav");
  execFileSync("ffmpeg", ["-y", "-v", "error", ...ins, "-filter_complex", [...filters, mix].join(";"), "-map", "[out]", "-ar", "48000", narration]);

  // 3. Captions, timed across each line's spoken length (by characters).
  const events = [];
  for (const s of tl.scenes) {
    const spoken = durations[s.id].seconds;
    const chunks = captionChunks(s.say);
    const style = s.phone ? "Side" : "Cap";
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let t = s.start + 0.15;
    for (const c of chunks) {
      const d = (spoken * c.length) / total;
      events.push({ from: t, to: t + d + 0.05, text: c, style });
      t += d;
    }
  }
  const ass = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cap,Noto Sans,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H3C101010,0,0,0,0,100,100,0,0,3,14,0,2,160,160,46,1",
    // Beside the phone (left half is the phone): larger, left-aligned, vertically centred.
    `Style: Side,Noto Sans,50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,4,${layout.textX},120,0,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events.map((e) => `Dialogue: 0,${assTime(e.from)},${assTime(e.to)},${e.style},,0,0,0,,${twoLines(e.text, e.style === "Side" ? 34 : 46)}`),
  ].join("\n");
  const assFile = path.join(outDir, "captions.ass");
  fs.writeFileSync(assFile, ass);
  const srt = events.map((e, i) => `${i + 1}\n${srtTime(e.from)} --> ${srtTime(e.to)}\n${e.text}\n`).join("\n");
  fs.writeFileSync(output.replace(/\.mp4$/, ".srt"), srt);

  // 4. Picture + voice + burned-in captions.
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", narration,
    "-vf", `fps=${FPS},scale=1920:1080:flags=lanczos,format=yuv420p,subtitles=${assFile}`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
    "-metadata", `title=${title}`, "-movflags", "+faststart", "-t", tl.end.toFixed(3), output,
  ]);
  return { seconds: tl.end, captions: events.length };
}
