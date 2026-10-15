import "server-only";
import { createMemoryStore, createSponsoredSessionRoutes, type SessionStore } from "@pepu-chain/sdk/combo";
import { scope, TAPSCORE_ADDRESS } from "./scope";
import { tapScoreAbi } from "./tapscore";

/**
 * One store per server process, surviving Next.js dev hot reloads.
 * DEV-GRADE (in memory, holds session private keys). Production: implement
 * `SessionStore` on a database or KV and encrypt `sessionPrivateKey` at rest.
 */
const globalKey = "__pepuSponsoredSessionStore";
const g = globalThis as typeof globalThis & { [globalKey]?: SessionStore };
g[globalKey] ??= createMemoryStore();

/**
 * The five session routes. Bundler and paymaster come from `PEPU_BUNDLER_URL`
 * and `PEPU_PAYMASTER_URL`, the session length from `SESSION_DURATION_MINUTES`,
 * Privy auth from `PRIVY_APP_SECRET` (all read by the SDK).
 */
export const routes = createSponsoredSessionRoutes({
  scope,
  store: g[globalKey],
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  },
});
