/** Shared types for `@pepu-chain/sdk/doctor`. */

/** A capability a template demonstrates. Used to scope readiness checks. */
export type Pillar = "login" | "wallet" | "session" | "sponsorship" | "gate" | "mint";

/**
 * Key into the Privy dashboard requirements table owned by WP-B1
 * (`@pepu-chain/sdk/privy`). Doctor only carries the keys; it never
 * duplicates what each key means. Unknown keys must be reported by the
 * injected checker, not silently dropped.
 */
export type PrivyDashboardRequirementKey = string;

export interface TemplateRequirement {
  /** Env vars the template cannot run without. */
  requiredEnv: string[];
  /** Env vars with a working default or a degraded fallback. */
  optionalEnv: string[];
  /** Groups where at least one var must be valid (for example the gate addresses). */
  requiredAnyOf?: string[][];
  pillars: Pillar[];
  /** Privy dashboard settings the template needs, by WP-B1 requirement key. */
  privyDashboard: PrivyDashboardRequirementKey[];
}

export type EnvItemStatus = "ok" | "missing" | "placeholder" | "malformed";

/** One env var verdict. Reports presence and length only, never the value. */
export interface EnvItem {
  key: string;
  status: EnvItemStatus;
  /** True when the variable holds a credential. */
  secret: boolean;
  /** Character count of the trimmed value (0 when missing). Never the value. */
  length: number;
  required: boolean;
  fix: string;
}

export interface EnvCheckResult {
  ok: boolean;
  items: EnvItem[];
}

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  /** Never contains env values or URLs (paymaster URLs embed credentials). */
  message: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  env: EnvCheckResult | null;
}

/**
 * Injection point for WP-B1's `checkPrivyDashboardConfig`. It receives the
 * requirement keys this template needs and returns checks to merge in.
 */
export type PrivyDashboardChecker = (input: {
  appId: string;
  requirementKeys: PrivyDashboardRequirementKey[];
  /** Present only when PRIVY_APP_SECRET is set. Never log it. */
  appSecret?: string;
  /** The page origin to verify against Privy's Allowed origins, for example `http://localhost:3000`. */
  origin?: string;
  fetch: typeof fetch;
}) => Promise<DoctorCheck[]>;
