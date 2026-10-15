import type { PrivyClient } from "@privy-io/node";
import type { PrivyPoliciesService } from "@privy-io/node";
import { http, isAddress, toFunctionSelector } from "viem";
import type { Abi, AbiFunction, Address, Hash, Hex } from "viem";
import { pepuMainnet } from "../chains.js";
import { getPublicClient } from "../client.js";
import { resolvePepuEndpoints } from "../endpoints.js";
import {
  PepuAuthError,
  PepuChainError,
  PepuConfigError,
  PepuError,
  PepuPolicyError,
  PepuSessionError,
  toErrorResponse,
  toPepuError,
} from "../errors.js";
import { txUrl } from "../explorer.js";
import { assertServerOnly } from "../internal/assert-server.js";
import { PRIVY_ENV } from "../privy/requirements.js";
import { createPrivyServer, findDelegatedEthereumWallet, privyEnvVar, verifyRequestUser } from "../privy/server.js";
import {
  buildSessionPolicy,
  resolveSessionMinutes,
  sessionExpiry,
  signAndBroadcast as signAndBroadcastFlow,
} from "./policy.js";
import type { PrivyUnsignedTransaction, SignAndBroadcastClient, SignAndBroadcastParams } from "./policy.js";

assertServerOnly("@pepu-chain/sdk/session/server");

/** Derived from the exported service type; the package does not re-export PolicyCreateParams (game-app lib/session-policy.ts). */
type PolicyCreateParams = Parameters<PrivyPoliciesService["create"]>[0];

/**
 * Server half of the Privy-mode session layer. Ported from
 * templates/game-app (app/api/session/*, app/api/game/tap/route.ts).
 *
 * Trust model: scope is enforced by Privy's off-chain policy engine. The
 * client `removeSigners` call is the real revoke; the server revoke route is
 * cleanup only.
 */

export { signAndBroadcast, broadcastSignedTransaction, withGasLimitBuffer } from "./policy.js";

/** Contract and functions a session may touch. */
export interface SessionScopeInput {
  contractAddress: Address;
  functions: readonly AbiFunction[];
}

/**
 * Like {@link SessionScopeInput}, but the address may be empty or undefined,
 * which is what an unset env variable looks like. The route factories accept
 * it and answer every request with a `CONFIG_MISSING_ENV` JSON error instead
 * of throwing when the module loads.
 */
export interface LazySessionScopeInput {
  contractAddress: Address | "" | undefined;
  functions: readonly AbiFunction[];
}

function isBlank(address: string | undefined | null): boolean {
  return address === undefined || address === null || address.trim() === "";
}

/** The handler used when the scope's contract address is unset: a `CONFIG_MISSING_ENV` JSON error. */
function unconfiguredResponse(envName: string | undefined): Response {
  return toErrorResponse(
    new PepuConfigError(
      "CONFIG_MISSING_ENV",
      `${envName ?? "The session contract address"} is not set to a valid address. See .env.example.`,
      { hint: envName ? `Set ${envName} and restart the server.` : "Set the contract address and restart the server." },
    ),
  );
}

/**
 * Resolves the authenticated user for a request. Return the user id (or
 * `{ userId }`), return `null` for "not authenticated", or throw a
 * `PepuAuthError`. Integration point for WP-B1: pass
 * `async (req) => { const r = await requireUser(req); ... }`. Default (when
 * omitted): `verifyRequestUser` from `@pepu-chain/sdk/privy/server`.
 */
export type VerifyUser = (request: Request) => Promise<{ userId: string } | string | null>;

/** The slice of a Privy client these routes use. Tests pass a fake. */
export type SessionPrivyClient = PrivyClient;

interface CommonOptions {
  privy?: PrivyClient;
  /** Custom auth. Default: verify the bearer access token with the Privy client. */
  verifyUser?: VerifyUser;
}

function missing(names: readonly string[]): PepuConfigError {
  return new PepuConfigError(
    "CONFIG_MISSING_ENV",
    `Missing required environment variable(s): ${names.join(", ")}.`,
  );
}

function resolvePrivy(o: CommonOptions): PrivyClient {
  // One source for env names and client caching: B1's createPrivyServer (PRIVY_ENV).
  return o.privy ?? createPrivyServer();
}

async function authenticate(request: Request, privy: PrivyClient, verifyUser?: VerifyUser): Promise<string> {
  let result: { userId: string } | string | null;
  if (verifyUser) {
    result = await verifyUser(request);
  } else {
    // Default: B1's verifyRequestUser (throws PepuAuthError AUTH_INVALID_TOKEN with a redacted reason).
    result = await verifyRequestUser(request, { privy });
  }
  const userId = typeof result === "string" ? result : result?.userId;
  if (!userId) {
    throw new PepuAuthError("AUTH_INVALID_TOKEN", "Missing or invalid Privy access token.");
  }
  return userId;
}

interface DelegatedWallet {
  id: string | null;
  address: Address;
}

/** The user's embedded Ethereum wallet that has a session signer attached. Ported from game-app lib/privy-user.ts. */
async function findDelegated(privy: PrivyClient, userId: string): Promise<DelegatedWallet | null> {
  const wallet = findDelegatedEthereumWallet(await privy.users()._get(userId));
  return wallet ? { id: wallet.id ?? null, address: wallet.address as Address } : null;
}

function validateScope(scope: SessionScopeInput): void {
  // Same checks as buildSessionPolicy, run at factory time so misuse fails at startup.
  buildSessionPolicy({ ...scope, expiresAtUnixSeconds: 1 });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Anything unclassified that reaches a route is an upstream failure, not our 500. */
function upstream(e: unknown, op: string): PepuError {
  const err = toPepuError(e, { op });
  if (err.code === "UNKNOWN" && !(e instanceof PepuError)) {
    return new PepuChainError("UNKNOWN", err.message, { status: 502, cause: e });
  }
  // Only SESSION_* may be 409: clients treat 409 as "no session" (a nonce race is a failed tx, not a lost session).
  if (err.status === 409 && !err.code.startsWith("SESSION_")) {
    return new PepuChainError(err.code, err.message, { status: 502, cause: e });
  }
  return err;
}

async function guard(op: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return toErrorResponse(upstream(e, op));
  }
}

export interface CreateSessionRoutesOptions extends CommonOptions {
  /**
   * An empty or undefined `contractAddress` is allowed: the routes then answer
   * every request with `CONFIG_MISSING_ENV`. A non-empty malformed one still
   * throws at creation.
   */
  scope: LazySessionScopeInput;
  /** Env variable named in the `CONFIG_MISSING_ENV` message when the address is unset, e.g. `"NEXT_PUBLIC_GAME_CONTRACT_ADDRESS"`. */
  contractAddressEnv?: string;
  /** Session length. Default env `SESSION_DURATION_MINUTES`, clamped to 1..1440. */
  minutes?: number;
  /** The Privy key quorum the user grants. Default env `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`. */
  keyQuorumId?: string;
}

/**
 * Route handlers for granting, checking and revoking a Privy session.
 *
 * - `grant.POST` creates a fresh scoped, time-bound policy and returns
 *   `{ alreadyGranted: false, policyId, expiresAt, signerId, durationMinutes }`,
 *   or `{ alreadyGranted: true }` when a signer is already attached (the client
 *   must then NOT call `addSigners` again: Privy fails with "Duplicate signer").
 * - `status.GET` returns `{ delegated, active, address }`. Privy does not
 *   expose a policy's expiry, so the client tracks `expiresAt` from the grant.
 * - `revoke.POST` is server cleanup. Call it after the client `removeSigners`;
 *   body `{ policyId }` deletes that policy if it is this scope's and the
 *   wallet is no longer delegated.
 *
 * @example
 * // app/api/session/grant/route.ts
 * const routes = createSessionRoutes({ scope: { contractAddress, functions: [tapAbi] } });
 * export const { POST } = routes.grant;
 */
export function createSessionRoutes(o: CreateSessionRoutesOptions): {
  grant: { POST(req: Request): Promise<Response> };
  status: { GET(req: Request): Promise<Response> };
  revoke: { POST(req: Request): Promise<Response> };
} {
  if (isBlank(o.scope.contractAddress)) {
    const unset = async (): Promise<Response> => unconfiguredResponse(o.contractAddressEnv);
    return { grant: { POST: unset }, status: { GET: unset }, revoke: { POST: unset } };
  }
  const scope = o.scope as SessionScopeInput;
  validateScope(scope);
  const scopeContract = scope.contractAddress.toLowerCase();

  return {
    grant: {
      POST: (req) =>
        guard("session grant", async () => {
          const signerId = o.keyQuorumId ?? privyEnvVar("keyQuorumId");
          if (!signerId) throw missing([PRIVY_ENV.keyQuorumId]);
          const privy = resolvePrivy(o);
          const userId = await authenticate(req, privy, o.verifyUser);

          try {
            if (await findDelegated(privy, userId)) return json({ alreadyGranted: true });
          } catch {
            // The check failing must not block a first grant; a real Privy problem surfaces below.
          }

          const minutes = o.minutes ?? resolveSessionMinutes(process.env.SESSION_DURATION_MINUTES);
          const expiresAt = sessionExpiry(Math.floor(Date.now() / 1000), minutes);
          const policy = await privy.policies().create(
            buildSessionPolicy({ ...scope, expiresAtUnixSeconds: expiresAt }) as unknown as PolicyCreateParams,
          );
          return json({
            alreadyGranted: false,
            policyId: policy.id,
            expiresAt,
            signerId,
            durationMinutes: minutes,
          });
        }),
    },
    status: {
      GET: (req) =>
        guard("session status", async () => {
          const privy = resolvePrivy(o);
          const userId = await authenticate(req, privy, o.verifyUser);
          const wallet = await findDelegated(privy, userId);
          return json({ delegated: wallet !== null, active: wallet !== null, address: wallet?.address ?? null });
        }),
    },
    revoke: {
      POST: (req) =>
        guard("session revoke", async () => {
          const privy = resolvePrivy(o);
          const userId = await authenticate(req, privy, o.verifyUser);
          const wallet = await findDelegated(privy, userId);
          if (wallet) {
            // Client removeSigners has not happened yet; never delete a policy that is still attached.
            return json({ revoked: false, delegated: true, policyDeleted: false });
          }
          let policyDeleted = false;
          const body = (await req.json().catch(() => null)) as { policyId?: unknown } | null;
          const policyId = typeof body?.policyId === "string" ? body.policyId : undefined;
          if (policyId) {
            try {
              const policy = await privy.policies().get(policyId);
              const scoped = policy.rules.every((r) =>
                r.conditions.some(
                  (c) =>
                    c.field_source === "ethereum_transaction" &&
                    c.field === "to" &&
                    typeof c.value === "string" &&
                    c.value.toLowerCase() === scopeContract,
                ),
              );
              if (scoped && policy.rules.length > 0) {
                await privy.policies()._delete(policyId);
                policyDeleted = true;
              }
            } catch {
              // Cleanup is best effort; the signer is already removed.
            }
          }
          return json({ revoked: true, delegated: false, policyDeleted });
        }),
    },
  };
}

export interface PrivySessionSignerOptions {
  privy: PrivyClient;
  walletId: string;
  /** The wallet's address (the `from` of the transaction). */
  address: Address;
  /** Default env `PRIVY_AUTHORIZATION_KEY`. Never logged or put in errors. */
  authorizationKey?: string;
  /** Default: a viem client on the PEPU RPC (`PEPU_RPC_URL` aware). */
  client?: SignAndBroadcastClient;
}

function defaultClient(): SignAndBroadcastClient {
  const { rpcUrl } = resolvePepuEndpoints();
  return getPublicClient(pepuMainnet, { transport: http(rpcUrl) }) as unknown as SignAndBroadcastClient;
}

/**
 * A signer for a Privy session wallet. Signs with `eth_signTransaction` and
 * broadcasts the raw transaction itself, because Privy's server-side
 * `eth_sendTransaction` rejects chain 97741. Ported from
 * templates/game-app/app/api/game/tap/route.ts.
 *
 * @example
 * const signer = privySessionSigner({ privy, walletId, address });
 * const hash = await signer.signAndBroadcast({ to, abi, functionName: "tap" });
 */
export function privySessionSigner(o: PrivySessionSignerOptions): {
  signTransaction(tx: PrivyUnsignedTransaction): Promise<Hex>;
  signAndBroadcast(p: Omit<SignAndBroadcastParams, "client" | "sign" | "from" | "chainId">): Promise<Hash>;
} {
  let client = o.client;
  const signTransaction = async (tx: PrivyUnsignedTransaction): Promise<Hex> => {
    const key = o.authorizationKey ?? privyEnvVar("authorizationKey");
    if (!key) throw missing([PRIVY_ENV.authorizationKey]);
    const signed = await o.privy.wallets().ethereum().signTransaction(o.walletId, {
      params: { transaction: tx },
      authorization_context: { authorization_private_keys: [key] },
    });
    return signed.signed_transaction as Hex;
  };
  return {
    signTransaction,
    signAndBroadcast: (p) => {
      client ??= defaultClient();
      return signAndBroadcastFlow({
        ...p,
        client,
        from: o.address,
        chainId: pepuMainnet.id,
        sign: signTransaction,
      });
    },
  };
}

export interface SessionCall {
  to: Address;
  abi?: Abi;
  functionName?: string;
  args?: readonly unknown[];
  data?: Hex;
  value?: bigint;
}

export interface CreateSessionActionRouteOptions<I> extends CommonOptions {
  /** As in {@link CreateSessionRoutesOptions}: an unset address yields `CONFIG_MISSING_ENV` at request time. */
  scope: LazySessionScopeInput;
  /** Env variable named in the `CONFIG_MISSING_ENV` message when the address is unset. */
  contractAddressEnv?: string;
  /** Validate the client input. Throw to reject with 400. */
  parse(body: unknown): I;
  /** Turn the input into the one call to make. Checked against `scope` before signing. */
  buildCall(i: I, ctx: { from: Address }): SessionCall;
  /** Per-user in-memory limit (per server instance). */
  rateLimit?: { perMinute: number };
  authorizationKey?: string;
  client?: SignAndBroadcastClient;
}

/**
 * Route that acts on the user's behalf with their session: finds the
 * delegated wallet (409 `SESSION_NONE` if none, the only "no session"
 * signal), re-checks the call against `scope`, signs with Privy and
 * broadcasts. Responds `{ hash, address, explorerUrl }`.
 *
 * A non-409 failure (policy denial, revert, nonce race) is a failed
 * transaction, not proof the session is gone.
 *
 * @example
 * export const { POST } = createSessionActionRoute({
 *   scope: { contractAddress, functions: [tapAbi] },
 *   parse: () => ({}),
 *   buildCall: () => ({ to: contractAddress, abi: [tapAbi], functionName: "tap" }),
 * });
 */
export function createSessionActionRoute<I>(o: CreateSessionActionRouteOptions<I>): {
  POST(req: Request): Promise<Response>;
} {
  if (isBlank(o.scope.contractAddress)) {
    return { POST: async () => unconfiguredResponse(o.contractAddressEnv) };
  }
  const scope = o.scope as SessionScopeInput;
  validateScope(scope);
  const contract = scope.contractAddress.toLowerCase();
  const selectors = new Set(scope.functions.map((f) => toFunctionSelector(f)));
  const hits = new Map<string, number[]>();

  const denied = (message: string): PepuPolicyError =>
    new PepuPolicyError("POLICY_UNSCOPED", message, { status: 403 });

  return {
    POST: (req) =>
      guard("session action", async () => {
        const privy = resolvePrivy(o);
        const userId = await authenticate(req, privy, o.verifyUser);

        if (o.rateLimit) {
          const now = Date.now();
          const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
          if (recent.length >= o.rateLimit.perMinute) {
            throw new PepuChainError("UNKNOWN", "Too many session actions; slow down.", {
              status: 429,
              retryable: true,
              hint: "Wait a few seconds and retry.",
            });
          }
          recent.push(now);
          hits.set(userId, recent);
        }

        const wallet = await findDelegated(privy, userId);
        if (!wallet || !wallet.id) {
          throw new PepuSessionError(
            "SESSION_NONE",
            "No delegated session signer found for this account. Grant a session first.",
          );
        }

        let input: I;
        try {
          input = o.parse(await req.json().catch(() => ({})));
        } catch (e) {
          throw new PepuPolicyError("UNKNOWN", e instanceof Error ? e.message : "Invalid request body.", {
            status: 400,
            hint: "Fix the request body.",
            cause: e,
          });
        }

        const call = o.buildCall(input, { from: wallet.address });
        if (!isAddress(call.to, { strict: false }) || call.to.toLowerCase() !== contract) {
          throw denied("The call targets a contract outside the session scope.");
        }
        if ((call.value ?? 0n) !== 0n) throw denied("A session call must carry zero value.");
        const fn = call.functionName
          ? scope.functions.find((f) => f.name === call.functionName)
          : undefined;
        const selector = call.data
          ? (call.data.slice(0, 10).toLowerCase() as Hex)
          : fn
            ? toFunctionSelector(fn)
            : undefined;
        if (!selector || !selectors.has(selector as Hex)) {
          throw denied("The call uses a function outside the session scope.");
        }

        const signer = privySessionSigner({
          privy,
          walletId: wallet.id,
          address: wallet.address,
          ...(o.authorizationKey !== undefined ? { authorizationKey: o.authorizationKey } : {}),
          ...(o.client !== undefined ? { client: o.client } : {}),
        });
        const hash = await signer.signAndBroadcast({
          to: call.to,
          ...(call.data !== undefined ? { data: call.data } : {}),
          ...(call.abi !== undefined ? { abi: call.abi } : {}),
          ...(call.functionName !== undefined ? { functionName: call.functionName } : {}),
          ...(call.args !== undefined ? { args: call.args } : {}),
          value: 0n,
        });
        return json({ hash, address: wallet.address, explorerUrl: txUrl(pepuMainnet, hash) });
      }),
  };
}
