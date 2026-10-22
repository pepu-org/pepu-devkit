import { cp, mkdir, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** Turn a free-form project name into a valid, boring npm package name. */
export function toPackageName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-+/g, "-")
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "pepu-app";
}

/** True if the directory doesn't exist, or exists and is empty. */
export async function isSafeTargetDir(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return true;
  const entries = await readdir(dir);
  return entries.length === 0;
}

/** Recursive copy. `fs.cp` copies dotfiles and dot-directories (`.mcp.json`, `.cursor/`). */
export async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true });
}

/**
 * npm never packs a `.gitignore` or `.npmrc` (and a nested `.gitignore` also
 * changes what gets packed), so `scripts/sync-assets.mjs` stores them as
 * `_gitignore` / `_npmrc` inside this package. Restore the real names.
 */
export const RENAMED_DOTFILES: ReadonlyArray<readonly [string, string]> = [
  ["_gitignore", ".gitignore"],
  ["_npmrc", ".npmrc"],
];

export async function restoreDotfiles(dir: string): Promise<void> {
  for (const [stored, real] of RENAMED_DOTFILES) {
    const from = path.join(dir, stored);
    const to = path.join(dir, real);
    if (existsSync(from) && !existsSync(to)) await rename(from, to);
  }
}
