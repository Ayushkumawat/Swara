/**
 * Screenshot the test-call dialog. Separate from shots.mjs because it needs an
 * interaction (open the Test & simulate tab, click through) rather than just a
 * page load.
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "/tmp/swara-live-shots";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--force-color-profile=srgb",
    // Grant the mic and feed it a synthetic tone, so the panel can be captured
    // in its live state without a real device or a permission prompt.
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
  defaultViewport: { width: 1400, height: 950, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
await page.goto(`${BASE}/agents`, { waitUntil: "networkidle2" }).catch(() => {});
await sleep(1500);

// Open the tab that hosts the voice test, then the dialog itself.
const clickText = async (text) => {
  const handle = await page.evaluateHandle((needle) => {
    const nodes = [...document.querySelectorAll("button")];
    return nodes.find((n) => n.textContent?.trim().includes(needle)) ?? null;
  }, text);
  const element = handle.asElement();
  if (!element) throw new Error(`no button matching "${text}"`);
  await element.click();
};

await clickText("Test & simulate");
await sleep(900);
await page.screenshot({ path: `${OUT}/test-tab.png` });
console.log("captured test-tab");

await clickText("Start voice test");
await sleep(1200);
await page.screenshot({ path: `${OUT}/call-panel-setup.png` });
console.log("captured call-panel-setup");

await clickText("Start call");
// Long enough for the socket to open and the agent to deliver its greeting.
await sleep(9000);
await page.screenshot({ path: `${OUT}/call-panel-live.png` });
console.log("captured call-panel-live");

await browser.close();
console.log(`\n→ ${OUT}`);
