#!/usr/bin/env node
/**
 * Scaffold check: the templates must build the way a user gets them, not the
 * way the monorepo lets them build.
 *
 * Builds the CLI, scaffolds every template with
 * `--yes --no-install --no-git --json` into a temp directory OUTSIDE the
 * workspace (so pnpm hoisting cannot hide a missing dependency), then runs
 * `npm install`, `npm run build` and `npm run typecheck` in each one.
 *
 *   node scripts/check-scaffolds.mjs                 all templates
 *   node scripts/check-scaffolds.mjs --only nft-mint one template (repeatable)
 *   node scripts/check-scaffolds.mjs --skip-build    reuse an already built CLI
 *   node scripts/check-scaffolds.mjs --keep          keep the temp directory
 *
 * Needs the SDK built first (`pnpm --filter @pepu-chain/sdk build`): the CLI
 * vendors its dist. Exit code 1 if any template fails.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(root, "packages", "create-pepu-app");
const cliBin = path.join(cliDir, "dist", "index.js");
const isWin = process.platform === "win32";

const argv = process.argv.slice(2);
const only = [];
let skipBuild = false;
let keep = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--only") only.push(argv[++i]);
  else if (argv[i] === "--skip-build") skipBuild = true;
  else if (argv[i] === "--keep") keep = true;
  else {
    console.error(`unknown argument: ${argv[i]}`);
    process.exit(2);
  }
}

const allTemplates = JSON.parse(readFileSync(path.join(cliDir, "src", "templates.json"), "utf8")).map((t) => t.name);
const templates = only.length > 0 ? only : allTemplates;
for (const t of templates) {
  if (!allTemplates.includes(t)) {
    console.error(`unknown template "${t}" (known: ${allTemplates.join(", ")})`);
    process.exit(2);
  }
}

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1", npm_config_fund: "false", npm_config_audit: "false" };

function run(cmd, args, cwd, label) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", shell: isWin && cmd !== process.execPath, maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-60).join("\n");
    return { ok: false, label, secs, tail };
  }
  return { ok: true, label, secs, stdout: r.stdout ?? "" };
}

const sdkDist = path.join(root, "packages", "sdk", "dist", "index.js");
if (!existsSync(sdkDist)) {
  console.error("SDK is not built. Run: pnpm --filter @pepu-chain/sdk build");
  process.exit(1);
}

if (!skipBuild) {
  console.log("building create-pepu-app ...");
  const b = run("pnpm", ["--filter", "create-pepu-app", "build"], root, "build cli");
  if (!b.ok) {
    console.error(b.tail);
    process.exit(1);
  }
}

// Outside the workspace: os.tmpdir(), never a path under the repo.
const work = mkdtempSync(path.join(os.tmpdir(), "pepu-scaffolds-"));
if (path.resolve(work).startsWith(root)) {
  console.error("temp directory is inside the workspace; set TMPDIR/TEMP elsewhere");
  process.exit(1);
}
console.log(`scaffolding into ${work}`);

const failures = [];
for (const name of templates) {
  const dir = path.join(work, name);
  console.log(`\n== ${name}`);
  const steps = [
    () => run(process.execPath, [cliBin, dir, "--template", name, "--yes", "--no-install", "--no-git", "--pm", "npm", "--json"], work, "scaffold"),
    () => run("npm", ["install", "--no-fund", "--no-audit"], dir, "npm install"),
    () => run("npm", ["run", "build"], dir, "npm run build"),
    () => run("npm", ["run", "typecheck"], dir, "npm run typecheck"),
  ];
  let ok = true;
  for (const step of steps) {
    const r = step();
    if (!r.ok) {
      console.log(`   FAIL ${r.label} (${r.secs}s)`);
      console.log(r.tail.replace(/^/gm, "     "));
      failures.push(`${name}: ${r.label}`);
      ok = false;
      break;
    }
    console.log(`   ok   ${r.label} (${r.secs}s)`);
    if (r.label === "scaffold") {
      try {
        const out = JSON.parse(r.stdout);
        if (out.ok === false) throw new Error("scaffold reported ok:false");
      } catch (e) {
        console.log(`   FAIL scaffold --json output is not an ok result: ${e.message}`);
        failures.push(`${name}: scaffold json`);
        ok = false;
        break;
      }
    }
  }
  if (ok) console.log(`   PASS ${name}`);
}

if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
else console.log(`\nkept ${work}`);

console.log(`\n${templates.length - new Set(failures.map((f) => f.split(":")[0])).size}/${templates.length} templates passed`);
if (failures.length > 0) {
  console.error(`FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
