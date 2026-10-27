/**
 * Runs the Android on-device tests (android/app/src/androidTest) on a phone plugged in by USB,
 * against the online staging project and its fake logins (dev-docs/TESTING.md).
 *
 *   pnpm phone:test                     every test class
 *   pnpm phone:test LoginPinTest        one class (or several, comma-separated)
 *   pnpm phone:test --real-call         also the real call: the phone dials PHONE_TEST_CALL_NUMBER
 *                                       (in .env, never committed) and someone answers it
 *   pnpm phone:test --emulator          use a running emulator instead of the phone
 *
 * Before the run: the Pearl app is uninstalled from the phone (a release build's signature would
 * clash with the test build; sync it first), and today's day of the fake BDM is reset on staging
 * so the day can be started again.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadEnv } from "./env-sync.ts";

const root = resolve(import.meta.dirname, "..");
const env = loadEnv();
const args = process.argv.slice(2);
const realCall = args.includes("--real-call");
const emulator = args.includes("--emulator");
const classes = args.filter((a) => !a.startsWith("--"));

const sdk = readFileSync(resolve(root, "android/local.properties"), "utf8").match(/^sdk\.dir=(.*)$/m)?.[1]?.trim();
if (!sdk) throw new Error("android/local.properties has no sdk.dir");
const adbPath = resolve(sdk, "platform-tools/adb");

const devices = execFileSync(adbPath, ["devices"], { encoding: "utf8" })
  .split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === "device").map((p) => p[0]!);
const serial = devices.find((d) => (emulator ? d.startsWith("emulator-") : !d.startsWith("emulator-")));
if (!serial) {
  const unauth = execFileSync(adbPath, ["devices"], { encoding: "utf8" }).includes("unauthorized");
  console.error(unauth
    ? "✖ The phone is connected but not allowed yet: unlock it and tap Allow on the USB debugging question."
    : `✖ No ${emulator ? "emulator" : "phone"} found. Plug the phone in by USB with USB debugging on (dev-docs/TESTING.md).`);
  process.exit(1);
}
const adb = (...a: string[]) => execFileSync(adbPath, ["-s", serial, ...a], { encoding: "utf8" }).trim();
const prop = (k: string) => adb("shell", "getprop", k);
console.log(`• ${prop("ro.product.manufacturer")} ${prop("ro.product.model")}, Android ${prop("ro.build.version.release")} (${serial})`);

const password = env.get("STAGING_TEST_PASSWORD");
if (!password) throw new Error("STAGING_TEST_PASSWORD missing in .env");

// The test build replaces any Pearl app on the phone (a release build is signed differently).
for (const pkg of ["com.pearl.crm", "com.pearl.crm.test"]) {
  if (adb("shell", "pm", "list", "packages", pkg).split("\n").some((l) => l.trim() === `package:${pkg}`)) {
    console.log(`• removing ${pkg} from the phone (the test build replaces it)`);
    adb("uninstall", pkg);
  }
}

const runnerArgs: Record<string, string> = { e2ePassword: password };

// A BDM starts one day per date: today's day of the fake staging BDM is removed so it can start
// again. The BDM test also needs where an office is (its pretend GPS starts there).
const url = env.get("DATABASE_URL");
if (url) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const { rowCount } = await db.query(
    `delete from public.bdm_days d using public.staff s
      where s.id = d.staff_id and s.username = 'bdm' and d.work_date = (now() at time zone 'Asia/Kolkata')::date`);
  if (rowCount) console.log("• reset today's day of the test BDM on staging");
  const office = (await db.query<{ lat: number; lng: number }>(
    "select lat, lng from public.offices where active order by created_at limit 1")).rows[0];
  if (office) Object.assign(runnerArgs, { officeLat: String(office.lat), officeLng: String(office.lng) });
  await db.end();
}

if (classes.length) runnerArgs.class = classes.map((c) => (c.includes(".") ? c : `com.pearl.crm.e2e.${c}`)).join(",");
if (realCall) {
  const call = env.get("PHONE_TEST_CALL_NUMBER");
  if (!call) throw new Error("--real-call needs PHONE_TEST_CALL_NUMBER in .env");
  runnerArgs.realCallNumber = call;
  console.log("• real-call test ON: answer the second phone when it rings, stay on ~20 s (a SIM question on the phone: tap a SIM)");
}

adb("shell", "rm", "-rf", "/data/local/tmp/e2e-failures");
console.log("• building and running the on-device tests (the first run takes a few minutes)…");
const gradle = spawnSync(
  "./gradlew",
  ["connectedDebugAndroidTest", "--console=plain", ...Object.entries(runnerArgs).map(([k, v]) => `-Pandroid.testInstrumentationRunnerArguments.${k}=${v}`)],
  { cwd: resolve(root, "android"), env: { ...process.env, ANDROID_SERIAL: serial }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

// Per-class summary from the JUnit XML results.
const dir = resolve(root, "android/app/build/outputs/androidTest-results/connected/debug");
let pass = 0, fail = 0, skip = 0;
const failures: string[] = [];
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".xml"))) {
    const xml = readFileSync(resolve(dir, f), "utf8");
    for (const m of xml.matchAll(/<testcase name="([^"]+)" classname="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const body = m[4] ?? "";
      const name = `${m[2]!.split(".").pop()} › ${m[1]}`;
      if (body.includes("<skipped")) skip++;
      else if (body.includes("<failure") || body.includes("<error")) {
        fail++;
        failures.push(`  ✖ ${name}\n      ${(body.match(/message="([^"]*)"/)?.[1] ?? body.slice(0, 300)).replace(/&quot;/g, '"').replace(/&#10;/g, " ").slice(0, 300)}`);
      } else pass++;
    }
  }
}
if (failures.length) {
  console.log(failures.join("\n"));
  // Screenshots and screen trees of the failures (FailureCapture in the tests).
  const out = resolve(root, "android/app/build/outputs/e2e-failures");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  spawnSync(adbPath, ["-s", serial, "pull", "/data/local/tmp/e2e-failures/.", out], { encoding: "utf8" });
  if (existsSync(out)) console.log(`  (screenshots and screen trees: ${out})`);
}
console.log(`\n${fail ? "✖" : "✔"} on-device: ${pass} passed, ${fail} failed, ${skip} skipped`);
if (gradle.status !== 0 && !fail) {
  const out = (gradle.stdout + gradle.stderr).split("\n");
  const at = out.findIndex((l) => l.includes("What went wrong"));
  console.log(out.filter((l) => /^e:/.test(l)).concat(at >= 0 ? out.slice(at, at + 6) : out.slice(-15)).join("\n"));
}
process.exit(gradle.status === 0 ? 0 : 1);
