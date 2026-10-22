#!/usr/bin/env node
// Validates the Claude Code plugin (.claude-plugin, skills, commands, agents) against the real MCP and SDK.
//
//   1. plugin.json and marketplace.json versions are equal (see also scripts/check-versions.mjs)
//   2. mcpServers.pepu is declared, names packages/mcp's package, and its range accepts the current MCP version
//   3. every skills/<dir>/SKILL.md has name == dir, a non-empty description and the uniform sections
//   4. every pepu_* tool named anywhere in skills, commands or agents is registered in packages/mcp/src/tools
//   5. every @pepu-chain/sdk import path named exists in the SDK exports map, and every imported symbol is exported
//      (checked against the built dist: run `pnpm --filter @pepu-chain/sdk build` first)
//   6. counts stated in the manifests' descriptions are correct (`--write` regenerates the descriptions)
//   7. packages/mcp/server.json matches packages/mcp/package.json
//   8. the shared skill files are in sync (scripts/sync-skill-shared.mjs --check)
//   9. commands and agents have frontmatter and reference only skills, commands and agents that exist
//
// Usage: node scripts/check-plugin.mjs [--write]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
const errors = [];
const notes = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => relative(root, p).replaceAll("\\", "/");
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

// ------------------------------------------------------------------ inventory
const skillsDir = join(root, "skills");
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name)
  .sort();
const listMd = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];
const commands = listMd(join(root, "commands")).map((f) => f.replace(/\.md$/, ""));
const agents = listMd(join(root, "agents")).map((f) => f.replace(/\.md$/, ""));

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// ------------------------------------------------------------------ MCP tool registry (source of truth: packages/mcp/src/tools)
const toolsDir = join(root, "packages", "mcp", "src", "tools");
const registeredTools = new Set();
for (const f of readdirSync(toolsDir)) {
  if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "index.ts") continue;
  const src = readFileSync(join(toolsDir, f), "utf8");
  for (const m of src.matchAll(/registerTool\(\s*["'`](pepu_[a-z0-9_]+)["'`]/g)) registeredTools.add(m[1]);
}
if (registeredTools.size === 0) fail("could not read any registered MCP tools from packages/mcp/src/tools");

// ------------------------------------------------------------------ SDK exports (source of truth: built dist)
const sdkRoot = join(root, "packages", "sdk");
const sdkPkg = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8"));
const exportKeys = Object.keys(sdkPkg.exports).filter((k) => k !== "./package.json");
const toSubpath = (k) => (k === "." ? "@pepu-chain/sdk" : `@pepu-chain/sdk/${k.slice(2)}`);
const subpathToKey = new Map(exportKeys.map((k) => [toSubpath(k), k]));
const distIndex = join(sdkRoot, "dist", "index.js");
const sdkBuilt = existsSync(distIndex);
if (!sdkBuilt) fail("the SDK is not built (packages/sdk/dist). Run: pnpm --filter @pepu-chain/sdk build");

const runtimeExports = new Map(); // subpath -> Set of names
let allDts = "";
if (sdkBuilt) {
  for (const [sub, key] of subpathToKey) {
    const entry = sdkPkg.exports[key];
    const file = join(sdkRoot, entry.import ?? entry.default);
    try {
      const mod = await import(pathToFileURL(file).href);
      runtimeExports.set(sub, new Set(Object.keys(mod)));
    } catch (e) {
      fail(`could not import ${sub} from the built SDK: ${String(e.message).split("\n")[0]}`);
      runtimeExports.set(sub, new Set());
    }
  }
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.d\.(c)?ts$/.test(d.name)) allDts += readFileSync(p, "utf8") + "\n";
    }
  };
  walk(join(sdkRoot, "dist"));
}
const allRuntimeNames = new Set([...runtimeExports.values()].flatMap((s) => [...s]));
// Runtime exports are exact per subpath. Types have no runtime presence, so they are matched against the
// declaration files as a whole (lax: it proves the type exists in the SDK, not that this subpath re-exports it).
const isExported = (sub, name) =>
  runtimeExports.get(sub)?.has(name) ||
  new RegExp(`\\b(?:interface|type|class|enum)\\s+${name}\\b|\\bexport\\b[^;]*\\b${name}\\b`).test(allDts);

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// ------------------------------------------------------------------ 1 + 7: versions
const plugin = readJson(".claude-plugin/plugin.json");
const market = readJson(".claude-plugin/marketplace.json");
const entry = (market.plugins ?? []).find((p) => p.name === plugin.name);
if (!entry) fail(`marketplace.json has no plugin entry named "${plugin.name}"`);
if (plugin.version !== market.version) fail(`plugin.json version ${plugin.version} != marketplace.json version ${market.version}`);
if (entry && plugin.version !== entry.version) {
  fail(`plugin.json version ${plugin.version} != marketplace plugin entry version ${entry.version}`);
}
const mcpPkg = readJson("packages/mcp/package.json");
const mcpServer = readJson("packages/mcp/server.json");
if (mcpServer.version !== mcpPkg.version) fail(`mcp server.json ${mcpServer.version} != package.json ${mcpPkg.version}`);

// ------------------------------------------------------------------ 2: mcpServers
function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "" || r === "latest" || r === "*") return true;
  return r.split("||").some((alt) =>
    alt
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => {
        const m = term.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+(?:\.\d+){0,2})/);
        if (!m) return false;
        const parts = m[2].split(".").map(Number);
        const base = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
        switch (m[1]) {
          case "^": {
            const upper = base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
            return cmp(v, base) >= 0 && cmp(v, upper) < 0;
          }
          case "~":
            return cmp(v, base) >= 0 && cmp(v, [base[0], base[1] + 1, 0]) < 0;
          case ">=":
            return cmp(v, base) >= 0;
          case "<=":
            return cmp(v, base) <= 0;
          case ">":
            return cmp(v, base) > 0;
          case "<":
            return cmp(v, base) < 0;
          default:
            return cmp(v, base) === 0;
        }
      }),
  );
}
const server = plugin.mcpServers?.pepu;
if (!server) {
  fail("plugin.json does not declare mcpServers.pepu");
} else {
  const spec = (server.args ?? []).find((a) => typeof a === "string" && a.startsWith("@pepu-chain/mcp"));
  if (!spec) {
    fail("mcpServers.pepu.args does not name the @pepu-chain/mcp package");
  } else {
    const at = spec.indexOf("@", 1);
    const name = at === -1 ? spec : spec.slice(0, at);
    const range = at === -1 ? "" : spec.slice(at + 1);
    if (name !== mcpPkg.name) fail(`mcpServers.pepu names ${name} but packages/mcp is ${mcpPkg.name}`);
    if (!satisfies(mcpPkg.version, range)) {
      fail(`mcpServers.pepu range "${range}" does not accept the current MCP version ${mcpPkg.version}`);
    }
  }
}

// ------------------------------------------------------------------ 3: skills
const REQUIRED_SECTIONS = [
  ["When to use", /^##\s+.*when to use/im],
  ["Chain facts", /^##\s+.*chain facts/im],
  ["SDK functions to use", /^##\s+.*sdk functions to use/im],
  ["MCP tools to call first", /^##\s+.*mcp tools to call first/im],
  ["Steps", /^##\s+.*steps/im],
  ["Verify", /^##\s+.*verify/im],
  ["Pitfalls", /^##\s+.*pitfalls/im],
  ["Never hand-roll", /^##\s+.*never hand-roll/im],
];
const texts = new Map(); // file -> text, everything scanned for tools, imports, names
for (const name of skills) {
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) {
    fail(`skills/${name} has no SKILL.md`);
    continue;
  }
  const text = readFileSync(file, "utf8");
  const fm = frontmatter(text);
  if (!fm) fail(`${rel(file)}: missing frontmatter`);
  else {
    if (fm.name !== name) fail(`${rel(file)}: frontmatter name "${fm.name}" must equal the directory "${name}"`);
    if (!fm.description || fm.description.length < 20) fail(`${rel(file)}: description is empty or too short`);
  }
  for (const [label, re] of REQUIRED_SECTIONS) {
    if (!re.test(text)) fail(`${rel(file)}: missing the "${label}" section`);
  }
  for (const shared of ["reference/chain-facts.md", "reference/rules.md"]) {
    if (!text.includes(shared)) fail(`${rel(file)}: does not link ${shared}`);
  }
}
const mdFiles = [];
const collect = (dir) => {
  if (!existsSync(dir)) return;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) collect(p);
    else if (d.name.endsWith(".md")) mdFiles.push(p);
  }
};
collect(skillsDir);
collect(join(root, "commands"));
collect(join(root, "agents"));
for (const f of mdFiles) texts.set(f, readFileSync(f, "utf8"));

// ------------------------------------------------------------------ 9: commands and agents
for (const [kind, names, dir] of [
  ["command", commands, "commands"],
  ["agent", agents, "agents"],
]) {
  for (const n of names) {
    const file = join(root, dir, `${n}.md`);
    const fm = frontmatter(readFileSync(file, "utf8"));
    if (!fm) fail(`${rel(file)}: missing frontmatter`);
    else if (!fm.description) fail(`${rel(file)}: ${kind} needs a description`);
    else if (kind === "agent" && fm.name !== n) fail(`${rel(file)}: agent name "${fm.name}" must equal the file name "${n}"`);
  }
}
const KNOWN_NAMES = new Set([...skills, ...commands, ...agents, plugin.name, "pepu-mcp", "pepu-org", "pepu-chain"]);

// ------------------------------------------------------------------ 4, 5 and name references
// Not tools: Foundry rpc_endpoints alias used in forge commands (--rpc-url pepu_mainnet).
const NOT_TOOLS = new Set(["pepu_mainnet"]);
const toolRefs = new Map(); // tool -> files
const nearMiss = [];
const unknownCalls = new Set();
for (const [file, raw] of texts) {
  const text = raw.replace(/mcp__plugin_[\w-]+?__(?=pepu_)/g, "");
  for (const m of text.matchAll(/(?<![A-Za-z0-9])pepu_[a-z0-9_]+/g)) {
    const t = m[0];
    if (NOT_TOOLS.has(t)) continue;
    if (!toolRefs.has(t)) toolRefs.set(t, new Set());
    toolRefs.get(t).add(rel(file));
  }

  // skill / command / agent names
  for (const m of text.matchAll(/`(pepu-[a-z0-9-]+)`/g)) {
    if (!KNOWN_NAMES.has(m[1])) fail(`${rel(file)}: references unknown skill, command or agent "${m[1]}"`);
  }

  // SDK subpaths named anywhere
  for (const m of text.matchAll(/@pepu-chain\/sdk((?:\/[a-z][a-z0-9-]*)*)/g)) {
    const sub = `@pepu-chain/sdk${m[1]}`;
    if (!subpathToKey.has(sub)) fail(`${rel(file)}: "${sub}" is not in the SDK exports map`);
  }

  // imports: every symbol must exist
  if (sdkBuilt) {
    for (const m of text.matchAll(/import\s+(type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["'](@pepu-chain\/sdk[^"']*)["']/g)) {
      const sub = m[3];
      if (!subpathToKey.has(sub)) continue; // already reported
      const names = m[2]
        .split(",")
        .map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
        .filter(Boolean);
      for (const n of names) {
        if (!isExported(sub, n)) fail(`${rel(file)}: "${n}" is not exported by ${sub}`);
      }
    }
    // backticked names that look like SDK symbols but are not exported
    for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)(\(\))?`/g)) {
      const name = m[1];
      if (name.length < 5 || allRuntimeNames.has(name) || KNOWN_NAMES.has(name)) continue;
      if (/^[A-Z0-9_]+$/.test(name) || name.startsWith("pepu_") || name.startsWith("mcp__")) continue;
      if (!/[a-z][A-Z]/.test(name) && !/^[A-Z][a-z]/.test(name)) continue;
      const close = [...allRuntimeNames].find((s) => s !== name && Math.abs(s.length - name.length) <= 2 && lev(s.toLowerCase(), name.toLowerCase()) <= 2);
      if (close && !isExported("@pepu-chain/sdk", name) && !allDts.includes(` ${name}`)) {
        nearMiss.push(`${rel(file)}: \`${name}\` is not an SDK export, did you mean \`${close}\`?`);
      } else if (m[2] && !isExported("@pepu-chain/sdk", name) && !allDts.includes(name)) {
        unknownCalls.add(name);
      }
    }
  }
}
for (const [tool, files] of toolRefs) {
  if (!registeredTools.has(tool)) fail(`unknown MCP tool ${tool} (named in ${[...files].join(", ")})`);
}
for (const n of nearMiss) fail(n);
if (unknownCalls.size) {
  notes.push(`call-style names that are not SDK exports (fine for third-party functions, check by eye): ${[...unknownCalls].sort().join(", ")}`);
}

// ------------------------------------------------------------------ 6: counts in descriptions
const generated = `Builder infrastructure for Pepe Unchained (PEPU) V2 mainnet (chain 97741): a PEPU MCP server (${registeredTools.size} tools, resources and prompts), ${skills.length} skills, ${commands.length} slash commands and a builder subagent. Everything is built on @pepu-chain/sdk: Google login with an embedded wallet, Privy session signers, sponsored transactions, and the combination (Google login, one on-chain session, no popups, no user gas). Scaffolds apps with create-pepu-app.`;
if (write) {
  plugin.description = generated;
  if (entry) entry.description = generated;
  writeFileSync(join(root, ".claude-plugin/plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
  writeFileSync(join(root, ".claude-plugin/marketplace.json"), JSON.stringify(market, null, 2) + "\n");
  notes.push("rewrote the manifest descriptions");
}
const countChecks = [
  [/(\d+)\s+skills\b/, skills.length, "skills"],
  [/(\d+)\s+(?:slash\s+)?commands\b/, commands.length, "commands"],
  [/(\d+)\s+tools\b/, registeredTools.size, "tools"],
];
for (const [label, desc] of [
  ["plugin.json", plugin.description],
  ["marketplace.json plugin entry", entry?.description],
  ["marketplace.json", market.description],
]) {
  if (typeof desc !== "string") continue;
  for (const [re, actual, what] of countChecks) {
    const m = desc.match(re);
    if (m && Number(m[1]) !== actual) fail(`${label} description says ${m[1]} ${what} but there are ${actual} (run with --write)`);
  }
}

// ------------------------------------------------------------------ 8: shared files
if (sdkBuilt) {
  try {
    execFileSync(process.execPath, [join(root, "scripts", "sync-skill-shared.mjs"), "--check"], { stdio: "pipe" });
  } catch (e) {
    fail(`shared skill files are stale: ${String(e.stderr ?? e.message).trim().split("\n").join("; ")}`);
  }
}

// ------------------------------------------------------------------ report
console.log(
  `plugin ${plugin.version}: ${skills.length} skills, ${commands.length} commands, ${agents.length} agents; ` +
    `${registeredTools.size} MCP tools registered, ${toolRefs.size} referenced; ${texts.size} files scanned`,
);
for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  console.error(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log("plugin check ok");
