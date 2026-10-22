/**
 * pepu_scaffold_app
 *
 * WHAT: Creates a PEPU Next.js app by running the create-pepu-app CLI
 * (`--yes --json`) in a directory the caller names. It never reimplements the
 * scaffold: the CLI owns the template files, the SDK vendoring and the
 * .env.local it generates.
 *
 * SAFETY: the directory must be an absolute path that does not exist or is
 * empty (a non-empty folder is refused, nothing is overwritten); `..`,
 * filesystem roots and system folders are refused; arguments are passed as an
 * array (no shell string) except for the `npx` fallback on Windows, where the
 * path is restricted to a safe character set. Optional env values are written
 * only to the new project's .env.local and never echoed.
 *
 * CLI discovery: PEPU_CREATE_APP_BIN (a JS file), then the monorepo's built
 * packages/create-pepu-app/dist/index.js, then `npx -y create-pepu-app@latest`.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PEPU_ENV, resolvePepuEndpoints } from "@pepu-chain/sdk";
import { PRIVY_APP_ID_PATTERN, checkPepuEnv, TEMPLATE_REQUIREMENTS } from "@pepu-chain/sdk/doctor";
import { PRIVY_ENV } from "@pepu-chain/sdk/privy";
import { annotate } from "../annotations.js";
import { readEnvFile, upsertEnvFile } from "../env-file.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { assertNewOrEmptyDirectory } from "../safe-path.js";
import { TEMPLATE_REGISTRY } from "../snapshots.js";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], opts: { timeoutMs: number }) => Promise<RunResult>;

const defaultRunner: CommandRunner = (command, args, { timeoutMs }) =>
  new Promise((resolve) => {
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, { shell: useShell, windowsHide: true, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

let runner: CommandRunner = defaultRunner;

/** Test seam: replace (or with `null` restore) the process runner. */
export function setCommandRunner(next: CommandRunner | null): void {
  runner = next ?? defaultRunner;
}

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
const SAFE_SHELL_PATH = /^[A-Za-z0-9_\-.:\\/ @+]+$/;

function findLocalCli(): string | undefined {
  const override = process.env["PEPU_CREATE_APP_BIN"];
  if (override && fs.existsSync(override)) return override;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "packages", "create-pepu-app", "dist", "index.js");
    if (fs.existsSync(candidate)) return candidate;
    const sibling = path.join(dir, "..", "create-pepu-app", "dist", "index.js");
    if (fs.existsSync(sibling)) return path.resolve(sibling);
    dir = path.dirname(dir);
  }
  return undefined;
}

function lastJsonLine(text: string): Record<string, unknown> | undefined {
  const lines = text.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        const parsed: unknown = JSON.parse(t);
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        // keep looking
      }
    }
  }
  return undefined;
}

function installCommand(pm: string): string {
  return pm === "yarn" ? "yarn" : `${pm} install`;
}

function runCommand(pm: string, script: string): string {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

const inputSchema = {
  template: z.string().describe("Template name from pepu_list_templates, e.g. consumer-app or sponsored-session-app."),
  directory: z
    .string()
    .describe("ABSOLUTE path of the project folder to create. It must not exist or must be empty; the parent folder must exist. Relative paths and '..' are refused."),
  packageManager: z.enum(PACKAGE_MANAGERS).optional().describe("Package manager used in the printed commands (CLI --pm). Auto-detected when omitted."),
  privyAppId: z.string().optional().describe("Privy app id to write into .env.local as NEXT_PUBLIC_PRIVY_APP_ID (a public value, not a secret)."),
  bundlerUrl: z.string().url().optional().describe("Bundler URL to write into .env.local as PEPU_BUNDLER_URL. Never echoed back."),
  paymasterUrl: z.string().url().optional().describe("Paymaster URL to write into .env.local as PEPU_PAYMASTER_URL. It can embed a credential, so it is never echoed back."),
  dry_run: z.boolean().default(false).describe("Validate everything and show the command without creating anything."),
};

export function registerScaffoldAppTool(server: McpServer): void {
  server.registerTool(
    "pepu_scaffold_app",
    {
      title: "Scaffold a PEPU app",
      description:
        "Create a PEPU Next.js app by running the create-pepu-app CLI with --yes --json (the CLI vendors @pepu-chain/sdk and generates .env.local; this tool never reimplements it). The directory must be an absolute path that does not exist or is empty, so nothing is overwritten. Optionally writes privyAppId, bundlerUrl and paymasterUrl into the new .env.local (never echoed), then reports which env vars are still missing using checkPepuEnv from @pepu-chain/sdk/doctor. Pick the template with pepu_list_templates first. Use dry_run to preview.",
      inputSchema,
      annotations: annotate({ readOnly: false, destructive: false, idempotent: false, openWorld: true }),
    },
    async ({ template, directory, packageManager, privyAppId, bundlerUrl, paymasterUrl, dry_run }) => {
      const known = TEMPLATE_REGISTRY.map((t) => t.name);
      if (!known.includes(template)) {
        actionableError(`Unknown template "${template}".`, `Available templates: ${known.join(", ")}.`, "Call pepu_list_templates and pass one of those names.");
      }
      const target = assertNewOrEmptyDirectory(directory, "directory");
      if (privyAppId !== undefined && !PRIVY_APP_ID_PATTERN.test(privyAppId)) {
        actionableError("privyAppId does not look like a Privy app id.", "App ids are cuid-style: a leading 'c' then 20 to 29 lowercase letters or digits.", "Copy the App ID from the Privy dashboard (Settings, Basics).");
      }
      if (bundlerUrl !== undefined || paymasterUrl !== undefined) {
        // Validate through the SDK's own URL rules (names the env var, never the value).
        resolvePepuEndpoints({ ...(bundlerUrl !== undefined ? { bundlerUrl } : {}), ...(paymasterUrl !== undefined ? { paymasterUrl } : {}), env: {} });
      }

      const cliArgs = [target, "--template", template, "--yes"];
      if (packageManager) cliArgs.push("--pm", packageManager);

      const local = findLocalCli();
      const useNpx = !local;
      if (useNpx && process.platform === "win32" && !SAFE_SHELL_PATH.test(target)) {
        actionableError("That directory path has characters that are unsafe to pass through a Windows shell.", "The npx fallback needs a plain path.", "Use a path with letters, digits, spaces, dots, dashes and underscores only, or set PEPU_CREATE_APP_BIN.");
      }
      const command = local ? process.execPath : process.platform === "win32" ? "npx.cmd" : "npx";
      const baseArgs = local ? [local] : ["-y", "create-pepu-app@latest"];
      const shown = `${useNpx ? "npx -y create-pepu-app@latest" : "create-pepu-app"} <directory> --template ${template} --yes --json${packageManager ? ` --pm ${packageManager}` : ""}`;

      if (dry_run) {
        return jsonResult({
          dryRun: true,
          wouldCreate: target,
          command: shown,
          cliSource: useNpx ? "npx (downloads create-pepu-app@latest)" : "local build",
          envWrites: [
            ...(privyAppId !== undefined ? [PRIVY_ENV.appId] : []),
            ...(bundlerUrl !== undefined ? [PEPU_ENV.bundlerUrl] : []),
            ...(paymasterUrl !== undefined ? [PEPU_ENV.paymasterUrl] : []),
          ],
        });
      }

      const timeoutMs = 10 * 60 * 1000;
      let run = await runner(command, [...baseArgs, ...cliArgs, "--json"], { timeoutMs });
      if (run.code !== 0 && /unrecognized option "--json"/i.test(run.stdout + run.stderr)) {
        // An older create-pepu-app without --json: same scaffold, human-readable output.
        run = await runner(command, [...baseArgs, ...cliArgs], { timeoutMs });
      }
      if (run.code !== 0) {
        const tail = (run.stderr || run.stdout).trim().split(/\r?\n/).slice(-8).join("\n");
        actionableError("create-pepu-app failed.", `Exit code ${run.code ?? "none"}. Last output:\n${tail}`, "Fix the cause above and retry; the directory is untouched if it did not get created.");
      }

      if (!fs.existsSync(target) || fs.readdirSync(target).length === 0) {
        actionableError("create-pepu-app reported success but the folder is empty.", `Nothing was created in ${target}.`, "Run with dry_run to check the command, or run npx create-pepu-app manually to see its output.");
      }

      const envFile = path.join(target, ".env.local");
      const updates: Record<string, string> = {};
      if (privyAppId !== undefined) updates[PRIVY_ENV.appId] = privyAppId;
      if (bundlerUrl !== undefined) updates[PEPU_ENV.bundlerUrl] = bundlerUrl;
      if (paymasterUrl !== undefined) updates[PEPU_ENV.paymasterUrl] = paymasterUrl;
      if (Object.keys(updates).length > 0) upsertEnvFile(envFile, updates);

      const pm = packageManager ?? "npm";
      const envReport = checkPepuEnv({ env: readEnvFile(envFile), template });
      const missing = envReport.items.filter((i) => i.status !== "ok" && i.required).map((i) => ({ key: i.key, status: i.status, fix: i.fix }));
      const cli = lastJsonLine(run.stdout);

      return jsonResult({
        created: target,
        template,
        pillars: TEMPLATE_REQUIREMENTS[template]?.pillars ?? null,
        topLevelEntries: fs.readdirSync(target).slice(0, 40),
        envWritten: Object.keys(updates),
        envStillMissing: missing,
        ...(cli ? { cliResult: cli } : {}),
        nextSteps: [
          `cd ${target}`,
          installCommand(pm),
          "Set the missing env vars above in .env.local (pepu_check_env re-checks without printing values; pepu_check_privy_config verifies the Privy dashboard).",
          runCommand(pm, "dev"),
        ],
        sdkFunction: "checkPepuEnv (@pepu-chain/sdk/doctor)",
      });
    }
  );
}
