import { isEmbeddedWalletLinkedAccount, PrivyClient } from "@privy-io/node";
import type { LinkedAccount, LinkedAccountEmbeddedWallet } from "@privy-io/node";
import type { Address } from "viem";
import { assertServerOnly } from "../internal/assert-server.js";
import { PepuAuthError, PepuConfigError, PepuError, toErrorResponse, toPepuError } from "../errors.js";
import { PRIVY_ENV, PRIVY_ENV_ALIASES } from "./requirements.js";

assertServerOnly("@pepu-chain/sdk/privy/server");

/**
 * `@pepu-chain/sdk/privy/server` (server). Privy server client, access-token
 * verification and the ensure-wallet route factory. Never import it from
 * client code: it calls `assertServerOnly()` at import.
 *
 * Optional peer: `@privy-io/node`.
 */

/** A Privy linked embedded-wallet account. */
export type LinkedWallet = LinkedAccountEmbeddedWallet;

/** The part of a Privy user object these helpers read. */
export interface PrivyUser {
  linked_accounts: readonly LinkedAccount[];
}

/** The authenticated caller, as returned by {@link requireUser}. */
export interface PepuUser {
  /** The Privy user id, only ever taken from a verified access token. */
  userId: string;
  /** The user's embedded Ethereum wallet address, `null` if not provisioned yet. */
  address: Address | null;
  /** The Privy user object the address was read from. */
  privyUser: PrivyUser;
}

/** Server-side Privy configuration read from the environment. */
export interface PrivyServerEnv {
  appId: string;
  appSecret: string;
  /** Private half of the authorization key. Only sessions need it. */
  authorizationKey?: string;
  /** The key quorum id sessions grant. Only sessions need it. */
  keyQuorumId?: string;
}

/**
 * The single reader for the Privy variables ({@link PRIVY_ENV}, then its
 * aliases). Trimmed; `undefined` when unset or blank. Session routes use it
 * too, so every module agrees on names.
 *
 * @example
 * ```ts
 * const quorum = privyEnvVar("keyQuorumId");
 * ```
 */
export function privyEnvVar(name: keyof typeof PRIVY_ENV): string | undefined {
  const env = typeof process !== "undefined" ? process.env : {};
  for (const n of [PRIVY_ENV[name], ...PRIVY_ENV_ALIASES[name]]) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * Read the Privy server variables ({@link PRIVY_ENV}), explicit options winning.
 * Throws a `PepuConfigError` that lists every missing variable by NAME only.
 * `PRIVY_AUTHORIZATION_KEY` is optional here (ensure-wallet never needs it).
 *
 * @example
 * ```ts
 * const { appId, appSecret } = readPrivyServerEnv();
 * ```
 */
export function readPrivyServerEnv(o: { appId?: string; appSecret?: string; authorizationKey?: string; keyQuorumId?: string } = {}): PrivyServerEnv {
  const appId = (o.appId ?? privyEnvVar("appId") ?? "").trim();
  const appSecret = (o.appSecret ?? privyEnvVar("appSecret") ?? "").trim();
  const authorizationKey = (o.authorizationKey ?? privyEnvVar("authorizationKey") ?? "").trim();
  const keyQuorumId = (o.keyQuorumId ?? privyEnvVar("keyQuorumId") ?? "").trim();
  const missing: string[] = [];
  if (!appId) missing.push(PRIVY_ENV.appId);
  if (!appSecret) missing.push(PRIVY_ENV.appSecret);
  if (missing.length > 0) {
    throw new PepuConfigError("CONFIG_MISSING_ENV", `Missing required env: ${missing.join(", ")}. See .env.example.`, {
      details: { missing },
    });
  }
  return {
    appId,
    appSecret,
    ...(authorizationKey ? { authorizationKey } : {}),
    ...(keyQuorumId ? { keyQuorumId } : {}),
  };
}

const clientCache = new Map<string, PrivyClient>();

/**
 * A cached `PrivyClient` (`@privy-io/node`) built from {@link PRIVY_ENV}. One
 * instance per distinct credential set. The authorization key is not given to
 * the client: Privy takes it per request (`authorization_context`), see
 * {@link readPrivyServerEnv}.
 *
 * Ported from templates/consumer-app/lib/privy-server.ts.
 *
 * @example
 * ```ts
 * const privy = createPrivyServer();
 * const user = await privy.users()._get(userId);
 * ```
 */
export function createPrivyServer(o: { appId?: string; appSecret?: string; authorizationKey?: string; keyQuorumId?: string } = {}): PrivyClient {
  const { appId, appSecret } = readPrivyServerEnv(o);
  const key = `${appId}\u0000${appSecret}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new PrivyClient({ appId, appSecret });
    clientCache.set(key, client);
  }
  return client;
}

const redact = (text: string, secret: string): string => (secret ? text.split(secret).join("[redacted]") : text);

/**
 * Verify the `Authorization: Bearer <token>` header against Privy and return the
 * caller's Privy user id and claims. Throws `PepuAuthError` (`AUTH_INVALID_TOKEN`,
 * HTTP 401) when the header is missing or the token does not verify. The reason
 * Privy gave goes in `details.reason` (token redacted): a verification failure
 * caused by a mismatched `PRIVY_APP_SECRET` looks exactly like an expired
 * session, so check it first.
 *
 * Note `verifyAccessToken(token)` on `privy.utils().auth()` takes a bare string,
 * not `{ access_token }` (that is the standalone function's signature).
 *
 * Ported from templates/consumer-app/lib/privy-auth.ts.
 *
 * @example
 * ```ts
 * const { userId } = await verifyRequestUser(request);
 * ```
 */
export async function verifyRequestUser(
  request: Request,
  o: { privy?: PrivyClient } = {},
): Promise<{ userId: string; claims: unknown }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new PepuAuthError("AUTH_INVALID_TOKEN", "Missing Privy access token. Send Authorization: Bearer <token>.");
  }
  const privy = o.privy ?? createPrivyServer();
  try {
    const claims = await privy.utils().auth().verifyAccessToken(token);
    return { userId: claims.user_id, claims };
  } catch (e) {
    const reason = redact(e instanceof Error ? e.message : String(e), token);
    throw new PepuAuthError("AUTH_INVALID_TOKEN", "Invalid or expired Privy access token.", {
      details: { reason },
    });
  }
}

/**
 * The user's Ethereum embedded wallet (delegated or not), or `null`. This is
 * what makes ensure-wallet idempotent.
 *
 * Ported from templates/consumer-app/lib/privy-user.ts.
 *
 * @example
 * ```ts
 * const wallet = findEmbeddedEthereumWallet(user);
 * ```
 */
export function findEmbeddedEthereumWallet(user: PrivyUser): LinkedWallet | null {
  for (const account of user.linked_accounts) {
    if (isEmbeddedWalletLinkedAccount(account) && account.chain_type === "ethereum") return account;
  }
  return null;
}

/**
 * The user's Ethereum embedded wallet that has been delegated (granted a
 * session signer), or `null`.
 *
 * Ported from templates/game-app/lib/privy-user.ts.
 *
 * @example
 * ```ts
 * const wallet = findDelegatedEthereumWallet(user);
 * ```
 */
export function findDelegatedEthereumWallet(user: PrivyUser): LinkedWallet | null {
  for (const account of user.linked_accounts) {
    if (isEmbeddedWalletLinkedAccount(account) && account.chain_type === "ethereum" && account.delegated) {
      return account;
    }
  }
  return null;
}

/**
 * Authenticate a request for a route handler. On success returns the user id
 * (from the verified token only) and the user's embedded wallet address. On
 * failure returns a ready JSON `Response` (`{ error: { code, message, hint } }`:
 * 401 for a bad token, 500 for missing config, 502 if Privy cannot be reached).
 * Never throws.
 *
 * @example
 * ```ts
 * export async function POST(request: Request) {
 *   const auth = await requireUser(request);
 *   if (!auth.ok) return auth.response;
 *   return Response.json({ userId: auth.user.userId });
 * }
 * ```
 */
export async function requireUser(
  request: Request,
  o: { privy?: PrivyClient } = {},
): Promise<{ ok: true; user: PepuUser } | { ok: false; response: Response }> {
  try {
    const privy = o.privy ?? createPrivyServer();
    const { userId } = await verifyRequestUser(request, { privy });
    let privyUser: PrivyUser;
    try {
      privyUser = await privy.users()._get(userId);
    } catch (e) {
      throw new PepuError("UNKNOWN", "Could not look up the user in Privy.", { status: 502, retryable: true, cause: e });
    }
    const wallet = findEmbeddedEthereumWallet(privyUser);
    return { ok: true, user: { userId, address: (wallet?.address as Address | undefined) ?? null, privyUser } };
  } catch (e) {
    return { ok: false, response: toErrorResponse(e) };
  }
}

/**
 * Next.js route handler that creates the signed-in user's Ethereum embedded
 * wallet server-side if they have none. Drop-in:
 * `export const { POST } = createEnsureWalletRoute();` in
 * `app/api/wallet/ensure/route.ts`.
 *
 * Why: Privy's own client-side creation hangs forever for apps whose dashboard
 * creation setting is off; pair it with `createOnLogin: "off"` (the default of
 * `createPepuPrivyConfig`) and `WalletGate`.
 *
 * - CUSTODY: the wallet is created with `owner: { user_id }`. This backend holds
 *   no signing authority over it. Do not add a session signer here.
 * - SECURITY: the user id comes only from the verified access token, never from
 *   the body or query string.
 * - IDEMPOTENT: it looks for an existing wallet first and re-checks after a
 *   failed create, so a double submit never makes a second wallet.
 *
 * Ported from templates/consumer-app/app/api/wallet/ensure/route.ts.
 *
 * @example
 * ```ts
 * // app/api/wallet/ensure/route.ts
 * import { createEnsureWalletRoute } from "@pepu-chain/sdk/privy/server";
 * export const { POST } = createEnsureWalletRoute();
 * ```
 */
export function createEnsureWalletRoute(
  o: {
    privy?: PrivyClient;
    onCreated?: (c: { userId: string; address: Address }) => Promise<void>;
  } = {},
): { POST(request: Request): Promise<Response> } {
  return {
    async POST(request: Request): Promise<Response> {
      let privy: PrivyClient;
      try {
        privy = o.privy ?? createPrivyServer();
      } catch (e) {
        return toErrorResponse(e);
      }
      const auth = await requireUser(request, { privy });
      if (!auth.ok) return auth.response;
      const { userId, address } = auth.user;
      if (address) return Response.json({ address, created: false });

      try {
        const wallet = await privy.wallets().create({ chain_type: "ethereum", owner: { user_id: userId } });
        const created = wallet.address as Address;
        if (o.onCreated) {
          try {
            await o.onCreated({ userId, address: created });
          } catch {
            // The wallet exists; a failing hook must not turn that into an error.
          }
        }
        return Response.json({ address: created, created: true });
      } catch (createError) {
        // Race guard: a concurrent request may have created the wallet between
        // the check above and this call. Re-check before surfacing a failure.
        try {
          const again = findEmbeddedEthereumWallet(await privy.users()._get(userId));
          if (again) return Response.json({ address: again.address, created: false });
        } catch {
          // fall through to the create error
        }
        return toErrorResponse(
          new PepuError("WALLET_NOT_PROVISIONED", "Could not create a wallet.", {
            status: 502,
            cause: toPepuError(createError),
          }),
        );
      }
    },
  };
}
