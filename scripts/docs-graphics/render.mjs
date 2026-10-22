#!/usr/bin/env node
// Renders every src/*.html to ../../docs/.gitbook/assets/<name>.png at 2x, then palette-quantises with sharp.
// Setup (once, anywhere): npm i --no-save playwright sharp && npx playwright install chromium
// If they are not installed in the repo, point DOCS_GRAPHICS_MODULES (";"-separated) at node_modules folders that has them.
// Needs network for Google Fonts (Grandstander). Usage: node scripts/docs-graphics/render.mjs [name ...]
// Raw screenshots of the live demo come from shots.mjs (kept in shots/); demo.html frames them.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../docs/.gitbook/assets");
const paths = [here, resolve(here, "../.."), ...(process.env.DOCS_GRAPHICS_MODULES ?? "").split(";").filter(Boolean)];
const req = createRequire(join(here, "x.js"));
const load = (m) => createRequire(import.meta.url)(req.resolve(m, { paths }));
const { chromium } = load("playwright");
const sharp = load("sharp");

mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const names = readdirSync(join(here, "src"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => f.slice(0, -5))
  .filter((n) => !only.length || only.includes(n));

const browser = await chromium.launch();
for (const name of names) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(here, "src", `${name}.html`)).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const raw = await page.locator("#frame").screenshot();
  const png = await sharp(raw).png({ palette: true, quality: 85, effort: 10, colours: 192, dither: 0.6 }).toBuffer();
  writeFileSync(join(out, `${name}.png`), png);
  console.log(name.padEnd(24), `${(png.length / 1024).toFixed(0)} KB`);
  await page.close();
}
await browser.close();
