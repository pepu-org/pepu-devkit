/**
 * @pepu-chain/sdk/doctor (node/any). Project readiness checks. Never returns
 * or logs env values: presence and length only.
 */
import { checkChainRpc, checkPrivyAppIdFormat, checkSponsorshipEndpoints } from "./doctor/checks.js";
import { checkPepuEnv } from "./doctor/env.js";
import { TEMPLATE_REQUIREMENTS } from "./doctor/requirements.js";
import type { DoctorCheck, DoctorReport, Pillar, PrivyDashboardChecker } from "./doctor/types.js";

export { checkPepuEnv, PRIVY_APP_ID_PATTERN } from "./doctor/env.js";
export { checkChainRpc, checkPrivyAppIdFormat, checkSponsorshipEndpoints } from "./doctor/checks.js";
export { TEMPLATE_REQUIREMENTS } from "./doctor/requirements.js";
export { generatePrivyAuthorizationKey } from "./doctor/auth-key.js";
export type { PrivyAuthorizationKeyPair } from "./doctor/auth-key.js";
export type {
  CheckStatus,
  DoctorCheck,
  DoctorReport,
  EnvCheckResult,
  EnvItem,
  EnvItemStatus,
  Pillar,
  PrivyDashboardChecker,
  PrivyDashboardRequirementKey,
  TemplateRequirement,
} from "./doctor/types.js";

export interface RunDoctorOptions {
  env: Record<string, string | undefined>;
  template?: string;
  pillars?: Pillar[];
  /** Override fetch (tests, proxies). */
  fetch?: typeof fetch;
  /** Skip network checks (RPC, bundler, paymaster, Privy dashboard). */
  offline?: boolean;
  /** WP-B1's `checkPrivyDashboardConfig`, wrapped to this signature. Skipped when absent. */
  checkPrivyDashboard?: PrivyDashboardChecker;
  /**
   * The page origin (scheme, host and port) to check against Privy's Allowed
   * origins, for example `http://localhost:3000`. Without it the
   * allowed-origins check can only warn.
   */
  origin?: string;
}

/**
 * Run every readiness check and return a report. Env values never appear in it.
 *
 * @example
 * ```ts
 * const report = await runDoctor({ env: process.env, template: "sponsored-session-app" });
 * if (!report.ok) console.log(report.checks.filter((c) => c.status === "fail"));
 * ```
 */
export async function runDoctor(o: RunDoctorOptions): Promise<DoctorReport> {
  const f = o.fetch ?? fetch;
  const req = o.template ? TEMPLATE_REQUIREMENTS[o.template] : undefined;
  const checks: DoctorCheck[] = [];
  if (o.template && !req) {
    checks.push({
      id: "template",
      status: "fail",
      message: `Unknown template "${o.template}".`,
      fix: `Use one of: ${Object.keys(TEMPLATE_REQUIREMENTS).join(", ")}.`,
    });
  }
  const env = checkPepuEnv({
    env: o.env,
    ...(req && o.template ? { template: o.template } : {}),
    ...(o.pillars ? { pillars: o.pillars } : {}),
  });
  for (const i of env.items) {
    if (i.status === "ok" || (i.status === "missing" && !i.required)) continue;
    checks.push({
      id: `env.${i.key}`,
      status: i.required ? "fail" : "warn",
      message: `${i.key} is ${i.status} (length ${i.length}).`,
      fix: i.fix,
    });
  }
  checks.push(checkPrivyAppIdFormat(o.env.NEXT_PUBLIC_PRIVY_APP_ID));

  const pillars = o.pillars ?? req?.pillars ?? [];
  if (o.offline) {
    checks.push({ id: "network", status: "skip", message: "Network checks skipped (offline)." });
  } else {
    const rpcUrl = o.env.PEPU_RPC_URL?.trim() || o.env.NEXT_PUBLIC_PEPU_RPC_URL?.trim() || undefined;
    checks.push(await checkChainRpc({ ...(rpcUrl ? { rpcUrl } : {}), fetch: f }));
    if (pillars.includes("sponsorship")) {
      checks.push(...(await checkSponsorshipEndpoints({ env: o.env, fetch: f })));
    }
    const appId = o.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
    if (o.checkPrivyDashboard && req && appId) {
      const secret = o.env.PRIVY_APP_SECRET?.trim();
      checks.push(
        ...(await o.checkPrivyDashboard({
          appId,
          requirementKeys: req.privyDashboard,
          ...(secret ? { appSecret: secret } : {}),
          ...(o.origin ? { origin: o.origin } : {}),
          fetch: f,
        })),
      );
    } else {
      checks.push({
        id: "privy.dashboard",
        status: "skip",
        message: "Privy dashboard check not run (no checker injected, unknown template, or no app id).",
      });
    }
  }
  return { ok: checks.every((c) => c.status !== "fail"), checks, env };
}
