// Poke the emulator while writing a video script:
//   node scripts/videos/phone-cli.mjs shot out.png | nodes | tap "Text" | type "words" | back | scroll [dy] | launch
import { adb, APP, Phone, SERIAL } from "./lib/phone.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const [cmd, ...a] = process.argv.slice(2);
const p = new Phone();
const re = (s) => (s.startsWith("/") ? new RegExp(s.slice(1, -1)) : s);
if (cmd === "shot") fs.writeFileSync(a[0], execFileSync(process.env.HOME + "/Android/Sdk/platform-tools/adb", ["-s", SERIAL, "exec-out", "screencap", "-p"], { maxBuffer: 64e6 }));
if (cmd === "nodes") for (const n of p.nodes()) if (n.text || n.desc) console.log(JSON.stringify([n.text, n.desc, n.clickable ? "C" : "", n.bounds.join(",")]));
if (cmd === "tap") await p.tap(re(a[0]), { index: Number(a[1] ?? 0) });
if (cmd === "tapxy") await p.tapXY(Number(a[0]), Number(a[1]));
if (cmd === "type") await p.type(a[0]);
if (cmd === "clear") await p.clear();
if (cmd === "fill") await p.fill(re(a[0]), a[1]);
if (cmd === "back") await p.back();
if (cmd === "scroll") await p.scroll(Number(a[0] ?? 700));
if (cmd === "launch") adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
