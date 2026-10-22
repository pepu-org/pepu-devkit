#!/usr/bin/env node
/**
 * Agent kit guard. Fails (exit 1) when, for any template:
 *   - a kit file is missing, or a JSON kit file does not parse;
 *   - a kit file differs from templates/_agent (run sync-agent-kit.mjs);
 *   - the pepu-agent-kit block in AGENTS.md is missing or stale;
 *   - the `doctor` npm script or scripts/doctor.mjs is missing.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TEMPLATES, VERBATIM, expectedAgentsMd, templatesRoot } from "./sync-agent-kit.mjs";

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`FAIL  ${msg}`);
};

for (const template of TEMPLATES) {
  const root = path.join(templatesRoot, template);
  for (const rel of VERBATIM) {
    const canonical = await readFile(path.join(templatesRoot, "_agent", rel)).catch(() => null);
    if (canonical === null) {
      fail(`_agent/${rel} is missing`);
      continue;
    }
    const copy = await readFile(path.join(root, rel)).catch(() => null);
    if (copy === null) {
      fail(`${template}/${rel} is missing`);
      continue;
    }
    if (rel.endsWith(".json")) {
      try {
        JSON.parse(copy.toString("utf8"));
      } catch {
        fail(`${template}/${rel} is not valid JSON`);
        continue;
      }
    }
    if (!canonical.equals(copy)) fail(`${template}/${rel} differs from _agent/${rel}`);
  }

  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8").catch(() => null);
  if (agents === null) fail(`${template}/AGENTS.md is missing`);
  else if ((await expectedAgentsMd(template, agents)) !== agents) {
    fail(`${template}/AGENTS.md pepu-agent-kit block is missing or stale`);
  }

  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (pkg.scripts?.doctor !== "node scripts/doctor.mjs") fail(`${template}: no "doctor" npm script`);
  if ((await readFile(path.join(root, "scripts", "doctor.mjs")).catch(() => null)) === null) {
    fail(`${template}/scripts/doctor.mjs is missing`);
  }
}

if (failed) {
  console.error("\ncheck-agent-kit failed (run: node templates/scripts/sync-agent-kit.mjs)");
  process.exit(1);
}
console.log("check-agent-kit passed");
