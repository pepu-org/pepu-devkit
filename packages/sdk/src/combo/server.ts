import type { PrivyClient } from "@privy-io/node";
import { createPublicClient, http } from "viem";
import type { Address, PublicClient } from "viem";
import type { SponsoredActResult } from "./types.js";
import { createPepuSponsoredClient, sendSponsored } from "../aa/kernel.js";
import { normalizeCalls } from "../aa/calls.js";
import type { Call } from "../aa/types.js";
import { pepuMainnet } from "../chains.js";
import { resolvePepuEndpoints } from "../endpoints.js";
import { buildPaymasterContext } from "../erc7677.js";
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
import { assertServerOnly } from "../internal/assert-server.js";
import { createPrivyServer, requireUser } from "../privy/server.js";
import { resolveSessionMinutes, sessionExpiry } from "../session/policy.js";
import {
  buildKernelSessionPolicies,
  checkApproval,
  describeKernelSessionScope,
  expectedPermissionId,
  generateSessionKey,
  getKernelAddress,
  isCallInScope,
  loadKernelSessionAccount,
} from "../session/kernel.js";
import type { KernelSessionCall, KernelSessionScope } from "../session/kernel.js";
import { isLive } from "../session/store.js";
import type { SessionRecord, SessionStore } from "../session/store.js";

assertServerOnly("@pepu-chain/sdk/combo");

/**
 * `@pepu-chain/sdk/combo` (server): the combined flow. Google sign-in (Privy),
 * a ONE-TIME on-chain session, and sponsored gas. Route factories for the
 * Kernel session lifecycle: prepare, activate, status, act, revoke.
 *
 * Extracted from templates/sponsored-session-app/app/api/session/* and
 * lib/{kernel,session-auth}.ts.
 *
 * Trust model: the chain, not these routes, enforces scope. The owner's single
 * EIP-712 signature enables a permission whose call policy (targets,
 * selectors, zero value) and timestamp policy the Kernel account verifies on
 * every UserOperation. The checks here only fail fast.
 *
 * Optional peers: `@privy-io/node`, `@zerodev/*`.
 */

export { createMemoryStore, isLive } from "../session/store.js";
export type { SessionRecord, SessionStore } from "../session/store.js";
export type { KernelSessionCall, KernelSessionScope } from "../session/kernel.js";
export type { SponsoredActResult } from "./types.js";
/** Session length from `SESSION_DURATION_MINUTES` (default 15, clamped to 1..1440), the same rule the routes use. */
export { resolveSessionMinutes } from "../session/policy.js";

/** The authenticated caller of a combo route. */
export interface ComboUser {
  userId: string;
  /** The user's Privy embedded wallet: the owner of their Kernel account. From Privy, never the request. */
  ownerAddress: Address;
}

/** Authenticate a request. Throw a `PepuError` (or return `null`) when it is not valid. */
export type ComboAuthenticate = (request: Request) => Promise<ComboUser | null>;

/** Options for {@link createSponsoredSessionRoutes}. */
export interface SponsoredSessionRoutesOptions<I> {
  /** What the session may call. Enforced on-chain by the call policy. */
  scope: {
    calls: readonly KernelSessionCall[];
    /** Env variable named in the `CONFIG_MISSING_ENV` message when a call target is empty (unset). */
    targetEnv?: string;
  };
  /**
   * Where session records (including the session private key) live. Use
   * `createMemoryStore()` for development only: production needs a persistent
   * store with the key encrypted at rest.
   */
  store: SessionStore;
  /**
   * Bundler and paymaster. The bundler defaults to env `PEPU_BUNDLER_URL`, then the hosted bundler. The paymaster
   * needs a complete ERC-7677 URL (env `PEPU_PAYMASTER_URL`, or `paymasterUrl`) or a project `paymasterToken`
   * (built against the hosted paymaster base).
   */
  endpoints?: { bundlerUrl?: string; paymasterUrl?: string; paymasterToken?: string };
  /**
   * Forward the caller's Privy access token (the request's `Authorization: Bearer`) to the paymaster as ERC-7677
   * `context.privyAccessToken`. The v2 FREE TIER requires it; a project paying from its own deposit does not.
   * Default `true`. Set `false` if your paymaster URL is not a PEPU policy service you trust with the token.
   */
  forwardPrivyToken?: boolean;
  /** Session length. Default env `SESSION_DURATION_MINUTES`, then 15; clamped to 1..1440. */
  minutes?: number;
  /** The one action users take with their session. */
  act: {
    /** Validate the client body. Throw to reject with 400. */
    parse(body: unknown): I;
    /** The calls to send. Each is re-checked against `scope` before sponsoring. */
    buildCalls(input: I, ctx: { kernelAddress: Address; ownerAddress: Address }): Call[];
  };
  /** Privy client for the default authentication. Default `createPrivyServer()`. */
  privy?: PrivyClient;
  /**
   * Custom authentication. Default: B1's `requireUser` (verifies the Privy
   * bearer token and reads the user's embedded wallet from Privy).
   */
  authenticate?: ComboAuthenticate;
  /** Chain reads. Default: viem on the PEPU RPC (`PEPU_RPC_URL` aware). */
  publicClient?: PublicClient;
  /**
   * A brand-new user's embedded wallet exists in the browser a moment before Privy's server reports it. With the
   * default authentication, a signed-in user whose wallet is not visible yet is looked up again this many times
   * (`attempts`, default 3), waiting `delayMs` * attempt number between lookups (default 400 ms). If it is still
   * not visible, `status` answers `{ active: false, provisioning: true }` (a normal state, not an error) and the other
   * routes answer a retryable 409 `WALLET_NOT_PROVISIONED`.
   */
  provisioningWait?: { attempts?: number; delayMs?: number };
}

/** The five route handlers returned by {@link createSponsoredSessionRoutes}. */
export interface SponsoredSessionRoutes {
  prepare: { POST(request: Request): Promise<Response> };
  activate: { POST(request: Request): Promise<Response> };
  status: { GET(request: Request): Promise<Response> };
  act: { POST(request: Request): Promise<Response> };
  revoke: { POST(request: Request): Promise<Response> };
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
  return err;
}

async function guard(op: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return toErrorResponse(upstream(e, op));
  }
}

/** The bearer token on a request, or `""`. */
function bearerToken(request: Request): string {
  return (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** Marker: signed in, but Privy's server does not list an embedded wallet yet. */
const PROVISIONING = Symbol("wallet-provisioning");

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function defaultPublicClient(): PublicClient {
  return createPublicClient({ chain: pepuMainnet, transport: http(resolvePepuEndpoints().rpcUrl) }) as PublicClient;
}

/**
 * Route handlers for the Kernel session lifecycle.
 *
 * - `prepare.POST`: the server creates a fresh session key and decides the
 *   expiry. The private key stays on the server; the response carries only the
 *   key's address, the expiry and the scope, so the browser can ask the owner
 *   for the ONE signature that grants exactly that. Calling it again replaces
 *   any pending or active session (the old key is dropped).
 * - `activate.POST` `{ approval }`: checks the approval is for this user's
 *   smart account and for exactly the key, scope and expiry issued in
 *   `prepare`, then stores it. 409 `SESSION_NONE` when nothing is pending,
 *   410 `SESSION_EXPIRED` for an expired offer, 400 `SESSION_APPROVAL_MISMATCH`.
 * - `status.GET`: `{ active: false }` or `{ active: true, validUntil, ... }`.
 *   Never returns the session key or approval.
 * - `act.POST`: signs ONE sponsored UserOperation with the session key. 409
 *   `SESSION_NONE` without a live session, 429 while another action runs.
 * - `revoke.POST`: deletes the session key and approval from the server, so
 *   the app can no longer act, immediately. It does NOT uninstall the
 *   permission on-chain: that grant stays valid until its expiry, but only the
 *   deleted key can use it and only within the scope. An on-chain uninstall is
 *   an owner-signed call to the user's own account, which a paymaster
 *   destination allowlist rightly does not sponsor.
 *
 * Gas: the paymaster policy service reserves worst-case cost per operation:
 * about 20.5 PEPU for a session's first operation and about 6.9 PEPU for later
 * ones (`SESSION_GAS_RESERVATION_PEPU`). Size spend caps above that. Fees come
 * from the chain with 20% headroom.
 *
 * @example
 * // lib/session-routes.ts
 * export const routes = createSponsoredSessionRoutes({
 *   scope: { calls: [{ target: tapScore, abi: tapScoreAbi, functionName: "tap" }] },
 *   store: createMemoryStore(), // DEV ONLY
 *   act: {
 *     parse: () => ({}),
 *     buildCalls: () => [{ to: tapScore, abi: tapScoreAbi, functionName: "tap" }],
 *   },
 * });
 * // app/api/session/prepare/route.ts: export const { POST } = routes.prepare;
 */
export function createSponsoredSessionRoutes<I>(o: SponsoredSessionRoutesOptions<I>): SponsoredSessionRoutes {
  // A call whose target is empty or undefined (an unset env variable) is "not configured yet":
  // every route then answers CONFIG_MISSING_ENV at request time. A malformed non-empty scope
  // still fails at startup, not on the first request.
  const unconfigured = o.scope.calls.some((c) => !c.target || String(c.target).trim() === "");
  if (unconfigured) {
    const unset = async (): Promise<Response> =>
      toErrorResponse(
        new PepuConfigError(
          "CONFIG_MISSING_ENV",
          `${o.scope.targetEnv ?? "A session target contract address"} is not set to a valid address. See .env.example.`,
          { hint: "Set it and restart the server." },
        ),
      );
    return {
      prepare: { POST: unset },
      activate: { POST: unset },
      status: { GET: unset },
      act: { POST: unset },
      revoke: { POST: unset },
    };
  }
  buildKernelSessionPolicies({ calls: o.scope.calls, validUntil: 1 });
  let publicClient = o.publicClient;
  const client = (): PublicClient => (publicClient ??= defaultPublicClient());

  const wait = { attempts: o.provisioningWait?.attempts ?? 3, delayMs: o.provisioningWait?.delayMs ?? 400 };

  /**
   * Authenticate. A signed-in user whose wallet Privy's server does not list yet is looked up again (bounded), then
   * reported as `PROVISIONING` so the caller decides: `status` makes it a normal state, the rest throw a retryable 409.
   */
  const authenticateOrProvisioning = async (request: Request): Promise<ComboUser | Response | typeof PROVISIONING> => {
    if (o.authenticate) {
      const user = await o.authenticate(request);
      if (!user) throw new PepuAuthError("AUTH_INVALID_TOKEN", "Missing or invalid Privy access token.");
      return user;
    }
    const privy = o.privy ?? createPrivyServer();
    for (let attempt = 0; ; attempt++) {
      const auth = await requireUser(request, { privy });
      if (!auth.ok) return auth.response;
      if (auth.user.address) return { userId: auth.user.userId, ownerAddress: auth.user.address };
      if (attempt >= wait.attempts) return PROVISIONING;
      await new Promise((resolve) => setTimeout(resolve, wait.delayMs * (attempt + 1)));
    }
  };

  const authenticate = async (request: Request): Promise<ComboUser | Response> => {
    const user = await authenticateOrProvisioning(request);
    if (user === PROVISIONING) {
      throw new PepuAuthError(
        "WALLET_NOT_PROVISIONED",
        "Your wallet is still being set up. This usually takes a few seconds; retrying.",
        { status: 409, retryable: true },
      );
    }
    return user;
  };

  const minutes = (): number => o.minutes ?? resolveSessionMinutes(process.env.SESSION_DURATION_MINUTES);
  const policiesFor = (validUntil: number) => buildKernelSessionPolicies({ calls: o.scope.calls, validUntil });

  return {
    prepare: {
      POST: (request) =>
        guard("combo prepare", async () => {
          const user = await authenticate(request);
          if (user instanceof Response) return user;
          const { userId, ownerAddress } = user;
          const mins = minutes();
          const validUntil = sessionExpiry(nowSeconds(), mins);
          const key = generateSessionKey();
          const policies = policiesFor(validUntil);
          const [kernelAddress, permissionId] = await Promise.all([
            getKernelAddress(client(), ownerAddress),
            expectedPermissionId({ publicClient: client(), sessionKeyAddress: key.address, policies }),
          ]);
          const record: SessionRecord = {
            userId,
            ownerAddress,
            kernelAddress,
            sessionPrivateKey: key.privateKey,
            sessionKeyAddress: key.address,
            permissionId,
            validUntil,
            approval: null,
            actions: 0,
          };
          await o.store.set(record);
          return json({
            ownerAddress,
            kernelAddress,
            sessionKeyAddress: key.address,
            validUntil,
            minutes: mins,
            scope: describeKernelSessionScope({ calls: o.scope.calls, validUntil }),
          });
        }),
    },

    activate: {
      POST: (request) =>
        guard("combo activate", async () => {
          const user = await authenticate(request);
          if (user instanceof Response) return user;
          const body = (await request.json().catch(() => null)) as { approval?: unknown } | null;
          if (typeof body?.approval !== "string") {
            throw new PepuPolicyError("UNKNOWN", "Missing approval.", { status: 400, hint: "Send { approval }." });
          }
          const record = await o.store.get(user.userId);
          if (!record || record.approval !== null) {
            throw new PepuSessionError("SESSION_NONE", "No pending session. Start again.");
          }
          if (nowSeconds() >= record.validUntil) {
            await o.store.delete(record.userId);
            throw new PepuSessionError("SESSION_EXPIRED", "The session offer expired. Start again.");
          }
          const check = checkApproval(body.approval, {
            kernelAddress: record.kernelAddress,
            permissionId: record.permissionId,
          });
          if (!check.ok) throw new PepuSessionError("SESSION_APPROVAL_MISMATCH", check.reason, { status: 400 });
          await o.store.set({ ...record, approval: body.approval });
          return json({ active: true, validUntil: record.validUntil });
        }),
    },

    status: {
      GET: (request) =>
        guard("combo status", async () => {
          const user = await authenticateOrProvisioning(request);
          if (user instanceof Response) return user;
          if (user === PROVISIONING) return json({ active: false, provisioning: true });
          const record = await o.store.get(user.userId);
          if (!record || !isLive(record, nowSeconds())) return json({ active: false });
          return json({
            active: true,
            validUntil: record.validUntil,
            kernelAddress: record.kernelAddress,
            ownerAddress: record.ownerAddress,
            sessionKeyAddress: record.sessionKeyAddress,
            actions: record.actions,
          });
        }),
    },

    act: {
      POST: (request) =>
        guard("combo act", async () => {
          const user = await authenticate(request);
          if (user instanceof Response) return user;
          const record = await o.store.get(user.userId);
          if (!record || !record.approval || !isLive(record, nowSeconds())) {
            throw new PepuSessionError("SESSION_NONE", "No active session. Start one first.");
          }

          let input: I;
          try {
            input = o.act.parse(await request.json().catch(() => ({})));
          } catch (e) {
            throw new PepuPolicyError("UNKNOWN", e instanceof Error ? e.message : "Invalid request body.", {
              status: 400,
              hint: "Fix the request body.",
              cause: e,
            });
          }
          const calls = o.act.buildCalls(input, {
            kernelAddress: record.kernelAddress,
            ownerAddress: record.ownerAddress,
          });
          // Fail fast; the chain is the real enforcement (see the file comment).
          assertCallsInScope(describeKernelSessionScope({ calls: o.scope.calls, validUntil: record.validUntil }), calls);

          if (!(await o.store.tryLock(user.userId))) {
            throw new PepuChainError("UNKNOWN", "An action is already in flight.", {
              status: 429,
              retryable: true,
              hint: "Wait for the current action to finish.",
            });
          }
          const privyToken = o.forwardPrivyToken === false ? "" : bearerToken(request);
          try {
            const account = await loadKernelSessionAccount({
              publicClient: client(),
              approval: record.approval,
              sessionPrivateKey: record.sessionPrivateKey,
            });
            const kernel = createPepuSponsoredClient({
              account,
              publicClient: client(),
              ...(o.endpoints?.bundlerUrl !== undefined ? { bundlerUrl: o.endpoints.bundlerUrl } : {}),
              ...(o.endpoints?.paymasterUrl !== undefined ? { paymasterUrl: o.endpoints.paymasterUrl } : {}),
              ...(o.endpoints?.paymasterToken !== undefined ? { paymasterToken: o.endpoints.paymasterToken } : {}),
              ...(privyToken ? { paymasterContext: buildPaymasterContext({ privyAccessToken: privyToken }) } : {}),
            });
            const result = await sendSponsored({ client: kernel, calls });
            const actions = record.actions + (result.success ? 1 : 0);
            if (result.success) await o.store.set({ ...record, actions });
            const out: SponsoredActResult = {
              userOpHash: result.userOpHash,
              transactionHash: result.transactionHash,
              kernelAddress: record.kernelAddress,
              success: result.success,
              paymaster: result.paymaster,
              actualGasCostWei: result.actualGasCostWei.toString(),
              explorerUrl: result.explorerUrl,
              actions,
            };
            return json(out);
          } finally {
            await o.store.unlock(user.userId);
          }
        }),
    },

    revoke: {
      POST: (request) =>
        guard("combo revoke", async () => {
          const user = await authenticate(request);
          if (user instanceof Response) return user;
          await o.store.delete(user.userId);
          return json({ active: false });
        }),
    },
  };
}

/**
 * Throws `POLICY_UNSCOPED` (403) unless every call targets an allowed contract
 * and function selector with a value within the limit. Pure; used by the act
 * route and exported for custom routes.
 *
 * @example
 * assertCallsInScope(describeKernelSessionScope({ calls, validUntil }), [{ to, abi, functionName: "tap" }]);
 */
export function assertCallsInScope(scope: Pick<KernelSessionScope, "calls">, calls: readonly Call[]): void {
  for (const c of normalizeCalls(calls)) {
    if (!isCallInScope(scope, c)) {
      throw new PepuPolicyError("POLICY_UNSCOPED", "A call is outside the session scope.", {
        status: 403,
        hint: "Only the contracts and functions the user approved can be called.",
      });
    }
  }
}
