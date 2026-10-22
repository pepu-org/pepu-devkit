import "server-only";
import { resolveSessionMinutes } from "@pepu-chain/sdk/session";

/**
 * What `/api/config` reports: booleans (and the session length), never
 * secrets. The values themselves are read by the SDK routes from
 * `PRIVY_APP_SECRET`, `PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL`,
 * `SESSION_DURATION_MINUTES` and the optional `PEPU_RPC_URL`.
 * `PEPU_PAYMASTER_URL` embeds your project's server key: it is a secret.
 */
const set = (name: string): boolean => (process.env[name]?.trim() ?? "").length > 0;

export const serverRequiredConfig = {
  hasPrivyAppSecret: set("PRIVY_APP_SECRET"),
  hasBundlerUrl: set("PEPU_BUNDLER_URL"),
  hasPaymasterUrl: set("PEPU_PAYMASTER_URL"),
  sessionMinutes: resolveSessionMinutes(process.env.SESSION_DURATION_MINUTES),
} as const;
