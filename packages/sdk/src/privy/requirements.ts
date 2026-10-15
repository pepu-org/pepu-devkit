/**
 * Privy requirements table and dashboard check (`@pepu-chain/sdk/privy`).
 * Client-safe: no secrets, no Privy packages. Re-exported from `config.ts`.
 */

/** Environment variable names the Privy layer reads. Names only, never values. */
export const PRIVY_ENV = {
  appId: "NEXT_PUBLIC_PRIVY_APP_ID",
  appSecret: "PRIVY_APP_SECRET",
  authorizationKey: "PRIVY_AUTHORIZATION_KEY",
  keyQuorumId: "NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID",
} as const;

/**
 * Accepted fallback names, read only when the canonical {@link PRIVY_ENV} name
 * is empty. The canonical name is what docs, the doctor and error messages use.
 */
export const PRIVY_ENV_ALIASES = {
  appId: ["PRIVY_APP_ID"],
  appSecret: [],
  authorizationKey: [],
  keyQuorumId: ["PRIVY_KEY_QUORUM_ID"],
} as const satisfies Record<keyof typeof PRIVY_ENV, readonly string[]>;

/**
 * The subset of Privy's public app-config response this SDK looks at. Every
 * field is optional: the endpoint is undocumented, so a missing field means
 * "unknown", never "wrong".
 */
export interface PrivyPublicAppConfig {
  /** Origins the dashboard allows (scheme, host and port). */
  allowed_domains?: string[];
  /** Enabled login methods, e.g. `"google_oauth"`, `"email"`, `"wallet"`. */
  login_methods?: string[];
  embedded_wallet_config?: {
    ethereum?: { create_on_login?: string };
    [key: string]: unknown;
  };
  smart_wallet_config?: unknown;
  [key: string]: unknown;
}

/** Result of one requirement check. `"unknown"` means it could not be verified. */
export interface PrivyRequirementResult {
  ok: boolean | "unknown";
  detail: string;
}

/** One row of {@link PEPU_PRIVY_REQUIREMENTS}. */
export interface PrivyRequirement {
  id: string;
  where: "dashboard" | "env" | "code";
  label: string;
  required: boolean;
  pillars: ("login" | "session" | "sponsor")[];
  /** Only dashboard rows have a check, and it only sees Privy's public app config. */
  check?: (cfg: PrivyPublicAppConfig, ctx: { origin?: string }) => PrivyRequirementResult;
  fix: string;
  docsUrl: string;
}

const PRIVY_DOCS = "https://guide.pepeunchained.com/privy";

const normOrigin = (o: string): string => o.trim().replace(/\/+$/, "").toLowerCase();

/**
 * Everything a PEPU app needs from Privy, as one data table. It feeds the docs,
 * the MCP `pepu_check_privy_config` tool, the CLI `doctor` and in-app notices.
 *
 * @example
 * ```ts
 * import { PEPU_PRIVY_REQUIREMENTS } from "@pepu-chain/sdk/privy";
 * const forSessions = PEPU_PRIVY_REQUIREMENTS.filter((r) => r.pillars.includes("session"));
 * ```
 */
export const PEPU_PRIVY_REQUIREMENTS: readonly PrivyRequirement[] = [
  {
    id: "app-id",
    where: "env",
    label: `${PRIVY_ENV.appId} is set`,
    required: true,
    pillars: ["login", "session", "sponsor"],
    fix: `Copy the App ID from the Privy dashboard (Settings, Basics) into ${PRIVY_ENV.appId}.`,
    docsUrl: `${PRIVY_DOCS}#app-id`,
  },
  {
    id: "app-secret",
    where: "env",
    label: `${PRIVY_ENV.appSecret} is set (server only)`,
    required: true,
    pillars: ["login", "session", "sponsor"],
    fix: `Create an app secret in the Privy dashboard and put it in ${PRIVY_ENV.appSecret}. Never prefix it with NEXT_PUBLIC_.`,
    docsUrl: `${PRIVY_DOCS}#app-secret`,
  },
  {
    id: "allowed-origins",
    where: "dashboard",
    label: "The page origin (including the port) is in Allowed origins",
    required: true,
    pillars: ["login", "session", "sponsor"],
    check: (cfg, ctx) => {
      if (!ctx.origin) return { ok: "unknown", detail: "No origin was given to check." };
      if (!Array.isArray(cfg.allowed_domains)) {
        return { ok: "unknown", detail: "Privy did not report allowed origins." };
      }
      const want = normOrigin(ctx.origin);
      const hit = cfg.allowed_domains.some((d) => normOrigin(d) === want || normOrigin(d) === "*");
      return hit
        ? { ok: true, detail: `${ctx.origin} is allowed.` }
        : { ok: false, detail: `${ctx.origin} is not in Allowed origins.` };
    },
    fix: "Add the exact origin, scheme, host and port, to Privy dashboard, Configuration, App settings, Allowed origins. A different dev port counts as a different origin.",
    docsUrl: `${PRIVY_DOCS}#allowed-origins`,
  },
  {
    id: "login-methods",
    where: "dashboard",
    label: "At least one login method is enabled",
    required: true,
    pillars: ["login"],
    check: (cfg) => {
      if (!Array.isArray(cfg.login_methods)) {
        return { ok: "unknown", detail: "Privy did not report login methods." };
      }
      return cfg.login_methods.length > 0
        ? { ok: true, detail: `Enabled: ${cfg.login_methods.join(", ")}.` }
        : { ok: false, detail: "No login methods are enabled." };
    },
    fix: "Enable the methods you list in loginMethods under Privy dashboard, User management, Authentication. Methods not enabled there are hidden even if listed in code.",
    docsUrl: `${PRIVY_DOCS}#login-methods`,
  },
  {
    id: "login-methods.google",
    where: "dashboard",
    label: "Google login is enabled",
    required: false,
    pillars: ["login"],
    check: (cfg) => {
      if (!Array.isArray(cfg.login_methods)) {
        return { ok: "unknown", detail: "Privy did not report login methods." };
      }
      return cfg.login_methods.some((m) => m === "google" || m === "google_oauth")
        ? { ok: true, detail: "Google login is enabled." }
        : { ok: false, detail: "Google login is not enabled." };
    },
    fix: "Enable Google under Privy dashboard, User management, Authentication, Socials.",
    docsUrl: `${PRIVY_DOCS}#google`,
  },
  {
    id: "embedded-wallets",
    where: "dashboard",
    label: "Embedded wallets are enabled for Ethereum",
    required: true,
    pillars: ["login", "session", "sponsor"],
    check: (cfg) => {
      const eth = cfg.embedded_wallet_config?.ethereum;
      if (!eth) return { ok: "unknown", detail: "Privy did not report the Ethereum embedded wallet config." };
      const mode = eth.create_on_login;
      return {
        ok: true,
        detail:
          typeof mode === "string"
            ? `Dashboard create-on-login is "${mode}". The SDK provisions wallets server-side either way (WalletGate).`
            : "Ethereum embedded wallets are configured.",
      };
    },
    fix: "Turn on embedded wallets for Ethereum in Privy dashboard, Wallets. Wallet creation itself is handled server-side by createEnsureWalletRoute().",
    docsUrl: `${PRIVY_DOCS}#embedded-wallets`,
  },
  {
    id: "coinbase-eoa-only",
    where: "code",
    label: "Coinbase Wallet is pinned to eoaOnly",
    required: true,
    pillars: ["login"],
    fix: "Build the Privy config with createPepuPrivyConfig() (or use PepuPrivyProvider). Coinbase Smart Wallet does not support chain 97741.",
    docsUrl: `${PRIVY_DOCS}#coinbase`,
  },
  {
    id: "authorization-key-quorum",
    where: "env",
    label: `${PRIVY_ENV.authorizationKey} is set and ${PRIVY_ENV.keyQuorumId} is its key quorum id`,
    required: false,
    pillars: ["session"],
    fix: `Create an authorization key in the Privy dashboard, put the private half in ${PRIVY_ENV.authorizationKey} and its key quorum id in ${PRIVY_ENV.keyQuorumId}. A mismatch gives "No valid authorization keys or user signing keys available".`,
    docsUrl: `${PRIVY_DOCS}#key-quorum`,
  },
  {
    id: "smart-wallets",
    where: "dashboard",
    label: "Smart wallets are enabled with the PEPU bundler and paymaster URLs (Privy transport only)",
    required: false,
    pillars: ["sponsor"],
    check: (cfg) =>
      cfg.smart_wallet_config === undefined
        ? { ok: "unknown", detail: "Privy did not report smart wallet settings." }
        : { ok: true, detail: "Smart wallet settings are present." },
    fix: "Only needed for the Privy Smart Wallets transport: add the PEPU chain with bundler and paymaster URLs under Privy dashboard, Wallets, Smart wallets. The direct transport does not need this.",
    docsUrl: `${PRIVY_DOCS}#smart-wallets`,
  },
];

/**
 * Privy's public app-config endpoint, the one the browser SDK calls itself.
 * Confirmed live: an unknown app id returns HTTP 400
 * `missing_or_invalid_privy_app_id`. The response fields below are NOT
 * verified against a real app (no app id was available when this was written),
 * so every field is treated as optional and maps to "unknown" when absent.
 */
const PRIVY_APP_CONFIG_URL = "https://auth.privy.io/api/v1/apps/";

/** One row of a {@link checkPrivyDashboardConfig} result. */
export interface PrivyDashboardCheckItem {
  id: string;
  ok: boolean | "unknown";
  detail: string;
  fix?: string;
}

/**
 * Check the Privy dashboard settings that can be read without a secret, by
 * calling the public app-config endpoint the browser SDK itself uses. Best
 * effort and never throws: anything that cannot be verified (network error,
 * non-200, field missing) is reported as `"unknown"`, not as a failure.
 *
 * Only `where: "dashboard"` requirements are returned. Env and code
 * requirements cannot be checked from here.
 *
 * @example
 * ```ts
 * import { checkPrivyDashboardConfig } from "@pepu-chain/sdk/privy";
 * const r = await checkPrivyDashboardConfig({ appId: "cl...", origin: "http://localhost:3001" });
 * for (const i of r.items.filter((i) => i.ok === false)) console.log(i.id, i.fix);
 * ```
 */
export async function checkPrivyDashboardConfig(o: {
  appId: string;
  origin?: string;
  fetch?: typeof fetch;
}): Promise<{ ok: boolean; items: PrivyDashboardCheckItem[] }> {
  const rows = PEPU_PRIVY_REQUIREMENTS.filter((r) => r.where === "dashboard");
  const unknownAll = (detail: string): { ok: boolean; items: PrivyDashboardCheckItem[] } => ({
    ok: true,
    items: rows.map((r) => ({ id: r.id, ok: "unknown", detail, fix: r.fix })),
  });

  const appId = o.appId?.trim() ?? "";
  if (!appId) return unknownAll(`${PRIVY_ENV.appId} is empty, so nothing could be checked.`);

  let cfg: PrivyPublicAppConfig;
  try {
    const doFetch = o.fetch ?? globalThis.fetch;
    const res = await doFetch(`${PRIVY_APP_CONFIG_URL}${encodeURIComponent(appId)}`, {
      headers: {
        "privy-app-id": appId,
        ...(o.origin ? { origin: o.origin } : {}),
      },
    });
    if (!res.ok) return unknownAll(`Privy's public app config returned HTTP ${res.status}.`);
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return unknownAll("Privy's public app config was not an object.");
    cfg = json as PrivyPublicAppConfig;
  } catch {
    return unknownAll("Could not reach Privy's public app config (network error).");
  }

  const items = rows.map((r): PrivyDashboardCheckItem => {
    let result: PrivyRequirementResult = { ok: "unknown", detail: "No automatic check." };
    if (r.check) {
      try {
        result = r.check(cfg, o.origin !== undefined ? { origin: o.origin } : {});
      } catch {
        result = { ok: "unknown", detail: "The check could not read Privy's response." };
      }
    }
    return result.ok === true
      ? { id: r.id, ok: true, detail: result.detail }
      : { id: r.id, ok: result.ok, detail: result.detail, fix: r.fix };
  });
  // Only a definite failure of a required row fails the report.
  const ok = !items.some((i) => i.ok === false && rows.find((r) => r.id === i.id)?.required);
  return { ok, items };
}

/**
 * Structurally identical to `DoctorCheck` in `@pepu-chain/sdk/doctor`
 * (defined locally so `/privy` does not import `/doctor`).
 */
export interface PrivyDoctorCheck {
  id: string;
  status: "pass" | "fail" | "warn" | "skip";
  message: string;
  fix?: string;
}

/**
 * Adapter matching `PrivyDashboardChecker` from `@pepu-chain/sdk/doctor`, so the
 * doctor can run the Privy dashboard checks: pass it as the doctor's injected
 * checker. Unknown keys fail, env and code rows are skipped (the doctor's env
 * check covers them), and anything Privy did not report is a warning, not a
 * failure. `appSecret` is accepted for signature compatibility and never used
 * or logged. Messages contain no URLs or values.
 *
 * @example
 * ```ts
 * import { privyDashboardChecker } from "@pepu-chain/sdk/privy";
 * const checks = await privyDashboardChecker({ appId, requirementKeys: ["login-methods"], fetch });
 * ```
 */
export async function privyDashboardChecker(input: {
  appId: string;
  requirementKeys: string[];
  appSecret?: string;
  fetch: typeof fetch;
  origin?: string;
}): Promise<PrivyDoctorCheck[]> {
  const report = await checkPrivyDashboardConfig({
    appId: input.appId,
    fetch: input.fetch,
    ...(input.origin !== undefined ? { origin: input.origin } : {}),
  });
  return input.requirementKeys.map((key): PrivyDoctorCheck => {
    const id = `privy.${key}`;
    const row = PEPU_PRIVY_REQUIREMENTS.find((r) => r.id === key);
    if (!row) {
      return { id, status: "fail", message: `Unknown Privy requirement key "${key}".`, fix: "Use a key from PEPU_PRIVY_REQUIREMENTS." };
    }
    if (row.where !== "dashboard") {
      return { id, status: "skip", message: `${row.label}: checked by the env/code checks, not the dashboard.` };
    }
    const item = report.items.find((i) => i.id === key);
    if (!item || item.ok === "unknown") {
      return { id, status: "warn", message: `${row.label}: could not be verified. ${item?.detail ?? ""}`.trim(), fix: row.fix };
    }
    return item.ok
      ? { id, status: "pass", message: `${row.label}: ${item.detail}` }
      : { id, status: "fail", message: `${row.label}: ${item.detail}`, fix: row.fix };
  });
}
