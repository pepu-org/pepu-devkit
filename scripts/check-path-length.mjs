#!/usr/bin/env node
// Fails if any tracked path is longer than MAX_PATH_LENGTH characters (relative to the repo root).
//
// Why: Windows' default MAX_PATH is 260 characters for the WHOLE path, so a clone into a deep folder dies with
// "Filename too long" (and /plugin marketplace add, which clones the repo, with it) when a tracked path is long.
// The vendored Solidity libraries under services/paymaster/contracts/lib were the offenders. 130 leaves about
// 130 characters for the user's clone folder.
//
// Usage: node scripts/check-path-length.mjs
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_PATH_LENGTH = 130;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const sorted = files.map((f) => ({ f, n: [...f].length })).sort((a, b) => b.n - a.n);
const longest = sorted[0];
const offenders = sorted.filter((x) => x.n > MAX_PATH_LENGTH);

console.log(`path length: ${files.length} tracked files, longest ${longest?.n ?? 0} chars (limit ${MAX_PATH_LENGTH})`);
if (offenders.length) {
  for (const o of offenders.slice(0, 20)) console.error(`FAIL ${o.n} chars: ${o.f}`);
  if (offenders.length > 20) console.error(`... and ${offenders.length - 20} more`);
  console.error("Shorten or remove these paths so the repo clones on Windows (MAX_PATH 260).");
  process.exit(1);
}
console.log("path length ok");
