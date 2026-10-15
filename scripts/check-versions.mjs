#!/usr/bin/env node
// Version lock-step check.
//
//   - .claude-plugin/plugin.json, marketplace.json (top level) and the marketplace plugin entry share one version.
//   - packages/mcp/server.json matches packages/mcp/package.json (top level and packages[]).
//   - @pepu-chain/mcp depends on the workspace SDK (`workspace:*`, which `pnpm pack` rewrites to the exact SDK version), so a
//     packed MCP always pins the SDK version in this repository.
//   - When create-pepu-app's vendored SDK copy exists (built by `pnpm --filter create-pepu-app build`), it is the same version.
//   - Prints the SDK, MCP, CLI and plugin versions for the release record.
//
// Usage: node scripts/check-versions.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const failures = [];
const expectEqual = (label, a, b) => {
  if (a !== b) failures.push(`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

const plugin = read(".claude-plugin/plugin.json");
const market = read(".claude-plugin/marketplace.json");
const entry = (market.plugins ?? []).find((p) => p.name === plugin.name);
if (!entry) failures.push(`marketplace.json has no plugin entry named "${plugin.name}"`);

expectEqual("plugin.json version vs marketplace.json version", plugin.version, market.version);
if (entry) expectEqual("plugin.json version vs marketplace plugin entry version", plugin.version, entry.version);

const mcpPkg = read("packages/mcp/package.json");
const server = read("packages/mcp/server.json");
expectEqual("mcp server.json version vs package.json version", server.version, mcpPkg.version);
for (const [i, p] of (server.packages ?? []).entries()) {
  expectEqual(`mcp server.json packages[${i}].version vs package.json version`, p.version, mcpPkg.version);
}

const sdk = read("packages/sdk/package.json");
const cli = read("packages/create-pepu-app/package.json");

const mcpSdkDep = mcpPkg.dependencies?.["@pepu-chain/sdk"];
if (mcpSdkDep !== "workspace:*" && mcpSdkDep !== sdk.version) {
  failures.push(`mcp depends on @pepu-chain/sdk ${JSON.stringify(mcpSdkDep)}, expected "workspace:*" or "${sdk.version}"`);
}
if (existsSync(join(root, "packages/create-pepu-app/vendor/pepu-sdk/package.json"))) {
  expectEqual("create-pepu-app vendored SDK version vs sdk package.json version", read("packages/create-pepu-app/vendor/pepu-sdk/package.json").version, sdk.version);
}

console.log(
  `versions: plugin ${plugin.version}, sdk ${sdk.version}, mcp ${mcpPkg.version}, create-pepu-app ${cli.version}`,
);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("version lock-step ok");
