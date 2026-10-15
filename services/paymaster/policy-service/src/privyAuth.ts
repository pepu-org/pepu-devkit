/**
 * Privy access-token verification + sender-ownership check (Part 1d).
 *
 * API surface verified in this session directly against
 * `node_modules/.pnpm/@privy-io+node@0.34.0_.../node_modules/@privy-io/node`'s
 * shipped `.d.ts`/compiled `.js` files (not just the brief's word — see
 * README "What was independently re-verified vs taken on trust"):
 *
 * - `new PrivyClient({ appId, appSecret })` then
 *   `privy.utils().auth().verifyAccessToken(accessToken)` (a single
 *   positional string, not `{access_token}`) is also the exact pattern
 *   already used elsewhere in this monorepo at
 *   `templates/game-app/lib/privy-server.ts` + `lib/privy-auth.ts` — this
 *   module follows that house convention rather than the brief's more
 *   verbose `createPrivyAppJWKS` example, because reading
 *   `public-api/services/utils.d.ts` / `utils/auth.d.ts` confirmed
 *   `PrivyClient` builds the JWKS getter internally; you don't need to wire
 *   `createPrivyAppJWKS` up by hand.
 * - Confirmed via `lib/auth.js` (compiled source, read directly): the JWKS
 *   is fetched through `jose`'s `createRemoteJWKSet` with `cacheMaxAge: 60
 *   minutes` — i.e. verification is LOCAL (JWT signature check against a
 *   cached public key set), not a live API round-trip per call, matching
 *   the brief's latency/outage-survival claim. Independently confirmed, not
 *   taken on trust.
 * - Confirmed via `resources/users/users.js` (compiled source, read
 *   directly): `getBySmartWalletAddress` does
 *   `this._client.post('/v1/users/smart_wallet/address', { body, ...options })`.
 *   This is a Stainless-generated SDK (`core/error.js` confirms the
 *   `APIError.generate` status->class mapping) where a non-2xx response
 *   REJECTS the promise with a typed error (`NotFoundError` on 404) — it
 *   does NOT resolve to `null`/`undefined` on no match. This module
 *   therefore treats ANY thrown error from this call (not just a
 *   `NotFoundError` — a network blip, a malformed response, anything) as
 *   "could not prove ownership" -> deny. That is a deliberate fail-closed
 *   choice: a transient error here must never be treated as "ownership
 *   confirmed".
 *
 * Both Privy calls are accessed through narrow injected function types
 * (`VerifyAccessTokenFn` / `GetUserBySmartWalletAddressFn`) rather than the
 * full `PrivyClient`, so tests can supply fakes without any network access
 * or real Privy credentials — see test/privyAuth.test.ts.
 */
import type { Address } from "viem";

export interface VerifyAccessTokenResult {
  userId: string;
}

export type VerifyAccessTokenFn = (accessToken: string) => Promise<{ user_id: string }>;

export type GetUserBySmartWalletAddressFn = (
  address: Address,
) => Promise<{ id: string } | null>;

export type AuthCheckResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_or_expired_token" | "sender_not_owned_by_token_user" };

export interface AuthChecker {
  /** Step 1: verify the bearer token, extract user_id. */
  verifyToken(accessToken: string): Promise<
    { ok: true; userId: string } | { ok: false }
  >;
  /** Step 2: verify `sender` is a smart wallet owned by `userId`. */
  verifySenderOwnership(userId: string, sender: Address): Promise<boolean>;
  /** Both steps in sequence, matching Part 2's step 1 -> step 2 order exactly. */
  authenticate(accessToken: string, sender: Address): Promise<AuthCheckResult>;
}

export function createAuthChecker(deps: {
  verifyAccessToken: VerifyAccessTokenFn;
  getUserBySmartWalletAddress: GetUserBySmartWalletAddressFn;
}): AuthChecker {
  return {
    async verifyToken(accessToken: string) {
      try {
        const claims = await deps.verifyAccessToken(accessToken);
        if (!claims.user_id) return { ok: false };
        return { ok: true, userId: claims.user_id };
      } catch {
        return { ok: false };
      }
    },

    async verifySenderOwnership(userId: string, sender: Address) {
      try {
        const owner = await deps.getUserBySmartWalletAddress(sender);
        // Fail closed: no match, or any thrown error (NotFoundError or
        // otherwise, see module doc comment), both mean "not proven" ->
        // false. We never let an exception escape this method — an
        // unexpected error here must deny sponsorship, not crash the
        // request handler into a generic 500 that might obscure the real
        // security-relevant outcome.
        return owner !== null && owner.id === userId;
      } catch {
        return false;
      }
    },

    async authenticate(accessToken: string, sender: Address): Promise<AuthCheckResult> {
      const tokenResult = await this.verifyToken(accessToken);
      if (!tokenResult.ok) return { ok: false, reason: "invalid_or_expired_token" };

      const owned = await this.verifySenderOwnership(tokenResult.userId, sender);
      if (!owned) return { ok: false, reason: "sender_not_owned_by_token_user" };

      return { ok: true, userId: tokenResult.userId };
    },
  };
}

/**
 * Production wiring: builds an `AuthChecker` from a real `@privy-io/node`
 * `PrivyClient` instance. Kept separate from `createAuthChecker` so tests
 * never need to construct a real `PrivyClient` (which requires real
 * PRIVY_APP_ID/PRIVY_APP_SECRET and, for verifyAccessToken, a real JWKS
 * fetch against `auth.privy.io`).
 */
export function createAuthCheckerFromPrivyClient(privy: {
  utils(): { auth(): { verifyAccessToken(token: string): Promise<{ user_id: string }> } };
  users(): {
    getBySmartWalletAddress(body: { address: string }): Promise<{ id: string }>;
  };
}): AuthChecker {
  return createAuthChecker({
    verifyAccessToken: (token) => privy.utils().auth().verifyAccessToken(token),
    getUserBySmartWalletAddress: async (address) => {
      // getBySmartWalletAddress rejects (does not resolve to null/undefined)
      // when there's no match — see module doc comment. Let that rejection
      // propagate; verifySenderOwnership's try/catch is what turns it into
      // "not owned".
      const user = await privy.users().getBySmartWalletAddress({ address });
      return user ? { id: user.id } : null;
    },
  });
}
