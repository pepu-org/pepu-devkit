import { createEnsureWalletRoute } from "@pepu-chain/sdk/privy/server";

/**
 * Creates this user's Ethereum embedded wallet server-side if they have none,
 * owned by the USER (`owner: { user_id }`), so this backend holds no signing
 * authority over it (see "Custody model" in README.md and AGENTS.md rule 9).
 * The user id comes only from the verified Privy access token, and the route
 * is idempotent. Paired with `createOnLogin: "off"` and `<WalletGate>`.
 */
export const { POST } = createEnsureWalletRoute();
