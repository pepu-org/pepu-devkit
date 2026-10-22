#!/usr/bin/env node
/**
 * Design guard. Fails (exit 1) when:
 *   1. any template's copy of a shared design file differs from
 *      templates/_design (run sync-design.mjs), or
 *   2. a text/background token pair falls below its WCAG 2.x target.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FILES, TEMPLATES, templatesRoot } from "./sync-design.mjs";

let failed = false;

// 1. copies identical -------------------------------------------------------
for (const [source, destination] of FILES) {
  const canonical = await readFile(path.join(templatesRoot, "_design", source));
  for (const template of TEMPLATES) {
    const copy = await readFile(path.join(templatesRoot, template, destination)).catch(
      () => null,
    );
    if (copy === null || !canonical.equals(copy)) {
      failed = true;
      console.error(`DRIFT  ${template}/${destination} differs from _design/${source}`);
    }
  }
}

// 2. contrast ---------------------------------------------------------------
const css = await readFile(path.join(templatesRoot, "_design", "pepu-design.css"), "utf8");
const token = (name) => {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --color-${name} not found`);
  return match[1];
};

const luminance = (hex) => {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground token, background token, minimum ratio, what it is] */
const PAIRS = [
  ["ink", "canvas", 4.5, "body text on canvas"],
  ["ink", "surface", 4.5, "body text on surface"],
  ["ink", "raised", 4.5, "body text on raised"],
  ["ink-soft", "surface", 4.5, "secondary text on surface"],
  ["ink-soft", "raised", 4.5, "secondary text on raised"],
  ["ink-muted", "canvas", 4.5, "muted text on canvas"],
  ["ink-muted", "surface", 4.5, "muted text on surface"],
  ["ink-muted", "raised", 4.5, "muted text on raised"],
  ["ink-muted", "overlay", 4.5, "muted text on overlay"],
  ["pepu-300", "canvas", 4.5, "green text on canvas"],
  ["pepu-300", "surface", 4.5, "green text on surface"],
  ["pepu-300", "raised", 4.5, "green text on raised"],
  ["lime", "raised", 4.5, "lime text on raised"],
  ["on-brand", "pepu-400", 4.5, "button label on green (light end)"],
  ["on-brand", "pepu-500", 4.5, "button label on green (dark end)"],
  ["on-brand", "lime", 4.5, "label on lime"],
  ["warn", "warn-bg", 4.5, "warning title on warning bg"],
  ["danger", "danger-bg", 4.5, "error text on error bg"],
  ["danger", "surface", 4.5, "error text on surface"],
  ["danger", "raised", 4.5, "error text on raised"],
  ["info", "info-bg", 4.5, "info title on info bg"],
  ["ink-soft", "warn-bg", 4.5, "notice body on warning bg"],
  ["ink-soft", "danger-bg", 4.5, "notice body on error bg"],
  ["ink-soft", "info-bg", 4.5, "notice body on info bg"],
  // Non-text UI (borders of inputs, focus ring): 3:1.
  ["line-strong", "surface", 3, "input border on surface"],
  ["lime", "canvas", 3, "focus ring on canvas"],
  ["lime", "raised", 3, "focus ring on raised"],
];

for (const [fg, bg, min, what] of PAIRS) {
  const value = ratio(token(fg), token(bg));
  const ok = value >= min;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"}  ${value.toFixed(2).padStart(5)}:1  (>= ${min})  ${what}  [${fg} on ${bg}]`);
}

if (failed) {
  console.error("\ncheck-design failed");
  process.exit(1);
}
console.log("\ncheck-design passed");
