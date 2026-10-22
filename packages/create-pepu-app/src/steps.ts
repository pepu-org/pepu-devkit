import { TEMPLATE_REQUIREMENTS } from "@pepu-chain/sdk/doctor";
import { PEPU_PRIVY_REQUIREMENTS } from "@pepu-chain/sdk/privy";
import { isSecretEnvKey } from "./env.js";
import { installCommand, runScriptCommand, type PackageManagerName } from "./package-manager.js";
import type { TemplateInfo } from "./templates.js";

export interface PrivyDashboardItem {
  id: string;
  label: string;
  fix: string;
}

export interface RequiredEnvItem {
  key: string;
  secret: boolean;
  /** True when the scaffold left it blank and you must set it. */
  missing: boolean;
}

export interface TemplateGuidance {
  requiredEnv: RequiredEnvItem[];
  missingEnv: string[];
  /** Groups where at least one must be set, and none is yet. */
  missingAnyOf: string[][];
  privyDashboard: PrivyDashboardItem[];
  nextSteps: string[];
}

export interface GuidanceInput {
  template: TemplateInfo;
  /** Parsed `.env.local` (values stay in memory; only key names are reported). */
  env: Record<string, string>;
  packageManager: PackageManagerName;
  /** `cd` target relative to cwd, or "." */
  relativeDir: string;
  installed: boolean;
  /** The scaffold has a `doctor` npm script. */
  hasDoctor: boolean;
}

/** Requirements from the SDK doctor (the source of truth), falling back to the registry. */
export function requirementsFor(template: TemplateInfo) {
  const sdk = TEMPLATE_REQUIREMENTS[template.name];
  return {
    requiredEnv: sdk?.requiredEnv ?? template.requiredEnv,
    optionalEnv: sdk?.optionalEnv ?? template.optionalEnv,
    requiredAnyOf: sdk?.requiredAnyOf ?? [],
    privyDashboard: sdk?.privyDashboard ?? template.privyDashboard,
  };
}

export function privyDashboardItems(keys: readonly string[]): PrivyDashboardItem[] {
  return keys.map((id) => {
    const row = PEPU_PRIVY_REQUIREMENTS.find((r) => r.id === id);
    return row ? { id, label: row.label, fix: row.fix } : { id, label: id, fix: "See https://docs.pepeunchained.com/privy" };
  });
}

export function expandStep(step: string, pm: PackageManagerName): string {
  return step.replace(/\{run:([a-z0-9:_-]+)\}/gi, (_, script: string) => runScriptCommand(pm, script));
}

export function buildGuidance(input: GuidanceInput): TemplateGuidance {
  const req = requirementsFor(input.template);
  const requiredEnv: RequiredEnvItem[] = req.requiredEnv.map((key) => ({
    key,
    secret: isSecretEnvKey(key),
    missing: (input.env[key] ?? "") === "",
  }));
  const missingEnv = requiredEnv.filter((e) => e.missing).map((e) => e.key);
  const missingAnyOf = req.requiredAnyOf.filter((group) => group.every((k) => (input.env[k] ?? "") === ""));
  const dashboard = privyDashboardItems(req.privyDashboard);

  const steps: string[] = [];
  steps.push(`cd ${input.relativeDir}`);
  if (!input.installed) steps.push(installCommand(input.packageManager));
  if (missingEnv.length > 0) {
    steps.push(`Set these in .env.local: ${missingEnv.join(", ")}. Secrets stay server-side and out of git.`);
  }
  for (const group of missingAnyOf) steps.push(`Set at least one of ${group.join(" or ")} in .env.local.`);
  if (dashboard.length > 0) {
    steps.push(
      "In the Privy dashboard (https://dashboard.privy.io): " +
        dashboard.map((d) => d.label.replace(/\.$/, "")).join("; ") +
        ".",
    );
  }
  for (const extra of input.template.extraSteps) steps.push(expandStep(extra, input.packageManager));
  if (input.hasDoctor) steps.push(`${runScriptCommand(input.packageManager, "doctor")} to check your setup`);
  steps.push(runScriptCommand(input.packageManager, "dev"));

  return { requiredEnv, missingEnv, missingAnyOf, privyDashboard: dashboard, nextSteps: steps };
}
