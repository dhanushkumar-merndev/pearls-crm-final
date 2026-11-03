// Quick look at pages while writing a video script:  node scripts/videos/probe.mjs <user> <outDir> /path1 /path2 ...
import { chromium, newPage, login, BASE } from "./lib/browser.mjs";
const [user, out, ...paths] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chromium" });
const page = await newPage(browser, { scale: 1 });
await login(page, user);
for (const p of paths) {
  await page.goto(`${BASE}${p}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  const name = p.replace(/[^a-z0-9]+/gi, "_") || "root";
  await page.screenshot({ path: `${out}/${user}${name}.png`, fullPage: false });
  console.log(p, "->", page.url());
}
await browser.close();
