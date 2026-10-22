#!/usr/bin/env node
// Checks tracked Markdown files:
//   1. relative links resolve to real files
//   2. #anchors (same-file and file#anchor) resolve to a heading or an explicit <a id> in docs/
//   (image links ![alt](path) go through the same check, so a missing docs/.gitbook/assets file fails)
//   3. absolute https://docs.pepeunchained.com/... links in docs/ point at a real page
// Usage: node scripts/check-links.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.includes("/lib/"));

const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const GUIDE = "https://docs.pepeunchained.com";

/** GitHub-style heading slug. */
function slug(heading) {
  return heading
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const anchorCache = new Map();
/** Set of valid anchors in a Markdown file (heading slugs with GitHub's -1 suffixes, plus explicit ids). */
function anchorsOf(absPath) {
  if (anchorCache.has(absPath)) return anchorCache.get(absPath);
  const text = readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
  const set = new Set();
  const seen = new Map();
  const body = text.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, " "));
  for (const m of body.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    set.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const m of body.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) set.add(m[1]);
  anchorCache.set(absPath, set);
  return set;
}

let bad = 0;
let anchorsChecked = 0;
let imagesChecked = 0;
const report = (file, msg) => {
  console.error(`${file}: ${msg}`);
  bad++;
};

for (const file of files) {
  const abs = join(root, file);
  if (!existsSync(abs)) continue;
  const inDocs = file.startsWith("docs/") && !/^docs\/llms/.test(file);
  const text = readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  for (const m of text.matchAll(linkRe)) {
    const target = m[1];
    if (/^(mailto:|tel:)/.test(target)) continue;

    if (target.startsWith(GUIDE) && inDocs) {
      const rest = target.slice(GUIDE.length);
      const [p, frag] = rest.split("#");
      const slugPath = p.replace(/^\//, "").replace(/\/$/, "");
      if (slugPath && !/\.(txt|json|xml)$/.test(slugPath)) {
        const page = join(root, "docs", `${slugPath}.md`);
        if (!existsSync(page)) report(file, `broken guide link -> ${target}`);
        else if (frag) {
          anchorsChecked++;
          if (!anchorsOf(page).has(frag) && !anchorsOf(page).has(frag.toLowerCase())) report(file, `broken anchor -> ${target}`);
        }
      }
      continue;
    }
    if (/^https?:/.test(target)) continue;

    if (text[m.index] === "[" && text[m.index - 1] === "!") imagesChecked++;
    const [rawPath, frag] = target.split("#");
    const path = decodeURIComponent(rawPath);
    if (!path && !frag) continue;
    const dest = path ? resolve(dirname(abs), path) : abs;
    if (path && !existsSync(dest)) {
      report(file, `broken link -> ${target}`);
      continue;
    }
    if (frag && inDocs && dest.endsWith(".md") && statSync(dest).isFile()) {
      anchorsChecked++;
      const a = anchorsOf(dest);
      if (!a.has(frag) && !a.has(frag.toLowerCase())) report(file, `broken anchor -> ${target}`);
    }
  }
}
console.log(`checked ${files.length} markdown files (${anchorsChecked} anchors in docs/, ${imagesChecked} images), ${bad} broken link(s)`);
process.exit(bad ? 1 : 0);
