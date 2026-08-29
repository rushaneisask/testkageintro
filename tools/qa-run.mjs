/**
 * End-to-end QA: plays the intro exactly as a visitor would (no pausing, no
 * poking at internals) and captures the frame at each beat, plus every error.
 *
 * Not part of the app build, so playwright is installed ad hoc:
 *
 *   npm i --no-save playwright
 *   node tools/qa-run.mjs <url> <label> [width] [height]
 */
import { chromium } from "playwright";

const out = process.env.QA_OUT || "/tmp/kage-qa";
await (await import("node:fs/promises")).mkdir(out, { recursive: true });
const url = process.argv[2] || "http://localhost:5173";
const label = process.argv[3] || "qa";
const width = +(process.argv[4] || 1280);
const height = +(process.argv[5] || 800);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).split("\n")[0]));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
page.on("crash", () => errors.push("PAGE CRASHED"));
page.setDefaultTimeout(600000);

const t0 = Date.now();
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(
  () => document.getElementById("loading")?.style.display === "none",
  {},
  { timeout: 600000 }
);
const loadMs = Date.now() - t0;
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/${label}-0-logo.png` });

const clickedAt = Date.now();
await page.click("#enter-btn");

// Sample the live canvas at each beat, recording where the timeline actually
// was, so a slow renderer can't make this look like a pass when it isn't.
const beats = [];
for (let i = 0; i < 4; i++) {
  const at = Date.now() - t0;
  await page.screenshot({ path: `${out}/${label}-${i + 1}-beat.png` });
  beats.push(at);
}

const heroOk = await page.waitForFunction(
  () => document.getElementById("hero")?.classList.contains("visible"),
  {},
  { timeout: 600000 }
).then(() => true).catch(() => false);
const transitionMs = Date.now() - clickedAt;

await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/${label}-5-hero.png` });

// "The hero appeared" is NOT the same as "the intro played" — skipping also
// reveals the hero, which is exactly how a regression that skipped the whole
// cinematic once passed this check. The timeline runs ~9.5s, so anything
// that reaches the hero almost immediately did not play it.
const MIN_TRANSITION_MS = 4000;
const played = transitionMs >= MIN_TRANSITION_MS;

const pass = heroOk && played && errors.length === 0;
console.log(JSON.stringify({
  label, pass, loadMs, transitionMs, played, heroOk,
  errors: errors.slice(0, 6),
}));
if (!pass) {
  console.error(
    `FAIL: ${!heroOk ? "hero never appeared" : ""}` +
    `${!played ? ` intro did not play (click->hero ${transitionMs}ms < ${MIN_TRANSITION_MS}ms)` : ""}` +
    `${errors.length ? ` ${errors.length} error(s)` : ""}`
  );
}
await browser.close();
process.exit(pass ? 0 : 1);
