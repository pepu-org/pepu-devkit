#!/usr/bin/env node
/**
 * Copies the canonical design files in templates/_design into every
 * template (templates are scaffolded standalone, so each carries its own
 * identical copy). Run after editing anything in templates/_design.
 */
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATES = [
  "consumer-app",
  "game-app",
  "token-gated-app",
  "nft-mint",
  "sponsored-demo",
  "sponsored-session-app",
];

/** [source file in _design, destination relative to a template root] */
export const FILES = [
  ["pepu-design.css", "app/pepu-design.css"],
  ["pepu-mark.tsx", "components/pepu-mark.tsx"],
  ["success-check.tsx", "components/success-check.tsx"],
  ["copy-button.tsx", "components/copy-button.tsx"],
  // Official PEPU icon assets (binary). pepu-logo.svg is the in-app mark;
  // icon.svg / favicon.ico / apple-icon.png are Next.js file-based icons.
  ["assets/pepu-logo.svg", "public/pepu-logo.svg"],
  ["assets/icon.svg", "app/icon.svg"],
  ["assets/favicon.ico", "app/favicon.ico"],
  ["assets/apple-icon.png", "app/apple-icon.png"],
];

const here = path.dirname(fileURLToPath(import.meta.url));
export const templatesRoot = path.join(here, "..");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const template of TEMPLATES) {
    for (const [source, destination] of FILES) {
      const to = path.join(templatesRoot, template, destination);
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(path.join(templatesRoot, "_design", source), to);
    }
    console.log(`synced design into ${template}`);
  }
}
