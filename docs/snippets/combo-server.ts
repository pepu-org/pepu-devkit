// The combination, server: Google login + on-chain session key + sponsored gas.
// SERVER ONLY. See docs/sdk/combo.md and docs/recipes/sponsored-session.md
// Needs PRIVY_APP_SECRET and PEPU_PAYMASTER_URL (https://paymaster.pepeunchained.com/v2/paymaster/<project server key>).
// PEPU_BUNDLER_URL defaults to https://bundler.pepeunchained.com.
import { createMemoryStore, createSponsoredSessionRoutes } from "@pepu-chain/sdk/combo";
import type { SessionStore } from "@pepu-chain/sdk/combo";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

// DEV ONLY. The store holds session private keys: production needs a persistent
// SessionStore with sessionPrivateKey encrypted at rest.
const store: SessionStore = createMemoryStore();

export const routes = createSponsoredSessionRoutes({
  scope: { calls: [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }] },
  store,
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  },
});

// app/api/session/prepare/route.ts   export const { POST } = routes.prepare;
// app/api/session/activate/route.ts  export const { POST } = routes.activate;
// app/api/session/status/route.ts    export const { GET } = routes.status;
// app/api/session/act/route.ts       export const { POST } = routes.act;
// app/api/session/revoke/route.ts    export const { POST } = routes.revoke;
export const { prepare, activate, status, act, revoke } = routes;
