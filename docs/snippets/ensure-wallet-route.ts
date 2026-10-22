// Pillar 1, server: provision the embedded wallet and authenticate requests.
// SERVER ONLY (reads PRIVY_APP_SECRET). See docs/sdk/privy-server.md
import { createEnsureWalletRoute, requireUser } from "@pepu-chain/sdk/privy/server";

// app/api/wallet/ensure/route.ts
export const { POST } = createEnsureWalletRoute();

// Any other authenticated route handler. The user id comes only from the
// verified Privy access token, never from the request body.
export async function whoAmI(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response; // ready-made JSON error with the right status
  return Response.json({ userId: auth.user.userId, address: auth.user.address });
}
