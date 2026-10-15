#!/usr/bin/env node
/**
 * Refreshes the generated asset directories this CLI ships inside its own
 * npm package:
 *
 *   templates/<name>/   <- mirrored from ../../templates/<name>, one per
 *                          entry in TEMPLATE_NAMES below
 *   vendor/pepu-sdk/    <- mirrored from ../sdk (dist/ + package.json)
 *
 * Why a vendored copy of @pepu-chain/sdk instead of a normal npm dependency:
 * @pepu-chain/sdk is not published to the npm registry yet (workspace-only,
 * `"@pepu-chain/sdk": "workspace:*"` in the template). A project scaffolded by
 * this CLI is installed *outside* the pnpm workspace, where `workspace:*`
 * cannot resolve at all. So this CLI bundles a built copy of the SDK and
 * rewrites the scaffolded project's dependency to a `file:` reference
 * (see src/scaffold.ts) — that's the "documented local-path fallback"
 * called for by this package's spec. Once @pepu-chain/sdk is published, this
 * script and src/scaffold.ts's rewrite logic should be updated to prefer
 * a real semver range instead.
 *
 * Hidden files (.mcp.json, .cursor/, .env.example, ...) are copied. npm never
 * packs `.gitignore`/`.npmrc`, so those are stored as `_gitignore`/`_npmrc`
 * (see sync-lib.mjs) and restored by src/scaffold.ts.
 *
 * Run via `pnpm sync` (or automatically before `pnpm build`). Requires
 * ../sdk to have already been built (`pnpm --filter @pepu-chain/sdk build`) —
 * this script does not build it for you.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { copyTemplateTree } from "./sync-lib.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, "..");
const repoRoot = path.join(packageRoot, "..", "..");

/**
 * Every template this CLI ships, mirrored from `templates/<name>` at the
 * repo root. Derived from `src/templates.json` - the single source of truth
 * shared with `src/templates.ts` (picker / --help / validation), so the two
 * can never disagree.
 */
const TEMPLATE_NAMES = JSON.parse(
  await readFile(path.join(packageRoot, "src", "templates.json"), "utf8"),
).map((t) => t.name);

async function syncTemplate(name) {
  const src = path.join(repoRoot, "templates", name);
  const dest = path.join(packageRoot, "templates", name);
  await copyTemplateTree(src, dest);
  console.log(`synced template: ${path.relative(repoRoot, src)} -> ${path.relative(repoRoot, dest)}`);
}

async function syncTemplates() {
  for (const name of TEMPLATE_NAMES) {
    await syncTemplate(name);
  }
  // Shared agent kit (templates/_agent: .mcp.json, CLAUDE.md, AGENTS.md ...).
  // The scaffolder uses it to fill in any agent file a template lacks.
  const agentSrc = path.join(repoRoot, "templates", "_agent");
  const agentDest = path.join(packageRoot, "templates", "_agent");
  if (existsSync(agentSrc)) {
    await copyTemplateTree(agentSrc, agentDest);
    console.log("synced shared agent kit: templates/_agent");
  } else {
    await rm(agentDest, { recursive: true, force: true });
  }
}

async function syncSdk() {
  const sdkRoot = path.join(repoRoot, "packages", "sdk");
  const sdkDist = path.join(sdkRoot, "dist");
  const dest = path.join(packageRoot, "vendor", "pepu-sdk");

  if (!existsSync(sdkDist)) {
    throw new Error(
      `@pepu-chain/sdk has not been built yet (missing ${sdkDist}). Run "pnpm --filter @pepu-chain/sdk build" first.`,
    );
  }

  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await cp(sdkDist, path.join(dest, "dist"), { recursive: true });

  const rawPkg = JSON.parse(await readFile(path.join(sdkRoot, "package.json"), "utf8"));
  // Trim to exactly what a consumer needs to resolve/install this as a
  // `file:` dependency — no devDependencies, no build scripts.
  const vendoredPkg = {
    name: rawPkg.name,
    version: rawPkg.version,
    description: rawPkg.description,
    license: rawPkg.license,
    type: rawPkg.type,
    sideEffects: rawPkg.sideEffects,
    main: rawPkg.main,
    module: rawPkg.module,
    types: rawPkg.types,
    exports: rawPkg.exports,
    files: rawPkg.files,
    peerDependencies: rawPkg.peerDependencies,
    peerDependenciesMeta: rawPkg.peerDependenciesMeta,
  };
  await writeFile(path.join(dest, "package.json"), JSON.stringify(vendoredPkg, null, 2) + "\n");

  console.log(`synced @pepu-chain/sdk@${rawPkg.version} (dist) -> ${path.relative(repoRoot, dest)}`);
}

await syncTemplates();
await syncSdk();
