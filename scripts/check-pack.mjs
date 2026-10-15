#!/usr/bin/env node
/**
 * Pack check: the three publishable packages must install from their tarballs
 * the way a user's `npm install` will, before anything is published.
 *
 * 1. `pnpm pack` each package (pnpm, not npm, rewrites `workspace:` ranges, and
 *    runs each package's `prepack`, which copies the root LICENSE in).
 * 2. Asserts each tarball contains LICENSE, README.md and package.json, and
 *    that no dependency range in the packed package.json is `workspace:`.
 * 3. Installs the tarballs into an empty temp directory OUTSIDE the workspace,
 *    in publish order: SDK first, then MCP together with the SDK tarball (so
 *    MCP resolves `@pepu-chain/sdk` from the local tarball), then the CLI.
 * 4. Starts the installed MCP server over stdio and lists its tools, and runs
 *    `create-pepu-app --list --json`.
 *
 *   node scripts/check-pack.mjs [--skip-build] [--keep]
 *
 * Needs the packages built (`pnpm --filter @pepu-chain/sdk build`, then mcp
 * and create-pepu-app); `--skip-build` is accepted for symmetry and does
 * nothing here, since this script never builds. Exit code 1 on any failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const keep = process.argv.includes("--keep");
const env = { ...process.env, CI: "1", npm_config_fund: "false", npm_config_audit: "false" };

// Publish order matters: the SDK must resolve before MCP.
const PACKAGES = [
  { dir: "sdk", name: "@pepu-chain/sdk" },
  { dir: "mcp", name: "@pepu-chain/mcp" },
  { dir: "create-pepu-app", name: "create-pepu-app" },
];

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`ok   ${msg}`);

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", shell: isWin && cmd !== process.execPath, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
const tail = (r) => `${r.stdout}\n${r.stderr}`.trim().split("\n").slice(-40).join("\n");

const work = mkdtempSync(path.join(os.tmpdir(), "pepu-pack-"));
if (path.resolve(work).startsWith(root)) {
  console.error("temp directory is inside the workspace; set TMPDIR/TEMP elsewhere");
  process.exit(1);
}
const packDir = path.join(work, "tarballs");
const installDir = path.join(work, "consumer");
mkdirSync(packDir);
mkdirSync(installDir);
console.log(`working in ${work}`);

// 1 + 2: pack and inspect.
const tarballs = {};
for (const p of PACKAGES) {
  const pkgDir = path.join(root, "packages", p.dir);
  const before = new Set(readdirSync(packDir));
  const r = run("pnpm", ["pack", "--pack-destination", packDir], pkgDir);
  if (r.status !== 0) {
    fail(`pnpm pack ${p.name}\n${tail(r)}`);
    continue;
  }
  const file = readdirSync(packDir).find((f) => !before.has(f) && f.endsWith(".tgz"));
  if (!file) {
    fail(`pnpm pack ${p.name} produced no tarball`);
    continue;
  }
  const tgz = path.join(packDir, file);
  tarballs[p.dir] = tgz;

  const list = run("tar", ["-tzf", file], packDir);
  const entries = list.stdout.split(/\r?\n/).filter(Boolean).map((e) => e.replace(/^package\//, ""));
  for (const required of ["LICENSE", "README.md", "package.json"]) {
    if (entries.includes(required)) ok(`${p.name} tarball has ${required}`);
    else fail(`${p.name} tarball is missing ${required}`);
  }
  for (const banned of [/^\.env/, /(^|\/)node_modules\//, /\.tsbuildinfo$/, /(^|\/)\.next\//]) {
    const hit = entries.find((e) => banned.test(e));
    if (hit) fail(`${p.name} tarball contains ${hit}`);
  }

  const manifestText = run("tar", ["-xzOf", file, "package/package.json"], packDir).stdout;
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    fail(`${p.name}: packed package.json is not readable`);
    continue;
  }
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (String(range).startsWith("workspace:")) fail(`${p.name}: packed ${field}.${dep} is "${range}"`);
    }
  }
  const sdkRange = manifest.dependencies?.["@pepu-chain/sdk"];
  if (p.dir === "mcp") {
    if (sdkRange && !sdkRange.startsWith("workspace:")) ok(`${p.name} depends on @pepu-chain/sdk@${sdkRange} (rewritten)`);
    else fail(`${p.name}: @pepu-chain/sdk range is ${JSON.stringify(sdkRange)}`);
  }
  // The CLI vendors the SDK: its vendored package.json must not carry workspace: ranges either.
  if (p.dir === "create-pepu-app") {
    const vendored = run("tar", ["-xzOf", file, "package/vendor/pepu-sdk/package.json"], packDir).stdout;
    if (!vendored.trim()) fail(`${p.name}: vendor/pepu-sdk/package.json missing from tarball`);
    else if (vendored.includes("workspace:")) fail(`${p.name}: vendor/pepu-sdk/package.json contains a workspace: range`);
    else ok(`${p.name} vendored SDK manifest has no workspace: ranges`);
  }
}

if (failures.length === 0) {
  // 3: install in publish order into an empty directory.
  writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ name: "pack-check-consumer", version: "0.0.0", private: true }) + "\n");
  const install = (label, tgzs) => {
    const r = run("npm", ["install", "--no-fund", "--no-audit", ...tgzs], installDir);
    if (r.status !== 0) {
      fail(`npm install (${label})\n${tail(r)}`);
      return false;
    }
    ok(`npm install (${label})`);
    return true;
  };
  const sdkOk = install("sdk", [tarballs.sdk]);
  // MCP with the SDK tarball alongside, so `@pepu-chain/sdk` resolves locally, never from the registry.
  const mcpOk = sdkOk && install("mcp + sdk tarball", [tarballs.sdk, tarballs.mcp]);
  const cliOk = mcpOk && install("create-pepu-app", [tarballs["create-pepu-app"]]);

  if (mcpOk) {
    const sdkInstalled = path.join(installDir, "node_modules", "@pepu-chain", "sdk", "package.json");
    if (existsSync(sdkInstalled)) ok("@pepu-chain/sdk resolved from the local tarball");
    else fail("@pepu-chain/sdk is not installed after installing the MCP tarball");

    // 4a: start the installed MCP server over stdio and list tools.
    const smoke = path.join(installDir, "mcp-smoke.mjs");
    writeFileSync(
      smoke,
      `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bin = require.resolve("@pepu-chain/mcp/dist/index.js");
const client = new Client({ name: "pack-check", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin] }));
const { tools } = await client.listTools();
await client.close();
if (tools.length === 0) throw new Error("MCP server listed no tools");
console.log(JSON.stringify({ tools: tools.length, first: tools[0].name }));
`,
    );
    const m = run(process.execPath, [smoke], installDir);
    if (m.status === 0) ok(`installed MCP server lists tools ${m.stdout.trim()}`);
    else fail(`installed MCP server smoke\n${tail(m)}`);
  }

  if (cliOk) {
    // 4b: the installed CLI bin.
    const bin = path.join(installDir, "node_modules", "create-pepu-app", "dist", "index.js");
    const c = run(process.execPath, [bin, "--list", "--json"], installDir);
    try {
      const out = JSON.parse(c.stdout);
      if (c.status === 0 && out.ok === true && Array.isArray(out.templates) && out.templates.length > 0) {
        ok(`installed create-pepu-app --list --json (${out.templates.length} templates)`);
      } else fail(`create-pepu-app --list --json returned an unexpected result\n${tail(c)}`);
    } catch {
      fail(`create-pepu-app --list --json is not JSON\n${tail(c)}`);
    }
  }
}

if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
else console.log(`kept ${work}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) found.`);
  process.exit(1);
}
console.log("\npack check passed");
