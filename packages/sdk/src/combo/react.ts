import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import type { Address, PublicClient } from "viem";
import { pepuMainnet } from "../chains.js";
import { getPublicClient } from "../client.js";
import { PepuAuthError, toPepuError } from "../errors.js";
import type { PepuError } from "../errors.js";
import { usePepuAuthFetch, useEmbeddedWallet } from "../privy/react.js";
import { errorFromResponse } from "../session/react.js";
import type { AuthFetch } from "../session/react.js";
import { approveKernelSession, buildKernelSessionPolicies, getKernelAddress } from "../session/kernel.js";
import type { KernelOwner } from "../session/kernel.js";
import { describeKernelSessionScope } from "../session/scope.js";
import type { KernelSessionCall, KernelSessionScope } from "../session/scope.js";

export type { SponsoredActResult } from "./types.js";

/**
 * `@pepu-chain/sdk/combo/react` (browser): hooks for the combined flow. Google
 * sign-in (Privy), ONE owner signature for an on-chain session, then actions
 * with no popup and no gas. Pairs with `createSponsoredSessionRoutes` from
 * `@pepu-chain/sdk/combo`.
 *
 * Extracted from templates/sponsored-session-app/components/session-flow.tsx.
 * The browser's only signing job is the grant; everything after it is a request
 * to your own server, authenticated by the Privy access token.
 *
 * Needs `react`, `@privy-io/react-auth` and the `@zerodev/*` peers.
 */

/** The routes {@link useSponsoredSession} calls. */
export interface SponsoredSessionEndpoints {
  prepare: string;
  activate: string;
  status: string;
  act: string;
  revoke: string;
}

/** Defaults match the `app/api/session/<name>/route.ts` convention. */
export const DEFAULT_SESSION_ENDPOINTS: SponsoredSessionEndpoints = {
  prepare: "/api/session/prepare",
  activate: "/api/session/activate",
  status: "/api/session/status",
  act: "/api/session/act",
  revoke: "/api/session/revoke",
};

/** Where the session flow is, for rendering. */
export type SponsoredSessionPhase =
  | "signed-out"
  | "provisioning"
  | "ready"
  | "granting"
  | "active"
  | "expired"
  | "error";

/**
 * Derive the phase from plain inputs. Pure.
 *
 * - not signed in: `signed-out`; signed in without an embedded wallet: `provisioning`
 * - a grant in flight: `granting`
 * - an expiry that has passed: `expired`; one still ahead: `active`
 * - an error with nothing active: `error`; otherwise `ready`
 *
 * @example
 * deriveSessionPhase({ authenticated: true, hasWallet: true, validUntil: 100, nowSeconds: 200 }); // "expired"
 */
export function deriveSessionPhase(p: {
  authenticated: boolean;
  hasWallet: boolean;
  /** The last expiry the server reported for an active session, if any. */
  validUntil?: number | undefined;
  nowSeconds: number;
  granting?: boolean;
  hasError?: boolean;
}): SponsoredSessionPhase {
  if (!p.authenticated) return "signed-out";
  if (!p.hasWallet) return "provisioning";
  if (p.granting) return "granting";
  if (p.validUntil !== undefined) return p.nowSeconds < p.validUntil ? "active" : "expired";
  return p.hasError ? "error" : "ready";
}

/** What the server's `prepare` route returns. */
export interface PreparedSession {
  ownerAddress: Address;
  kernelAddress: Address;
  sessionKeyAddress: Address;
  validUntil: number;
  minutes: number;
  scope: KernelSessionScope;
}

/** What the server's `status` route returns. */
export type SponsoredSessionStatus =
  /** `provisioning`: signed in, but the server cannot see the new embedded wallet yet. Transient: retry. */
  | { active: false; provisioning?: true }
  | {
      active: true;
      validUntil: number;
      kernelAddress: Address;
      ownerAddress: Address;
      sessionKeyAddress: Address;
      actions: number;
    };

/** Waits between retries while the server cannot see a just-created embedded wallet (total about 6.5 s). */
export const PROVISIONING_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000, 3000];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isProvisioning(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "WALLET_NOT_PROVISIONED";
}

/**
 * Run `fn`, retrying with backoff while it fails with `WALLET_NOT_PROVISIONED`. A new user's embedded wallet exists in
 * the browser a moment before Privy's server lists it; that gap is not an error the user should ever see.
 */
async function whileProvisioning<T>(fn: () => Promise<T>, delays: readonly number[]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const delay = delays[i];
      if (!isProvisioning(e) || delay === undefined) throw e;
      await sleep(delay);
    }
  }
}

async function postJson<T>(authFetch: AuthFetch, url: string, body?: unknown): Promise<T> {
  const res = await authFetch(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

/**
 * The grant, outside React: ask the server to `prepare` a session key, have
 * `owner` sign the ONE EIP-712 approval (no gas), then `activate`. Rebuilds
 * the policies from `scope` and the server's expiry; the server checks the
 * resulting permission id matches what it issued, so a different scope is
 * rejected with `SESSION_APPROVAL_MISMATCH`.
 *
 * @example
 * const prepared = await grantKernelSession({ authFetch, publicClient, owner: walletClient, scope });
 */
export async function grantKernelSession(p: {
  authFetch: AuthFetch;
  publicClient: PublicClient;
  owner: KernelOwner;
  scope: { calls: readonly KernelSessionCall[] };
  endpoints?: Partial<SponsoredSessionEndpoints>;
  /** Waits between retries of `prepare` while the server cannot see a new wallet yet. Default {@link PROVISIONING_RETRY_DELAYS_MS}. */
  provisioningRetryDelaysMs?: readonly number[];
}): Promise<PreparedSession> {
  const ep = { ...DEFAULT_SESSION_ENDPOINTS, ...p.endpoints };
  const prepared = await whileProvisioning(
    () => postJson<PreparedSession>(p.authFetch, ep.prepare),
    p.provisioningRetryDelaysMs ?? PROVISIONING_RETRY_DELAYS_MS,
  );
  const { approval } = await approveKernelSession({
    publicClient: p.publicClient,
    owner: p.owner,
    sessionKeyAddress: prepared.sessionKeyAddress,
    policies: buildKernelSessionPolicies({ calls: p.scope.calls, validUntil: prepared.validUntil }),
  });
  await postJson<{ active: true; validUntil: number }>(p.authFetch, ep.activate, { approval });
  return prepared;
}

/** Options for {@link useSponsoredSession}. */
export interface UseSponsoredSessionOptions {
  /** The same scope the server uses. The browser rebuilds the policies from it. */
  scope: { calls: readonly KernelSessionCall[] };
  endpoints?: Partial<SponsoredSessionEndpoints>;
  /** Default `usePepuAuthFetch()` (Privy bearer token). */
  authFetch?: AuthFetch;
  /** Default: a viem client on the PEPU RPC. */
  publicClient?: PublicClient;
  /** Re-poll the status route this often. Default 0 (only on mount and after actions). */
  pollMs?: number;
  /**
   * Waits between status re-checks while the server cannot see a just-created wallet. During them `statusLoading`
   * stays true and no error is shown. Default {@link PROVISIONING_RETRY_DELAYS_MS} extended to a 5 s tail (about 30 s).
   */
  provisioningRetryDelaysMs?: readonly number[];
}

/** Status re-checks while a new wallet is not visible to the server yet: 0.5, 1, 2, 3 s, then 5 s x 5 (about 30 s). */
const STATUS_PROVISIONING_DELAYS_MS: readonly number[] = [...PROVISIONING_RETRY_DELAYS_MS, 5000, 5000, 5000, 5000, 5000];

let sharedClient: PublicClient | undefined;
function defaultPublicClient(): PublicClient {
  sharedClient ??= getPublicClient(pepuMainnet) as unknown as PublicClient;
  return sharedClient;
}

/**
 * The whole session flow for a component.
 *
 * - `grant()`: prepare, ONE owner signature through the Privy embedded wallet
 *   (no gas), activate.
 * - `act(input)`: POST the act route. No popup, no gas.
 * - `revoke()`: deletes the server-side key right away. The on-chain grant
 *   lapses at its expiry; only the deleted key could ever use it.
 * - `smartAccount` is the Kernel address that sends and holds assets (a read,
 *   known before any session exists); `owner` is the embedded wallet that signs.
 *
 * @example
 * const { phase, grant, act, revoke, smartAccount, expiresAt, error } = useSponsoredSession<{}, { transactionHash: string }>({
 *   scope: { calls: [{ target: tapScore, abi: tapScoreAbi, functionName: "tap" }] },
 * });
 * if (phase === "ready") return <button onClick={grant}>Start session</button>;
 */
export function useSponsoredSession<I = undefined, O = unknown>(
  o: UseSponsoredSessionOptions,
): {
  phase: SponsoredSessionPhase;
  /**
   * True while a signed-in user with a wallet has not yet had the first status
   * response (or failure). While true, `phase` is `ready` only because nothing
   * is known yet: render a spinner instead of the "start a session" card.
   */
  statusLoading: boolean;
  owner?: Address;
  smartAccount?: Address;
  scope?: KernelSessionScope;
  expiresAt?: number;
  /** Successful actions in this session, as counted by the server. */
  actions?: number;
  grant(): Promise<void>;
  act(input?: I): Promise<O>;
  revoke(): Promise<void>;
  refetch(): void;
  error?: PepuError;
} {
  const { authenticated, ready: privyReady } = usePrivy();
  const { wallet, address: owner } = useEmbeddedWallet();
  const pepuAuthFetch = usePepuAuthFetch();
  const customFetch = o.authFetch;
  const authFetch = useCallback<AuthFetch>(
    (url, init) => (customFetch ? customFetch(url, init) : pepuAuthFetch(url, init)),
    [customFetch, pepuAuthFetch],
  );
  const endpointsRef = useRef({ ...DEFAULT_SESSION_ENDPOINTS, ...o.endpoints });
  endpointsRef.current = { ...DEFAULT_SESSION_ENDPOINTS, ...o.endpoints };
  const scopeRef = useRef(o.scope);
  scopeRef.current = o.scope;
  const publicClient = o.publicClient ?? defaultPublicClient();

  const [smartAccount, setSmartAccount] = useState<Address | undefined>();
  const [status, setStatus] = useState<SponsoredSessionStatus | undefined>();
  const [statusChecked, setStatusChecked] = useState(false);
  const [prepared, setPrepared] = useState<PreparedSession | undefined>();
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<PepuError | undefined>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  // The last expiry seen for an active session. The server reports
  // `{ active: false }` once it passes, so this is what makes `expired`.
  const [lastValidUntil, setLastValidUntil] = useState<number | undefined>();
  const grantInFlight = useRef(false);
  const provisioningDelays = o.provisioningRetryDelaysMs ?? STATUS_PROVISIONING_DELAYS_MS;
  const delaysRef = useRef(provisioningDelays);
  delaysRef.current = provisioningDelays;
  const provisioningAttempts = useRef(0);

  // The Kernel address depends only on the owner: known before any session.
  useEffect(() => {
    if (!owner) {
      setSmartAccount(undefined);
      return;
    }
    let cancelled = false;
    getKernelAddress(publicClient, owner)
      .then((a) => {
        if (!cancelled) setSmartAccount(a);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(toPepuError(e, { op: "derive smart account" }));
      });
    return () => {
      cancelled = true;
    };
  }, [owner, publicClient]);

  useEffect(() => {
    if (!authenticated || !owner) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The server cannot see the new embedded wallet yet: stay in the loading state and ask again, quietly.
    const retryLater = (): boolean => {
      const delay = delaysRef.current[provisioningAttempts.current];
      if (delay === undefined) return false;
      provisioningAttempts.current += 1;
      timer = setTimeout(() => {
        if (!cancelled) refetch();
      }, delay);
      return true;
    };
    void (async () => {
      let waiting = false;
      try {
        const res = await authFetch(endpointsRef.current.status);
        if (!res.ok) throw await errorFromResponse(res);
        const body = (await res.json()) as SponsoredSessionStatus;
        if (cancelled) return;
        if (!body.active && body.provisioning) {
          waiting = retryLater();
          if (!waiting) setStatus({ active: false });
          return;
        }
        provisioningAttempts.current = 0;
        setStatus(body);
        setError(undefined);
        if (body.active) setLastValidUntil(body.validUntil);
      } catch (e) {
        if (cancelled) return;
        if (isProvisioning(e) && (waiting = retryLater())) return;
        setError(toPepuError(e, { op: "session status" }));
      } finally {
        if (!cancelled && !waiting) setStatusChecked(true);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authenticated, owner, authFetch, tick, refetch]);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!o.pollMs || o.pollMs <= 0) return;
    const id = setInterval(refetch, o.pollMs);
    return () => clearInterval(id);
  }, [o.pollMs, refetch]);

  const grant = useCallback(async (): Promise<void> => {
    if (grantInFlight.current) return;
    grantInFlight.current = true;
    setGranting(true);
    setError(undefined);
    try {
      if (!wallet || !owner) {
        throw new PepuAuthError("WALLET_NOT_PROVISIONED", "No embedded wallet to sign the session grant.");
      }
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: owner,
        chain: pepuMainnet,
        transport: custom(provider),
      });
      const result = await grantKernelSession({
        authFetch,
        publicClient,
        owner: walletClient,
        scope: scopeRef.current,
        endpoints: endpointsRef.current,
        provisioningRetryDelaysMs: delaysRef.current,
      });
      setPrepared(result);
      setLastValidUntil(result.validUntil);
      setStatus({
        active: true,
        validUntil: result.validUntil,
        kernelAddress: result.kernelAddress,
        ownerAddress: result.ownerAddress,
        sessionKeyAddress: result.sessionKeyAddress,
        actions: 0,
      });
    } catch (e) {
      setError(toPepuError(e, { op: "session grant" }));
    } finally {
      grantInFlight.current = false;
      setGranting(false);
    }
  }, [wallet, owner, authFetch, publicClient]);

  const act = useCallback(
    async (input?: I): Promise<O> => {
      try {
        const out = await postJson<O>(authFetch, endpointsRef.current.act, input === undefined ? {} : input);
        setError(undefined);
        refetch();
        return out;
      } catch (e) {
        const err = toPepuError(e, { op: "session act" });
        setError(err);
        // Only a 409 (SESSION_NONE) means the session is gone; any other failure is a failed action.
        if (err.code === "SESSION_NONE") {
          setStatus({ active: false });
          setLastValidUntil(undefined);
        }
        throw err;
      }
    },
    [authFetch, refetch],
  );

  const revoke = useCallback(async (): Promise<void> => {
    try {
      await postJson<{ active: false }>(authFetch, endpointsRef.current.revoke);
      setStatus({ active: false });
      setLastValidUntil(undefined);
      setPrepared(undefined);
      setError(undefined);
    } catch (e) {
      const err = toPepuError(e, { op: "session revoke" });
      setError(err);
      throw err;
    }
  }, [authFetch]);

  // `ready` must not flip to `signed-out` while Privy hydrates.
  const phase = deriveSessionPhase({
    authenticated: privyReady ? authenticated : false,
    hasWallet: owner !== undefined,
    validUntil: status?.active ? status.validUntil : lastValidUntil,
    nowSeconds: now,
    granting,
    hasError: error !== undefined,
  });
  const expiresAt = status?.active ? status.validUntil : lastValidUntil;
  const scope =
    prepared?.scope ??
    (expiresAt !== undefined
      ? describeKernelSessionScope({ calls: o.scope.calls, validUntil: expiresAt })
      : undefined);

  const statusLoading = privyReady && authenticated && owner !== undefined && !statusChecked && status === undefined;

  return {
    phase,
    statusLoading,
    ...(owner ? { owner } : {}),
    ...(smartAccount ? { smartAccount } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(status?.active ? { actions: status.actions } : {}),
    grant,
    act,
    revoke,
    refetch,
    ...(error ? { error } : {}),
  };
}
