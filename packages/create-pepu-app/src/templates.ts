import registry from "./templates.json";

/** What a template demonstrates. Shown as chips in the picker and in `--json`. */
export type TemplateFeature = "login" | "session" | "sponsor";

export const FEATURE_LABELS: Record<TemplateFeature, string> = {
  login: "sign-in + embedded wallet",
  session: "session keys",
  sponsor: "sponsored gas",
};

export interface TemplateInfo {
  name: string;
  title: string;
  description: string;
  features: TemplateFeature[];
  /** Mirrors `TEMPLATE_REQUIREMENTS` in `@pepu-chain/sdk/doctor` (a test keeps them equal). */
  requiredEnv: string[];
  optionalEnv: string[];
  /** Keys into `PEPU_PRIVY_REQUIREMENTS` (`@pepu-chain/sdk/privy`). */
  privyDashboard: string[];
  /** Template-specific manual steps. `{run:<script>}` expands to the package manager's run command. */
  extraSteps: string[];
  hasContracts: boolean;
  difficulty: "starter" | "intermediate" | "advanced";
  recommendedFor: string;
  /** The template ships MCP/agent files (`AGENTS.md`, `CLAUDE.md`). */
  mcp: boolean;
}

/**
 * Every template this CLI can scaffold, in interactive-picker order.
 *
 * The single source of truth is `src/templates.json`. It is also read by
 * `scripts/sync-assets.mjs` (which `templates/<name>` directories get
 * bundled), and `test/template-registry.test.ts` fails if a directory under
 * the repo's `templates/` is not listed there. To add a template: create
 * `templates/<name>/` and add one entry to the JSON. To drop one: delete its
 * entry (see README "Removing a template").
 */
export const TEMPLATES: readonly TemplateInfo[] = registry as TemplateInfo[];

export const DEFAULT_TEMPLATE = "consumer-app";

export function findTemplate(name: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

/** "sign-in + embedded wallet, session keys, sponsored gas" */
export function featureSummary(t: Pick<TemplateInfo, "features">, sep = " + "): string {
  return t.features.map((p) => FEATURE_LABELS[p]).join(sep);
}
