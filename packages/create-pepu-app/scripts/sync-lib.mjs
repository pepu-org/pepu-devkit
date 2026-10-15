/**
 * Shared template-mirroring logic for `sync-assets.mjs` (and its tests).
 * Plain ESM so it runs without a build step.
 */
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** Build output and local-only files never shipped inside the package. */
export const EXCLUDED_NAMES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "out",
  "dist",
  "cache",
  "artifacts",
  "broadcast",
  "typechain-types",
  ".git",
  ".env",
  ".env.local",
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
]);

/** npm drops these when packing, so they are stored under an underscore name. */
export const RENAMED_DOTFILES = [
  [".gitignore", "_gitignore"],
  [".npmrc", "_npmrc"],
];

export function shouldSkip(entryPath) {
  const base = path.basename(entryPath);
  return EXCLUDED_NAMES.has(base) || base.endsWith(".log");
}

async function renameDotfilesIn(dir) {
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await renameDotfilesIn(full);
      continue;
    }
    for (const [real, stored] of RENAMED_DOTFILES) {
      if (entry.name === real) await rename(full, path.join(dir, stored));
    }
  }
}

/**
 * Mirror `src` to `dest`, keeping hidden files and directories (`.mcp.json`,
 * `.cursor/`, `.env.example`, ...) and renaming `.gitignore`/`.npmrc` to their
 * pack-safe names.
 */
export async function copyTemplateTree(src, dest) {
  if (!existsSync(src)) throw new Error(`Template source not found: ${src}`);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, filter: (source) => !shouldSkip(source) });
  await renameDotfilesIn(dest);
}
