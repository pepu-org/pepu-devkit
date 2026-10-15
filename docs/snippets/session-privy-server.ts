// Pillar 2 (Privy mode), server: grant, status, revoke and one scoped action.
// SERVER ONLY (reads PRIVY_APP_SECRET and PRIVY_AUTHORIZATION_KEY).
// See docs/sdk/session.md and docs/recipes/grant-a-session.md
import { createSessionActionRoute, createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { TAPSCORE_ADDRESS, tapFunction } from "./tapscore";

const scope = { contractAddress: TAPSCORE_ADDRESS, functions: [tapFunction] } as const;

const routes = createSessionRoutes({ scope });

// app/api/session/grant/route.ts
export const grant = routes.grant;
// app/api/session/status/route.ts
export const status = routes.status;
// app/api/session/revoke/route.ts
export const revoke = routes.revoke;

// app/api/game/tap/route.ts: signs with Privy eth_signTransaction and broadcasts itself,
// because Privy's server-side eth_sendTransaction rejects chain 97741.
export const tap = createSessionActionRoute({
  scope,
  parse: () => ({}),
  buildCall: () => ({ to: TAPSCORE_ADDRESS, abi: [tapFunction], functionName: "tap" }),
  rateLimit: { perMinute: 60 },
});
