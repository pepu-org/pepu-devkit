/**
 * Minimal .env reading and writing. Values are never logged or returned by
 * anything in this module except `parseEnv`, whose result callers pass straight
 * to the SDK's `checkPepuEnv` (which reports presence and length only).
 */

import fs from "node:fs";

/** Parse dotenv text. Handles `KEY=value`, quotes, `export`, comments. No expansion. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !m[1]) continue;
    let value = (m[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/** Read and parse an env file, or `{}` when it does not exist. */
export function readEnvFile(file: string): Record<string, string> {
  try {
    return parseEnv(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

/**
 * Set `updates` in an env file: replace an existing line for the key, or append
 * one. Preserves every other line and comment. Creates the file when missing.
 * Written with owner-only permissions where the platform supports it.
 */
export function upsertEnvFile(file: string, updates: Record<string, string>): void {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const next = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = m?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key) as string;
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  // Drop the trailing empty element from a final newline before appending.
  while (next.length > 0 && next[next.length - 1] === "") next.pop();
  for (const [key, value] of pending) next.push(`${key}=${value}`);
  fs.writeFileSync(file, next.join(eol) + eol, { mode: 0o600 });
}
