#!/usr/bin/env node
// Captures the logged-out sign-in screen of the live demo (no personal data) into shots/.
// Usage: node scripts/docs-graphics/shots.mjs   (needs playwright; see render.mjs header)
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const paths = [here, resolve(here, "../.."), ...(process.env.DOCS_GRAPHICS_MODULES ? [process.env.DOCS_GRAPHICS_MODULES] : [])];
const { chromium } = createRequire(import.meta.url)(createRequire(join(here, "x.js")).resolve("playwright", { paths }));

const URL = "https://roadmap-demo.pepeunchained.com";
const browser = await chromium.launch();
for (const [name, width, height] of [["demo-desktop", 1440, 900], ["demo-mobile", 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 500 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(here, "shots", `${name}.png`) });
  console.log("shot", name, (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 200));
  await ctx.close();
}
await browser.close();
