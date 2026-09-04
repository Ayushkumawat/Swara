/**
 * Screenshot every route against a running server.
 *
 *   npm run build && npm run start
 *   node scripts/shots.mjs [outDir]
 *
 * Uses the system Chrome via puppeteer-core, waits for data to land and
 * animations to settle, then captures. Useful for reviewing the whole surface
 * at once after a design change.
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "/tmp/swara-shots";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

const ROUTES = [
  ["/", "landing", true],
  ["/pricing", "pricing", true],
  ["/signup", "signup", false],
  ["/login", "login", false],
  ["/onboarding", "onboarding", false],
  ["/overview", "overview", true],
  ["/agents", "agents", true],
  ["/campaigns", "campaigns", true],
  ["/live", "live", true],
  ["/analytics", "analytics", true],
  ["/bookings", "bookings", true],
  ["/complaints", "complaints", true],
  ["/customers", "customers", true],
  ["/voice", "voice", true],
  ["/numbers", "numbers", true],
  ["/integrations", "integrations", true],
  ["/settings", "settings", true],
];

// ONLY=settings,agents narrows the run when iterating on one screen.
const only = process.env.ONLY?.split(",").map((s) => s.trim());
const targets = only ? ROUTES.filter(([, name]) => only.includes(name)) : ROUTES;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});

for (const [path, name, fullPage] of targets) {
  const page = await browser.newPage();
  // Screens with always-on polling never reach networkidle0, so settle on the
  // weaker signal and make up the difference with the explicit waits below.
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 20_000 });
  } catch {
    console.warn(`${name}: navigation did not settle, capturing anyway`);
  }
  await sleep(600);

  // Scroll the full height so IntersectionObserver-gated sections mount,
  // then return to the top before capturing.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });

  // Let number tickers, path draws and bar growth finish.
  await sleep(2200);

  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`captured ${name}`);
  await page.close();
}

await browser.close();
console.log(`\n→ ${OUT}`);
