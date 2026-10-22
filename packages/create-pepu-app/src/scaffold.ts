import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCommand } from "./exec.js";
import { copyDir, restoreDotfiles, toPackageName } from "./fs-utils.js";
import { buildEnvLocal } from "./env.js";
import type { PackageManagerName } from "./package-manager.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The installed create-pepu-app package's own root (parent of dist/). */
export const packageRoot = path.join(here, "..");

export type SdkMode = "vendor" | "npm";

/**
 * Agent files a scaffold may carry. Present in a template (or filled in from
 * the shared `templates/_agent` kit when a template lacks them).
 */
export const AGENT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/mcp.json",
  ".vscode/mcp.json",
  ".claude/settings.json",
] as const;

export interface ScaffoldOptions {
  targetDir: string;
  projectName: string;
  template: string;
  packageManager: PackageManagerName;
  /**
   * How the scaffold depends on `@pepu-chain/sdk`. Default `npm`: a semver range from
   * the registry. If the SDK cannot be resolved on npm (unpublished or offline)
   * the scaffold falls back to `vendor`, a `file:` reference to a bundled copy.
   */
  sdk?: SdkMode;
  /** Drop `AGENTS.md`, `CLAUDE.md` and the editor MCP files. */
  skipAgentFiles?: boolean;
  /** Shared agent kit directory (default: the bundled `templates/_agent`). */
  agentKitDir?: string;
  /** Test seam: does `@pepu-chain/sdk@<version>` resolve on the npm registry? */
  npmHasSdk?: (version: string) => boolean;
}

export interface ScaffoldResult {
  targetDir: string;
  vendoredSdk: boolean;
  /** The SDK mode actually used (`npm` falls back to `vendor` when unpublished or offline). */
  sdkMode: SdkMode;
  /** The `@pepu-chain/sdk` dependency spec written to package.json (undefined if the template has none). */
  sdkSpec?: string;
  sdkFellBack: boolean;
  /** Agent files present in the scaffold, relative to `targetDir`. */
  agentFiles: string[];
  /** `.env.local`, when generated. Holds public network values only; secrets stay blank. */
  envFile?: string;
}

/**
 * `npm view @pepu-chain/sdk@<version> version` prints the version only when that
 * exact release is published and reachable. Checking the package alone is not
 * enough: an older release would pass while `^<version>` still fails to install.
 */
export function npmHasPepuSdk(version: string): boolean {
  try {
    const { command, args, shell } = resolveCommand("npm", ["view", `@pepu-chain/sdk@${version}`, "version"]);
    const res = spawnSync(command, args, { encoding: "utf8", timeout: 15_000, shell });
    return res.status === 0 && (res.stdout ?? "").trim().length > 0;
  } catch {
    return false;
  }
}

async function readVendoredSdkVersion(): Promise<string | undefined> {
  const p = path.join(packageRoot, "vendor", "pepu-sdk", "package.json");
  if (!existsSync(p)) return undefined;
  const pkg = JSON.parse(await readFile(p, "utf8")) as { version?: string };
  return pkg.version;
}

/**
 * Copies the template into `targetDir`, then applies the mechanical rewrites a
 * scaffolded project needs to stand on its own outside this monorepo:
 *
 *   1. package.json `name` -> a slug of the project name.
 *   2. `"@pepu-chain/sdk": "workspace:*"` -> `file:./vendor/pepu-sdk` (`--sdk vendor`,
 *      or the fallback when npm has no SDK) or `^<version>` (default `npm`).
 *   3. `.env.example` -> `.env.local` with the public network values filled in
 *      and every secret left blank.
 *   4. Agent files (`AGENTS.md`, `CLAUDE.md`, editor MCP files, ...) are kept, or
 *      filled in from the shared kit, or dropped with `skipAgentFiles`.
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const templateDir = path.join(packageRoot, "templates", options.template);
  if (!existsSync(templateDir)) {
    throw new Error(`Template "${options.template}" was not found at ${templateDir}`);
  }

  await copyDir(templateDir, options.targetDir);
  await restoreDotfiles(options.targetDir);

  const wanted: SdkMode = options.sdk ?? "npm";
  const version = await readVendoredSdkVersion();
  let sdkMode: SdkMode = wanted;
  let sdkFellBack = false;
  if (wanted === "npm" && (!version || !(options.npmHasSdk ?? npmHasPepuSdk)(version))) {
    sdkMode = "vendor";
    sdkFellBack = true;
  }

  const sdkSpec = await rewritePackageJson(
    options.targetDir,
    options.projectName,
    sdkMode === "npm" ? `^${version}` : "file:./vendor/pepu-sdk",
  );

  const vendoredSdk = sdkMode === "vendor" ? await vendorPepuSdk(options.targetDir) : false;

  const envFile = await generateEnvLocal(options.targetDir);

  const agentFiles = await applyAgentFiles(
    options.targetDir,
    options.skipAgentFiles === true,
    options.agentKitDir ?? path.join(packageRoot, "templates", "_agent"),
  );

  return { targetDir: options.targetDir, vendoredSdk, sdkMode, sdkSpec, sdkFellBack, agentFiles, envFile };
}

async function rewritePackageJson(
  targetDir: string,
  projectName: string,
  sdkSpec: string,
): Promise<string | undefined> {
  const pkgPath = path.join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;

  pkg.name = toPackageName(projectName);

  let written: string | undefined;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[field] as Record<string, string> | undefined;
    if (deps?.["@pepu-chain/sdk"] === "workspace:*") {
      deps["@pepu-chain/sdk"] = sdkSpec;
      written = sdkSpec;
    }
  }

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return written;
}

async function vendorPepuSdk(targetDir: string): Promise<boolean> {
  const vendorSrc = path.join(packageRoot, "vendor", "pepu-sdk");
  if (!existsSync(vendorSrc)) return false;

  const vendorDest = path.join(targetDir, "vendor", "pepu-sdk");
  await copyDir(vendorSrc, vendorDest);
  return true;
}

async function generateEnvLocal(targetDir: string): Promise<string | undefined> {
  const examplePath = path.join(targetDir, ".env.example");
  const localPath = path.join(targetDir, ".env.local");
  if (!existsSync(examplePath) || existsSync(localPath)) return undefined;
  await writeFile(localPath, buildEnvLocal(await readFile(examplePath, "utf8")));
  return ".env.local";
}

async function applyAgentFiles(targetDir: string, skip: boolean, kit: string): Promise<string[]> {
  if (skip) {
    for (const rel of AGENT_FILES) await rm(path.join(targetDir, rel), { force: true });
    return [];
  }
  for (const rel of AGENT_FILES) {
    const dest = path.join(targetDir, rel);
    const src = path.join(kit, rel);
    if (!existsSync(dest) && existsSync(src)) {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }
  }
  return AGENT_FILES.filter((rel) => existsSync(path.join(targetDir, rel)));
}
