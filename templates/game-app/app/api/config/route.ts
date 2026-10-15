import { privyEnvVar } from "@pepu-chain/sdk/privy/server";

/**
 * Reports whether the server-only Privy secrets are configured, as booleans
 * only, never the values. `components/setup-gate.tsx` calls this once so it
 * can show a readable setup screen instead of crashing on the first grant or tap.
 */
export async function GET() {
  return Response.json({
    hasPrivyAppSecret: Boolean(privyEnvVar("appSecret")),
    hasPrivyAuthorizationKey: Boolean(privyEnvVar("authorizationKey")),
  });
}
