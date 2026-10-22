#!/usr/bin/env node
import path from "node:path";
import { readFile } from "node:fs/promises";
import { CliArgsError, HELP_TEXT, parseArgs, type CliArgs } from "./cli-args.js";
import { detectPackageManager, installCommand } from "./package-manager.js";
import * as ui from "./prompts.js";
import { DEFAULT_TEMPLATE, TEMPLATES, findTemplate, featureSummary } from "./templates.js";
import { isSafeTargetDir, toPackageName } from "./fs-utils.js";
import { packageRoot, scaffold, type ScaffoldResult } from "./scaffold.js";
import { gitInit, runInstall } from "./post.js";
import { parseEnv } from "./env.js";
import { buildGuidance, type TemplateGuidance } from "./steps.js";
import { color, fail, info, step, warn } from "./print.js";

async function readCliVersion(): Promise<string> {
  const pkgPath = path.join(packageRoot, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

/** The `--json` result. Key names only, never env values. */
export interface JsonResult {
  ok: true;
  /** Absolute path of the new project. */
  path: string;
  targetDir: string;
  template: string;
  title: string;
  features: string[];
  packageManager: string;
  sdk: { mode: "vendor" | "npm"; spec?: string; fellBackToVendor: boolean };
  installed: boolean;
  gitInitialized: boolean;
  envFile?: string;
  /** Env vars the template needs, with whether the scaffold left them blank. */
  requiredEnv: Array<{ key: string; secret: boolean; missing: boolean }>;
  missingEnv: string[];
  privyDashboard: Array<{ id: string; label: string; fix: string }>;
  nextSteps: string[];
  agentFiles: string[];
  warnings: string[];
}

function emitJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function failJson(message: string, extra: Record<string, unknown> = {}): void {
  emitJson({ ok: false, error: message, ...extra });
  process.exitCode = 1;
}

/** Path for `cd`: relative when inside cwd, absolute otherwise; quoted if it has spaces. */
function displayDir(targetDir: string): string {
  const rel = path.relative(process.cwd(), targetDir);
  const shown = rel === "" ? "." : rel.startsWith("..") || path.isAbsolute(rel) ? targetDir : rel;
  return /s/.test(shown) ? `"${shown}"` : shown;
}

async function hasDoctorScript(targetDir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return typeof pkg.scripts?.doctor === "string";
  } catch {
    return false;
  }
}

async function readEnvLocal(targetDir: string): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(path.join(targetDir, ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantsJson = argv.includes("--json");

  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliArgsError) {
      if (wantsJson) failJson(error.message);
      else fail(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (args.version) {
    console.log(await readCliVersion());
    return;
  }

  if (args.list) {
    if (args.json) {
      emitJson({ ok: true, templates: TEMPLATES });
    } else {
      for (const t of TEMPLATES) {
        console.log(`${t.name.padEnd(24)}${featureSummary(t, ", ")}`);
        console.log(`${"".padEnd(24)}${t.description}`);
      }
    }
    return;
  }

  const json = args.json;
  // No TTY (CI, piped input) or --json behaves like --yes rather than hanging
  // on a question no one is there to answer.
  const interactive = !json && args.yes !== true && process.stdin.isTTY === true;

  const report = {
    step: (m: string) => (json ? undefined : step(m)),
    warn: (m: string) => (json ? undefined : warn(m)),
  };
  const warnings: string[] = [];

  if (interactive) ui.intro(`${color.bold("create-pepu-app")} - Pepe Unchained V2 (chain 97741)`);

  // Only prompt for a template when the caller didn't already pick one.
  const templateName =
    interactive && !args.templateExplicit
      ? await ui.promptTemplate(DEFAULT_TEMPLATE, TEMPLATES)
      : args.template;

  const template = findTemplate(templateName);
  if (!template) {
    if (json) {
      failJson(`Unknown template "${templateName}".`, { templates: TEMPLATES.map((t) => t.name) });
      return;
    }
    fail(`Unknown template "${templateName}".`);
    console.log("Available templates:");
    for (const t of TEMPLATES) {
      console.log(`  ${t.name} - ${featureSummary(t, ", ")}: ${t.description}`);
    }
    process.exitCode = 1;
    return;
  }

  const defaultProjectName = args.directory ? path.basename(path.resolve(args.directory)) : "pepu-app";
  // Non-interactive must NOT fall back to the raw `args.directory`: a path
  // such as "./apps/my-app" would be slugified segment by segment into the
  // package name. `defaultProjectName` is already the basename.
  const projectName = interactive ? await ui.promptProjectName(defaultProjectName) : defaultProjectName;

  const targetDir = path.resolve(args.directory ?? toPackageName(projectName));

  const detectedPm = detectPackageManager();
  const packageManager =
    args.packageManager ?? (interactive ? await ui.promptPackageManager(detectedPm) : detectedPm);

  if (!(await isSafeTargetDir(targetDir))) {
    const rel = path.relative(process.cwd(), targetDir) || targetDir;
    if (json) {
      failJson(`"${rel}" already exists and isn't empty.`);
      return;
    }
    fail(`"${rel}" already exists and isn't empty.`);
    info("Choose a different directory, or empty it first.");
    process.exitCode = 1;
    return;
  }

  const wantInstall = args.install ?? (interactive ? await ui.promptConfirm(`Install dependencies with ${packageManager}?`, true) : true);
  const wantGit = args.git ?? (interactive ? await ui.promptConfirm("Initialize a git repository?", true) : true);

  if (!json && !interactive) {
    console.log("");
    console.log(`${color.bold("create-pepu-app")} - scaffolding ${color.cyan(template.name)} (${featureSummary(template, ", ")})`);
    console.log("");
  }

  const result: ScaffoldResult = await scaffold({
    targetDir,
    projectName,
    template: template.name,
    packageManager,
    sdk: args.sdk,
    skipAgentFiles: args.skipAgentFiles,
  });

  const relDir = displayDir(result.targetDir);
  const say = interactive ? ui.logStep : report.step;
  const sayWarn = interactive ? ui.logWarn : report.warn;

  say(`Created ${relDir}`);
  say(`Set package.json name to "${toPackageName(projectName)}"`);
  if (result.sdkFellBack) {
    const m = "@pepu-chain/sdk is not on npm yet (or npm is offline), so --sdk npm fell back to the vendored copy.";
    warnings.push(m);
    sayWarn(m);
  }
  if (result.sdkMode === "vendor") {
    if (result.vendoredSdk) {
      say("Vendored @pepu-chain/sdk into vendor/pepu-sdk");
    } else {
      const m = "Could not find a vendored @pepu-chain/sdk to bundle. Dependency install may fail until the SDK is published or vendored.";
      warnings.push(m);
      sayWarn(m);
    }
  } else {
    say(`Using @pepu-chain/sdk ${result.sdkSpec ?? ""} from npm`);
  }
  if (result.envFile) say("Generated .env.local from .env.example (network details filled in, secrets left blank)");
  if (result.agentFiles.length > 0) say(`Agent files: ${result.agentFiles.join(", ")}`);

  let installed = false;
  if (wantInstall) {
    if (interactive) {
      const s = ui.spinner();
      s.start(`Installing dependencies with ${packageManager}`);
      installed = await runInstall(result.targetDir, packageManager, true);
      s.stop(installed ? "Dependencies installed" : "Install failed");
    } else {
      if (!json) info(`Running ${installCommand(packageManager)} ...`);
      installed = await runInstall(result.targetDir, packageManager, json);
    }
    if (!installed) {
      const m = `Dependency install failed. Run "${installCommand(packageManager)}" in ${relDir} to see why.`;
      warnings.push(m);
      sayWarn(m);
    }
  }

  let gitInitialized = false;
  if (wantGit) {
    const g = gitInit(result.targetDir);
    gitInitialized = g.initialized;
    if (g.initialized) say("Initialized a git repository");
    else if (g.reason !== "already inside a git repository") {
      warnings.push(`Skipped git init: ${g.reason}.`);
      sayWarn(`Skipped git init: ${g.reason}.`);
    }
  }

  const guidance: TemplateGuidance = buildGuidance({
    template,
    env: await readEnvLocal(result.targetDir),
    packageManager,
    relativeDir: relDir,
    installed,
    hasDoctor: await hasDoctorScript(result.targetDir),
  });

  if (json) {
    const out: JsonResult = {
      ok: true,
      path: result.targetDir,
      targetDir: result.targetDir,
      template: template.name,
      title: template.title,
      features: template.features,
      packageManager,
      sdk: { mode: result.sdkMode, ...(result.sdkSpec ? { spec: result.sdkSpec } : {}), fellBackToVendor: result.sdkFellBack },
      installed,
      gitInitialized,
      ...(result.envFile ? { envFile: result.envFile } : {}),
      requiredEnv: guidance.requiredEnv,
      missingEnv: guidance.missingEnv,
      privyDashboard: guidance.privyDashboard,
      nextSteps: guidance.nextSteps,
      agentFiles: result.agentFiles,
      warnings,
    };
    emitJson(out);
    return;
  }

  const numbered = guidance.nextSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  if (interactive) {
    ui.note(numbered, "Next steps");
    ui.outro(`Done. ${template.title} is ready in ${relDir}.`);
  } else {
    console.log("");
    console.log(color.bold("Next steps:"));
    for (const line of numbered.split("\n")) console.log(`  ${line}`);
    console.log("");
    info("The app runs and shows a setup screen even before you add a Privy App ID.");
    console.log("");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--json")) failJson(message);
  else fail(message);
  process.exitCode = 1;
});
