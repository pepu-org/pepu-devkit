/**
 * Client-safe environment access: every value here is a `NEXT_PUBLIC_*`
 * variable, so this module may be imported from "use client" components.
 * Server secrets (`PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`) are never
 * read here; the SDK's `/privy/server` and `/session/server` read them from
 * `process.env` themselves. The contract address lives in `lib/scope.ts`.
 */

export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";
export const hasPrivyAppId = privyAppId.length > 0;

/** The key quorum id Privy assigned to the registered authorization key. An identifier, not a secret. */
export const keyQuorumId = process.env.NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID?.trim() ?? "";
export const hasKeyQuorumId = keyQuorumId.length > 0;
