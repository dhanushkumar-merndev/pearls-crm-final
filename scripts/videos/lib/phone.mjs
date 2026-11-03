// The Android app on the emulator, for the videos: no window on screen (-no-window), driven with adb +
// uiautomator, filmed with the phone's own screenrecord. Talks to the LOCAL Supabase (10.0.2.2:54321)
// through a debug build made by scripts/videos/build-apk.sh.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SDK = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Android/Sdk");
const ADB = path.join(SDK, "platform-tools/adb");
const EMULATOR = path.join(SDK, "emulator/emulator");
export const AVD = process.env.VIDEO_AVD ?? "Pixel_10_Pro";
export const APP = "com.pearl.crm";
/** The recording emulator (the first one, port 5554): another emulator may run beside it. */
export const SERIAL = process.env.VIDEO_SERIAL ?? "emulator-5554";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function adb(...args) {
  return execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Start the emulator without a window (if it isn't running) and wait until it has booted. */
export async function ensureEmulator() {
  const running = execFileSync(ADB, ["devices"], { encoding: "utf8" }).includes(SERIAL);
  if (!running) {
    spawn(EMULATOR, ["-avd", AVD, "-port", SERIAL.replace("emulator-", ""), "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot-save", "-gpu", "swiftshader_indirect"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
  execFileSync(ADB, ["-s", SERIAL, "wait-for-device"], { timeout: 180_000 });
  for (let i = 0; i < 180; i++) {
    if (adb("shell", "getprop", "sys.boot_completed").trim() === "1") {
      // Signed file links point at 127.0.0.1:54321 (local storage): on the phone that is the PC.
      adb("reverse", "tcp:54321", "tcp:54321");
      return;
    }
    await sleep(1000);
  }
  throw new Error("emulator did not boot");
}

const attr = (s, name) => {
  const m = s.match(new RegExp(` ${name}="([^"]*)"`));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n") : "";
};

export class Phone {
  constructor() {
    this.rec = null;
  }

  /** Every node on screen: text, content description, resource id, clickable, bounds. */
  nodes() {
    let xml = "";
    for (let i = 0; i < 3 && !xml.includes("<hierarchy"); i++) {
      try {
        xml = adb("exec-out", "uiautomator", "dump", "/dev/tty");
      } catch {
        xml = "";
      }
    }
    return [...xml.matchAll(/<node [^>]*>/g)].map(([s]) => {
      const b = attr(s, "bounds").match(/\d+/g)?.map(Number) ?? [0, 0, 0, 0];
      return { text: attr(s, "text"), desc: attr(s, "content-desc"), id: attr(s, "resource-id"), clickable: attr(s, "clickable") === "true", focused: attr(s, "focused") === "true", edit: attr(s, "class").endsWith("EditText"), scrollable: attr(s, "scrollable") === "true", bounds: b };
    });
  }

  matches(n, what) {
    if (typeof what === "function") return what(n);
    const test = (v) => (what instanceof RegExp ? what.test(v) : v === what);
    return (n.text && test(n.text)) || (n.desc && test(n.desc)) || (n.id && typeof what === "string" && n.id.endsWith(`:id/${what}`)) || (n.id && n.id === what);
  }

  /** Wait for a node whose text or description matches; returns it. */
  async find(what, { timeout = 20_000, index = 0 } = {}) {
    const t0 = Date.now();
    for (;;) {
      const hits = this.nodes().filter((n) => this.matches(n, what) && n.bounds[2] > n.bounds[0]);
      if (hits.length > index) return hits[index];
      if (Date.now() - t0 > timeout) throw new Error(`phone: nothing matches ${what}`);
      await sleep(400);
    }
  }

  wait(ms) {
    return sleep(ms);
  }

  async has(what) {
    return this.nodes().some((n) => this.matches(n, what));
  }

  async tap(what, opts) {
    const n = await this.find(what, opts);
    const [x1, y1, x2, y2] = n.bounds;
    await this.tapXY((x1 + x2) / 2, (y1 + y2) / 2);
    return n;
  }

  async tapXY(x, y) {
    adb("shell", "input", "tap", String(Math.round(x)), String(Math.round(y)));
    await sleep(350);
  }

  /** Type like a person (a few letters at a time, so it shows on the recording). */
  async type(text) {
    // `adb shell input text` only types plain ASCII.
    if (/[^\x20-\x7e]/.test(text)) throw new Error(`phone: can't type non-ASCII text: ${text}`);
    for (const word of text.split(/(\s+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) adb("shell", "input", "keyevent", "62");
      else for (const part of word.match(/.{1,3}/g)) adb("shell", "input", "text", part.replace(/([\\'"`$&|;<>()*?#~!])/g, "\\$1"));
    }
    await sleep(300);
  }

  /** Empties the focused text box. */
  async clear(chars = 80) {
    adb("shell", "input", "keyevent", "123"); // to the end
    adb("shell", "input", "keyevent", ...Array(chars).fill("67"));
    await sleep(200);
  }

  /**
   * Taps a text box by its label and types into it. The keyboard slides the form, so the tap is
   * checked: the focused box must hold the label, else it taps again.
   */
  async fill(what, text) {
    const inside = (n, [x, y]) => x >= n.bounds[0] && x <= n.bounds[2] && y >= n.bounds[1] && y <= n.bounds[3];
    for (let i = 0; i < 4; i++) {
      // An open keyboard can cover the box (the tap would land on a key): close it first.
      if (this.hideKeyboard()) await sleep(600);
      await this.tap(what);
      await sleep(700);
      const all = this.nodes();
      const label = all.find((n) => this.matches(n, what));
      const focused = all.find((n) => n.edit && n.focused);
      if (label && focused && inside(focused, [(label.bounds[0] + label.bounds[2]) / 2, (label.bounds[1] + label.bounds[3]) / 2])) {
        await this.type(text);
        return;
      }
    }
    throw new Error(`phone: could not focus ${what}`);
  }

  async swipe(x1, y1, x2, y2, ms = 450) {
    adb("shell", "input", "swipe", ...[x1, y1, x2, y2, ms].map((v) => String(Math.round(v))));
    await sleep(500);
  }

  size() {
    const [w, h] = adb("shell", "wm", "size").match(/(\d+)x(\d+)\s*$/m).slice(1).map(Number);
    return { w, h };
  }

  /** Scroll the content up (dy > 0 shows what is further down). */
  async scroll(dy = 700) {
    const { w, h } = this.size();
    await this.swipe(w / 2, h * 0.7, w / 2, h * 0.7 - dy, 600);
  }

  /** Scroll down until `what` is on screen. */
  async scrollTo(what, tries = 8) {
    for (let i = 0; i < tries; i++) {
      if (await this.has(what)) return this.find(what);
      await this.scroll(600);
    }
    return this.find(what, { timeout: 1000 });
  }

  async back() {
    adb("shell", "input", "keyevent", "4");
    await sleep(600);
  }

  hideKeyboard() {
    if (!adb("shell", "dumpsys", "input_method").includes("mInputShown=true")) return false;
    adb("shell", "input", "keyevent", "4");
    return true;
  }

  /** Simulated phone network: the other side answers / hangs up an outgoing call. */
  gsm(cmd, number) {
    adb("emu", "gsm", cmd, number);
  }

  /** The phone's own GPS fix (for the BDM's day). */
  geo(lat, lng) {
    adb("emu", "geo", "fix", String(lng), String(lat));
  }

  /**
   * Drives along [[lat, lng], …]: a fix every `everyMs` and `stepM` metres apart, so the app's
   * route filter (≤ 150 km/h, ≥ 15 m moves) keeps every point. Returns the metres covered.
   */
  async drive(points, { stepM = 60, everyMs = 2000 } = {}) {
    const R = 6_371_000, rad = (d) => (d * Math.PI) / 180;
    const dist = ([a, b], [c, d]) => {
      const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(x));
    };
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const len = dist(a, b), n = Math.max(1, Math.round(len / stepM));
      for (let k = 1; k <= n; k++) {
        this.geo(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
        await sleep(everyMs);
      }
      total += len;
    }
    return total;
  }

  async startRecording() {
    adb("shell", "rm", "-f", "/sdcard/pearl-scene.mp4");
    this.rec = spawn(ADB, ["-s", SERIAL, "shell", "screenrecord", "--bit-rate", "16000000", "/sdcard/pearl-scene.mp4"], { stdio: "ignore" });
    await sleep(250);
  }

  async stopRecording(file) {
    adb("shell", "pkill", "-INT", "screenrecord");
    await new Promise((r) => (this.rec.exitCode !== null ? r() : this.rec.once("exit", r)));
    await sleep(700); // the phone finishes writing the file
    fs.mkdirSync(path.dirname(file), { recursive: true });
    adb("pull", "/sdcard/pearl-scene.mp4", file);
    this.rec = null;
  }
}

const PERMISSIONS = ["POST_NOTIFICATIONS", "READ_CALL_LOG", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "READ_PHONE_STATE", "RECORD_AUDIO"];
export const PIN = "2580";

/** Wipe the app (the demo database was just reset), allow everything, log in, choose the PIN. */
export async function freshLogin(phone, username, password = "Pearl@2026") {
  adb("shell", "pm", "clear", APP);
  for (const p of PERMISSIONS) adb("shell", "pm", "grant", APP, `android.permission.${p}`);
  adb("shell", "appops", "set", APP, "SYSTEM_ALERT_WINDOW", "allow");
  adb("shell", "cmd", "uimode", "night", "yes");
  adb("shell", "settings", "put", "system", "font_scale", "1.1");
  adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
  await phone.tap("Username", { timeout: 30_000 });
  await phone.type(username);
  await phone.tap("Password");
  await phone.type(password);
  phone.hideKeyboard();
  await phone.tap("Log in", { index: 1 });
  await phone.find("Choose a PIN", { timeout: 30_000 });
  for (const d of PIN) await phone.tap(d);
  await phone.tap("Next");
  await phone.find("Save PIN");
  for (const d of PIN) await phone.tap(d);
  await phone.tap("Save PIN");
  await phone.find("My day", { timeout: 30_000 });
}

/** If the app asks for the PIN (back after 5 minutes away), type it. */
export async function unlock(phone) {
  if (await phone.has("Enter your PIN")) {
    for (const d of PIN) await phone.tap(d);
    if (await phone.has("Unlock")) await phone.tap("Unlock");
  }
}
