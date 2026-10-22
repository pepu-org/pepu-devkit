#!/usr/bin/env node
// Checks that the docs agree with the code, and keeps the docs tree clean.
//
//   1. MCP tools: count and names in docs/mcp/tools.md == packages/mcp/src/tools
//   2. MCP prompts and resources: names and counts in docs/mcp/resources-and-prompts.md
//   3. Skills and commands: counts and names in docs/agent-tooling/{skills,plugin}.md
//      == skills/*/SKILL.md and commands/*.md
//   4. Templates: docs/templates/index.md, SUMMARY.md and templates/* == templates.json
//   5. Addresses: every full address in docs/contracts/address-map.md is in the SDK
//      registry (chain and PepuSwap), and every deployed chain address is listed
//   6. Count claims ("32 tools", "twelve skills", ...) anywhere in the docs, READMEs and
//      plugin metadata equal the real counts
//   7. Hygiene: no TODO( or "Status: stub", no tunnel hosts, no stale sponsorship framing
//
// Usage (after `pnpm --filter @pepu-chain/sdk build`): node scripts/check-docs-parity.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lf = (s) => s.replace(/\r\n/g, "\n");
const read = (rel) => lf(readFileSync(join(root, rel), "utf8"));
const problems = [];
const fail = (msg) => problems.push(msg);
const sameSet = (label, actual, documented) => {
  const a = new Set(actual);
  const d = new Set(documented);
  const missing = [...a].filter((x) => !d.has(x));
  const extra = [...d].filter((x) => !a.has(x));
  if (missing.length) fail(`${label}: in code but not documented: ${missing.join(", ")}`);
  if (extra.length) fail(`${label}: documented but not in code: ${extra.join(", ")}`);
  if (d.size !== documented.length) fail(`${label}: duplicate documented entries`);
};

// ---------------------------------------------------------------- 1. tools
const toolsDir = "packages/mcp/src/tools";
const toolNames = [];
for (const f of readdirSync(join(root, toolsDir)).sort()) {
  if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "index.ts") continue;
  for (const m of read(`${toolsDir}/${f}`).matchAll(/registerTool\(\s*"(pepu_[a-z0-9_]+)"/g)) toolNames.push(m[1]);
}
const docTools = [...read("docs/mcp/tools.md").matchAll(/^### `(pepu_[a-z0-9_]+)`/gm)].map((m) => m[1]);
const indexTools = [...read("docs/mcp/tools.md").matchAll(/^\| `(pepu_[a-z0-9_]+)` \|/gm)].map((m) => m[1]);
sameSet("MCP tools (docs/mcp/tools.md headings)", toolNames, docTools);
sameSet("MCP tools (docs/mcp/tools.md index table)", toolNames, indexTools);

// ---------------------------------------------------------------- 2. prompts and resources
const promptNames = [...read("packages/mcp/src/prompts.ts").matchAll(/registerPrompt\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
const resourceCount = (read("packages/mcp/src/resources.ts").match(/registerResource\(/g) ?? []).length;
const rp = read("docs/mcp/resources-and-prompts.md");
const docPrompts = [...rp.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
const docResources = [...rp.matchAll(/^\| `(pepu:\/\/[^`]+)` \|/gm)].map((m) => m[1]);
sameSet("MCP prompts (docs/mcp/resources-and-prompts.md)", promptNames, docPrompts);
if (docResources.length !== resourceCount) fail(`MCP resources: code registers ${resourceCount}, docs list ${docResources.length}`);

// ---------------------------------------------------------------- 3. skills and commands
const skillNames = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, "skills", d.name, "SKILL.md")))
  .map((d) => d.name)
  .sort();
const commandNames = readdirSync(join(root, "commands"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""))
  .sort();
const docSkills = [...read("docs/agent-tooling/skills.md").matchAll(/^\| `(pepu-[a-z0-9-]+)` \|/gm)].map((m) => m[1]);
const docCommands = [...read("docs/agent-tooling/plugin.md").matchAll(/^\| `\/(pepu-[a-z0-9-]+)` \|/gm)].map((m) => m[1]);
sameSet("skills (docs/agent-tooling/skills.md)", skillNames, docSkills);
sameSet("commands (docs/agent-tooling/plugin.md)", commandNames, docCommands);

// ---------------------------------------------------------------- 4. templates
const registry = JSON.parse(read("packages/create-pepu-app/src/templates.json"));
const templateNames = registry.map((t) => t.name);
const tplIndex = read("docs/templates/index.md");
const docTemplates = [...tplIndex.matchAll(/^\| \[`([a-z0-9-]+)`\]\(\1\.md\) \|/gm)].map((m) => m[1]);
sameSet("templates (docs/templates/index.md gallery)", templateNames, docTemplates);
const summary = read("docs/SUMMARY.md");
sameSet(
  "templates (docs/SUMMARY.md)",
  templateNames,
  [...summary.matchAll(/\(templates\/([a-z0-9-]+)\.md\)/g)].map((m) => m[1]).filter((n) => n !== "index"),
);
const templateDirs = readdirSync(join(root, "templates"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, "templates", d.name, "package.json")))
  .map((d) => d.name);
sameSet("templates (templates/ folders)", templateNames, templateDirs);
for (const n of templateNames) if (!existsSync(join(root, "docs", "templates", `${n}.md`))) fail(`templates: docs/templates/${n}.md is missing`);
const mcpTemplates = JSON.parse(read("packages/mcp/src/generated/templates.json")).map((t) => t.name);
sameSet("templates (MCP snapshot)", templateNames, mcpTemplates);

// ---------------------------------------------------------------- 5. addresses
const sdkDist = join(root, "packages", "sdk", "dist", "index.js");
if (!existsSync(sdkDist)) {
  console.error("check-docs-parity: packages/sdk/dist is missing. Run `pnpm --filter @pepu-chain/sdk build` first.");
  process.exit(2);
}
const sdk = await import(pathToFileURL(sdkDist).href);
const chainRows = sdk.getPepuAddresses(sdk.pepuMainnet.id).filter((r) => r.status === "deployed");
const swapAddrs = Object.values(sdk.pepuSwapContracts[sdk.pepuMainnet.id] ?? {})
  .filter((e) => e.status === "deployed")
  .map((e) => e.address);
const registryAddrs = new Set([...chainRows.map((r) => r.address), ...swapAddrs]);
// Addresses that docs name on purpose as "do not use".
const CANONICAL_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const addressMap = read("docs/contracts/address-map.md");
const docAddrs = new Set(addressMap.match(/0x[0-9a-fA-F]{40}\b/g) ?? []);
for (const a of docAddrs) {
  if (a === CANONICAL_MULTICALL3) continue;
  if (!registryAddrs.has(a)) fail(`address-map.md: ${a} is not in the SDK registry (or differs in checksum case)`);
}
for (const r of chainRows) if (!docAddrs.has(r.address)) fail(`address-map.md: registry address ${r.key} ${r.address} is missing`);
const swapDoc = read("docs/contracts/pepuswap.md");
for (const a of swapAddrs) if (!swapDoc.includes(a)) fail(`pepuswap.md: PepuSwap registry address ${a} is missing`);
const endpoints = read("docs/reference/endpoints.md");
for (const r of chainRows) if (!endpoints.includes(r.address)) fail(`reference/endpoints.md: registry address ${r.key} is missing (run gen-docs)`);

// ---------------------------------------------------------------- 6. count claims
const expected = { tools: toolNames.length, prompts: promptNames.length, skills: skillNames.length, commands: commandNames.length, templates: templateNames.length, resources: resourceCount };
const WORDS = { five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, "thirty-two": 32, "thirty two": 32 };
const claimRe = new RegExp(
  `\\b(\\d+|${Object.keys(WORDS).join("|")})\\s+(?:[A-Za-z-]+\\s+){0,3}?(tools|prompts|skills|commands|templates|resources)\\b`,
  "gi",
);
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const claimFiles = tracked.filter(
  (f) =>
    existsSync(join(root, f)) &&
    ((/^docs\/.*\.md$/.test(f) && !/llms/.test(f) && f !== "docs/reference/changelog.md") ||
      /^README\.md$/.test(f) ||
      /^packages\/(mcp|sdk|create-pepu-app)\/(README|AGENTS)\.md$/.test(f) ||
      /^templates\/_agent\//.test(f) ||
      /^\.claude-plugin\/.*\.json$/.test(f) ||
      /^(skills|commands|agents)\/.*\.md$/.test(f)),
);
let claims = 0;
for (const f of claimFiles) {
  const text = read(f).replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(claimRe)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
    const noun = m[2].toLowerCase();
    claims++;
    if (n !== expected[noun]) fail(`${f}: claims "${m[0]}" but the code has ${expected[noun]} ${noun}`);
  }
}

// ---------------------------------------------------------------- 7. hygiene
const docMd = tracked.filter((f) => /^docs\/.*\.md$/.test(f) && existsSync(join(root, f)));
const EXEMPT = new Set(["docs/CONTRIBUTING-DOCS.md", "docs/README.md"]);
const hygiene = [
  // `// TODO(sdk):` is a documented skill convention, so only the stub markers TODO(D1)..TODO(D9) are banned.
  [/TODO\(D\d/, "TODO(Dn) stub marker"],
  [/Status:\s*stub/i, '"Status: stub"'],
  [/ngrok|trycloudflare|localhost\.run|loca\.lt/i, "tunnel host"],
  [/https?:\/\/(?!localhost\b|127\.0\.0\.1\b)[a-z0-9.-]*\b(ngrok|tunnel)[a-z0-9.-]*/i, "tunnel URL"],
  [/sponsorship (never worked|has never worked|does not work)/i, "stale sponsorship framing"],
  [/sponsorship is not yet available|gas sponsorship is not available to apps yet|not available to app developers/i, "stale sponsorship framing"],
];
for (const f of docMd) {
  if (EXEMPT.has(f)) continue;
  const text = read(f).replace(/<!--[\s\S]*?-->/g, (c) => (/TODO\(D\d/.test(c) ? c : ""));
  for (const [re, label] of hygiene) {
    const line = text.split("\n").findIndex((l) => re.test(l));
    if (line >= 0) fail(`${f}:${line + 1}: ${label}`);
  }
}
// "localhost" may appear only as a local-development default, never as a public endpoint.
for (const f of docMd) {
  read(f)
    .split("\n")
    .forEach((l, i) => {
      if (/localhost/.test(l) && /\b(public(ly)? (endpoint|url|hosted)|hosted url|production)\b/i.test(l) && /https?:\/\/localhost/.test(l) && !/local|default|development|dev\b|never|not|placeholder|port/i.test(l)) {
        fail(`${f}:${i + 1}: localhost URL presented as a public endpoint`);
      }
    });
}

// ---------------------------------------------------------------- report
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`check-docs-parity: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(
  `check-docs-parity: ok (${toolNames.length} tools, ${promptNames.length} prompts, ${resourceCount} resources, ${skillNames.length} skills, ${commandNames.length} commands, ${templateNames.length} templates, ${registryAddrs.size} registry addresses, ${docAddrs.size} in address-map, ${claims} count claims, ${docMd.length} docs pages scanned)`,
);
