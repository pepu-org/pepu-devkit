/**
 * Environment + config-file loading for the policy service. Zero extra
 * dependency for env loading: Node's built-in `process.loadEnvFile` (stable
 * in this repo's Node v24.4.1, confirmed working in this session) reads a
 * dotenv-format file into `process.env`. We load, in order:
 *
 *   1. `deploy/.keys.env` (repo root) — PAYMASTER_SIGNER_PRIVATE_KEY and the
 *      other signer/deploy keys. This file is gitignored at the repo root
 *      and lives outside this package on purpose (shared across services).
 *   2. this package's own `.env` (gitignored) — everything else: Privy
 *      creds, DB path, caps, ports.
 *
 * Both loads are best-effort (missing file is not fatal — e.g. CI/tests set
 * env vars directly) but required *values* are validated below and the
 * process fails fast with a clear message if anything load-bearing is
 * missing, rather than silently signing with an undefined key.
 *
 * SECURITY: nothing in this file may log, print, or otherwise surface the
 * actual value of PAYMASTER_SIGNER_PRIVATE_KEY. Only its derived public
 * address (checked against the known-good PAYMASTER_SIGNER_ADDRESS) is ever
 * logged.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { AppRegistryConfig, GlobalAllowlistConfig, RegisteredApp } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..", "..");

function loadEnvFileIfPresent(path: string): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

/** True when running as a production deployment (the container sets NODE_ENV=production). */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

/**
 * Env vars that may instead be supplied as a file path in `<NAME>_FILE`
 * (the Docker / Kubernetes secrets convention: the secret is mounted at
 * /run/secrets/<name> and never appears in `docker inspect` or `ps`).
 */
export const SECRET_FILE_VARS = [
  "PAYMASTER_SIGNER_PRIVATE_KEY",
  "PRIVY_APP_SECRET",
  "ADMIN_TOKEN",
  "RPC_URL",
] as const;

/**
 * For each name in SECRET_FILE_VARS: if `<NAME>_FILE` is set and `<NAME>` is not,
 * read the file (surrounding whitespace trimmed) into `env[NAME]`. A directly set
 * `<NAME>` always wins. A set-but-unreadable or empty `_FILE` throws (fail fast;
 * the message names the variable and path, never any contents).
 */
export function loadSecretFiles(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of SECRET_FILE_VARS) {
    const filePath = env[`${name}_FILE`]?.trim();
    if (!filePath || env[name]?.trim()) continue;
    let contents: string;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch (error) {
      throw new Error(
        `${name}_FILE is set to "${filePath}" but it could not be read (${(error as NodeJS.ErrnoException).code ?? "read error"}).`,
      );
    }
    const value = contents.trim();
    if (!value) throw new Error(`${name}_FILE ("${filePath}") is empty.`);
    env[name] = value;
  }
}

/**
 * Call once at process startup, before reading any env var below.
 *
 * Precedence is always: real environment (including Docker secrets via
 * `*_FILE`) first, then files. `process.loadEnvFile` never overrides a variable
 * that is already set, so the environment-variable fallback for
 * PAYMASTER_SIGNER_PRIVATE_KEY works without any key file, and a missing file is
 * ignored (ENOENT). In production (NODE_ENV=production) deploy/.keys.env is not
 * read at all: a hosted signer key must come from the environment or a mounted
 * secret, never from the dev key file.
 */
export function loadEnvFiles(): void {
  if (!isProduction()) loadEnvFileIfPresent(join(REPO_ROOT, "deploy", ".keys.env"));
  loadEnvFileIfPresent(join(PACKAGE_ROOT, ".env"));
  loadSecretFiles();
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in ` +
        `(and confirm deploy/.keys.env at the repo root has PAYMASTER_SIGNER_PRIVATE_KEY set).`,
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`Environment variable ${name}="${raw}" is not a valid integer (wei amount).`);
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Environment variable ${name}="${raw}" is not a valid integer.`);
  }
  return parsed;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`Environment variable ${name}="${raw}" is not a valid boolean (use "true" or "false").`);
}

/** Comma-separated list, trimmed, empty entries dropped. `null` if unset/empty — see .env.example for what that means for CORS/origin-checking defaults. */
function envStringList(name: string): string[] | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return values.length > 0 ? values : null;
}

/**
 * Known-good address for PAYMASTER_SIGNER_PRIVATE_KEY on the original dev
 * deployment. Safe to hardcode (public). A hosted deployment with a fresh
 * signer key MUST set PAYMASTER_SIGNER_ADDRESS (the address that key derives
 * and that was registered on-chain via addSigner); see
 * resolveExpectedSignerAddress.
 */
export const EXPECTED_PAYMASTER_SIGNER_ADDRESS =
  "0x106e6d6dB9f22AF147D27E7EFa3E7D6f5DeF2454" as const;

/** Canonical ERC-4337 EntryPoint v0.7 address — same on every chain that has it. */
export const ENTRY_POINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

/**
 * The signer address the loaded private key must derive. PAYMASTER_SIGNER_ADDRESS
 * (env) wins; otherwise the legacy hardcoded dev address. In production the env
 * var is REQUIRED so a hosted deployment can never silently accept the dev key.
 */
export function resolveExpectedSignerAddress(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.PAYMASTER_SIGNER_ADDRESS?.trim();
  if (fromEnv) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(fromEnv)) {
      throw new Error("PAYMASTER_SIGNER_ADDRESS is not a 0x-prefixed 20-byte address.");
    }
    return fromEnv;
  }
  if (isProduction(env)) {
    throw new Error(
      "PAYMASTER_SIGNER_ADDRESS is required when NODE_ENV=production (the address of the fresh hosted signer key; it must be registered on-chain via addSigner).",
    );
  }
  return EXPECTED_PAYMASTER_SIGNER_ADDRESS;
}

/** sha256 of the documented local-dev app key. It must never be accepted in production. */
export const LOCAL_DEV_APP_KEY_HASH_HEX =
  "cd693b92ac1aa06ac54691b1acd4daa67528a6a6f4e4cfb42d8d45bf71b3b25b";

/**
 * Which apps registry to load. Precedence:
 *   1. APPS_CONFIG_PATH (explicit path);
 *   2. PEPU_APPS_PROFILE=dev -> config/apps.dev.json (local testing; includes the
 *      documented local-dev key). Refused when NODE_ENV=production;
 *   3. config/apps.json (the production-safe file; no local-dev entry).
 */
export function resolveAppsConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.APPS_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  const profile = env.PEPU_APPS_PROFILE?.trim().toLowerCase();
  if (profile === "dev") {
    if (isProduction(env)) {
      throw new Error("PEPU_APPS_PROFILE=dev is not allowed when NODE_ENV=production.");
    }
    return join(PACKAGE_ROOT, "config", "apps.dev.json");
  }
  if (profile && profile !== "prod") {
    throw new Error(`PEPU_APPS_PROFILE="${profile}" is not valid (use "dev", "prod" or leave unset).`);
  }
  return join(PACKAGE_ROOT, "config", "apps.json");
}

export interface PolicyServiceConfig {
  port: number;
  chainId: number;
  entryPointAddress: string;
  /** The deployed (or, pre-deployment, expected) SingletonPaymasterV7-style contract address. */
  paymasterAddress: `0x${string}`;
  signerAccount: ReturnType<typeof privateKeyToAccount>;
  privyAppId: string;
  privyAppSecret: string;
  dbPath: string;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  validityWindowSeconds: number;
  caps: {
    userHourlyCountCap: number;
    userDailyCountCap: number;
    userLifetimeCountCap: number;
    userHourlySpendCapWei: bigint;
    userDailySpendCapWei: bigint;
    userLifetimeSpendCapWei: bigint;
    globalDailySpendCeilingWei: bigint;
  };
  adminToken: string | null;
  allowlistConfigPath: string;
  appsConfigPath: string;
  /** See paymasterRpc.ts / server.ts. `null` = endpoint fully open to any Origin (default; see .env.example). */
  paymasterRpcAllowedOrigins: string[] | null;
  /** See paymasterRpcAuth.ts's doc comment on the account-deployment/sybil-cap trade-off. Defaults to `true`. */
  paymasterRpcAllowAccountDeployment: boolean;
  /**
   * When PAYMASTER_RPC_ALLOWED_ORIGINS is set, also accept requests that carry NO Origin header
   * (server-side callers such as an app's own API routes, scripts, prove-session). Browsers always
   * send Origin on cross-origin POSTs, so this does not weaken the browser-side check. Default false.
   */
  paymasterRpcAllowMissingOrigin: boolean;
  /** PEPU chain JSON-RPC URL (embeds a provider key: a secret). Required in production; powers /ready and the executed-marker reconciler. */
  rpcUrl: string | null;
  /** Milliseconds to wait for in-flight requests on SIGTERM/SIGINT before forcing exit. */
  shutdownTimeoutMs: number;
  /** /ready: a paymaster deposit below this (wei) makes the service report not-ready. 0 disables the floor. */
  readyMinDepositWei: bigint;
  /** /ready: a deposit above this (wei) is reported as a warning (blast-radius ceiling). 0 disables. */
  readyMaxDepositWei: bigint;
  /** v1 executed-marker reconciler (src/executedReconciler.ts). */
  reconciler: {
    enabled: boolean;
    intervalMs: number;
    chunkBlocks: bigint;
    /** Blocks before head to start from when no cursor exists yet (ignored if startBlock is set). */
    lookbackBlocks: bigint;
    startBlock: bigint | null;
    confirmations: bigint;
  };
}

export function loadConfig(): PolicyServiceConfig {
  const privateKey = requireEnv("PAYMASTER_SIGNER_PRIVATE_KEY") as `0x${string}`;
  const signerAccount = privateKeyToAccount(privateKey);
  const expectedSignerAddress = resolveExpectedSignerAddress();
  if (signerAccount.address.toLowerCase() !== expectedSignerAddress.toLowerCase()) {
    throw new Error(
      `PAYMASTER_SIGNER_PRIVATE_KEY derives address ${signerAccount.address}, which does not match ` +
        `the expected PAYMASTER_SIGNER_ADDRESS ${expectedSignerAddress}. Refusing to start ` +
        `with a key that doesn't match the known-good signer — this would sign approvals the on-chain ` +
        `paymaster's \`signers\` mapping won't recognize (harmless) or, worse, indicate the wrong key ` +
        `was loaded (a real risk). Double-check deploy/.keys.env.`,
    );
  }

  return {
    port: envInt("PORT", 8787),
    chainId: envInt("CHAIN_ID", 97741),
    entryPointAddress: optionalEnv("ENTRY_POINT_ADDRESS", ENTRY_POINT_V07_ADDRESS),
    paymasterAddress: requireEnv("PAYMASTER_CONTRACT_ADDRESS") as `0x${string}`,
    signerAccount,
    privyAppId: requireEnv("PRIVY_APP_ID"),
    privyAppSecret: requireEnv("PRIVY_APP_SECRET"),
    dbPath: optionalEnv("DB_PATH", join(PACKAGE_ROOT, "data", "policy.db")),
    paymasterVerificationGasLimit: envBigInt("PAYMASTER_VERIFICATION_GAS_LIMIT", 100_000n),
    paymasterPostOpGasLimit: envBigInt("PAYMASTER_POST_OP_GAS_LIMIT", 50_000n),
    validityWindowSeconds: envInt("VALIDITY_WINDOW_SECONDS", 90),
    // --- Per-user spend cap fallbacks -----------------------------------
    // SIZING NOTE (2026-09-30 incident): the previous fallbacks here were
    // 0.1 / 1 / 10 PEPU (10n**17n / 10n**18n / 10n**19n) — a hard-coded
    // floor that shadowed an *unset* .env value and denied every single
    // sponsorship, because it is far smaller than the cost of the one
    // operation every new user must perform first: deploying their Kernel
    // smart account. Measured live on PEPU mainnet (chain 97741, base fee
    // ~12,500 gwei): a UserOperation carrying `factory`/`factoryData` (the
    // account-deployment op) costs ~12 PEPU worst-case; every subsequent
    // UserOp from that same, now-deployed, sender costs ~3 PEPU. A per-user
    // hourly cap below ~12 PEPU therefore locks out 100% of first-time
    // users at the worst possible moment — their very first transaction —
    // regardless of what the daily/lifetime caps say, since the hourly
    // check runs first (db.ts's `recordApprovalIfWithinCaps`).
    //
    // New fallbacks, sized around that same 12-PEPU-deploy / 3-PEPU-op
    // split:
    //   - hourly:   25 PEPU  — one deployment (~12) plus several (~4)
    //                          follow-up taps in the same hour, with
    //                          headroom for the gas-ceiling formula's
    //                          worst-case padding over typical actual cost.
    //   - daily:   100 PEPU  — PEPU's requested ballpark: one
    //                          deployment plus ~29 subsequent ops/day.
    //   - lifetime: 1000 PEPU — 10x the daily cap, so sustained real usage
    //                          over many days is never the practical binding
    //                          constraint (the daily/hourly caps and the
    //                          app/global ceilings are); still a real,
    //                          finite ceiling — half the paymaster's current
    //                          2,000 PEPU EntryPoint deposit — bounding how
    //                          much any single identity can ever draw down
    //                          over its entire lifetime.
    // Ordering invariant: hourly <= daily <= lifetime, always (each rolling
    // window is a superset of the shorter one) — 25 <= 100 <= 1000 holds.
    caps: {
      userHourlyCountCap: envInt("USER_HOURLY_COUNT_CAP", 20),
      userDailyCountCap: envInt("USER_DAILY_COUNT_CAP", 100),
      userLifetimeCountCap: envInt("USER_LIFETIME_COUNT_CAP", 2_000),
      userHourlySpendCapWei: envBigInt("USER_HOURLY_SPEND_CAP_WEI", 25n * 10n ** 18n), // 25 PEPU
      userDailySpendCapWei: envBigInt("USER_DAILY_SPEND_CAP_WEI", 100n * 10n ** 18n), // 100 PEPU
      userLifetimeSpendCapWei: envBigInt("USER_LIFETIME_SPEND_CAP_WEI", 1_000n * 10n ** 18n), // 1000 PEPU
      // Code fallback intentionally stays a permissive 1000 PEPU (see
      // .env.example / README "Threat model") — this specific deployment's
      // .env overrides it down to 500 PEPU. Left unchanged by this fix: the
      // per-user caps above were the actual bug (they bound a single
      // sender/user), this ceiling bounds aggregate spend across everyone
      // and was never the reported denial reason.
      globalDailySpendCeilingWei: envBigInt("GLOBAL_DAILY_SPEND_CEILING_WEI", 10n ** 21n), // 1000 PEPU
    },
    adminToken: process.env.ADMIN_TOKEN?.trim() || null,
    allowlistConfigPath: optionalEnv(
      "ALLOWLIST_CONFIG_PATH",
      join(PACKAGE_ROOT, "config", "allowlist.json"),
    ),
    appsConfigPath: resolveAppsConfigPath(),
    paymasterRpcAllowedOrigins: envStringList("PAYMASTER_RPC_ALLOWED_ORIGINS"),
    paymasterRpcAllowAccountDeployment: envBool("PAYMASTER_RPC_ALLOW_ACCOUNT_DEPLOYMENT", true),
    paymasterRpcAllowMissingOrigin: envBool("PAYMASTER_RPC_ALLOW_MISSING_ORIGIN", false),
    rpcUrl: loadRpcUrl(),
    shutdownTimeoutMs: envInt("SHUTDOWN_TIMEOUT_MS", 10_000),
    readyMinDepositWei: envBigInt("READY_MIN_DEPOSIT_WEI", 0n),
    readyMaxDepositWei: envBigInt("READY_MAX_DEPOSIT_WEI", 0n),
    reconciler: {
      enabled: envBool("RECONCILER_ENABLED", true),
      intervalMs: envInt("RECONCILER_INTERVAL_MS", 30_000),
      chunkBlocks: envBigInt("RECONCILER_CHUNK_BLOCKS", 2_000n),
      lookbackBlocks: envBigInt("RECONCILER_LOOKBACK_BLOCKS", 100_000n),
      startBlock: process.env.RECONCILER_START_BLOCK?.trim() ? envBigInt("RECONCILER_START_BLOCK", 0n) : null,
      confirmations: envBigInt("RECONCILER_CONFIRMATIONS", 2n),
    },
  };
}

function loadRpcUrl(): string | null {
  const url = process.env.RPC_URL?.trim();
  if (!url) {
    if (isProduction()) {
      throw new Error(
        "RPC_URL (or RPC_URL_FILE) is required when NODE_ENV=production: /ready and the executed-marker reconciler need chain access.",
      );
    }
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
  } catch {
    throw new Error("RPC_URL is not a valid http(s) URL.");
  }
  return url;
}

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");

const allowlistFileSchema = z.object({
  destinations: z.array(addressSchema),
});

const bigintStringSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    try {
      return BigInt(value);
    } catch {
      ctx.addIssue({ code: "custom", message: `"${value}" is not a valid integer` });
      return z.NEVER;
    }
  });

const appFileSchema = z.object({
  id: z.string().min(1),
  apiKeyHashHex: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "expected a lowercase sha256 hex digest (64 hex chars)"),
  allowedDestinations: z.union([z.literal("*"), z.array(addressSchema)]),
  dailySpendCapWei: bigintStringSchema,
  lifetimeSpendCapWei: bigintStringSchema.nullable(),
});

const appsFileSchema = z.object({
  apps: z.array(appFileSchema),
});

export function loadAllowlistConfig(path: string): GlobalAllowlistConfig {
  if (!existsSync(path)) {
    throw new Error(`Global allowlist config not found at ${path}. See policy-service/README.md.`);
  }
  const parsed = allowlistFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return { destinations: parsed.destinations as readonly `0x${string}`[] };
}

export function loadAppRegistryConfig(path: string, env: NodeJS.ProcessEnv = process.env): AppRegistryConfig {
  if (!existsSync(path)) {
    throw new Error(`App registry config not found at ${path}. See policy-service/README.md.`);
  }
  const parsed = appsFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const apps: RegisteredApp[] = parsed.apps.map((app) => {
    if (ids.has(app.id)) throw new Error(`Duplicate app id "${app.id}" in ${path}`);
    ids.add(app.id);
    if (hashes.has(app.apiKeyHashHex)) {
      throw new Error(`Duplicate apiKeyHashHex for app "${app.id}" in ${path}`);
    }
    hashes.add(app.apiKeyHashHex);
    return {
      id: app.id,
      apiKeyHashHex: app.apiKeyHashHex,
      allowedDestinations:
        app.allowedDestinations === "*"
          ? "*"
          : (app.allowedDestinations as readonly `0x${string}`[]),
      dailySpendCapWei: app.dailySpendCapWei,
      lifetimeSpendCapWei: app.lifetimeSpendCapWei,
    };
  });
  if (isProduction(env)) {
    const dev = apps.find((a) => a.apiKeyHashHex === LOCAL_DEV_APP_KEY_HASH_HEX);
    if (dev) {
      throw new Error(
        `App "${dev.id}" in ${path} uses the documented local-dev API key hash; refusing to start with NODE_ENV=production. Dev entries belong in config/apps.dev.json.`,
      );
    }
  }
  return { apps };
}
