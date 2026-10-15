import { usePrivy, useSigners } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { PEPU_ERROR_CATALOG, PepuAuthError, PepuError, PepuSessionError, toPepuError } from "../errors.js";
import type { PepuErrorCode } from "../errors.js";
import { usePepuAuthFetch } from "../privy/react.js";

/**
 * Client hooks for the Privy-mode session. Ported from
 * templates/game-app/components/session-consent-screen.tsx and
 * session-status-card.tsx. Auth defaults to `usePepuAuthFetch` from
 * `@pepu-chain/sdk/privy/react` (Privy bearer token); pass `authFetch` to use
 * your own.
 */

/** A fetch that adds the user's Privy bearer token. */
export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface BaseOptions {
  /** Custom authenticated fetch. Default: `usePepuAuthFetch()` (Privy bearer token). */
  authFetch?: AuthFetch;
  /** The embedded wallet address. Default: the Privy user's wallet. */
  address?: string;
}

const KNOWN_CODES = new Set<string>(PEPU_ERROR_CATALOG.map((e) => e.code));

/**
 * Turn a non-OK route response into a typed error. Reads the
 * `{ error: { code, message, hint } }` body the SDK route factories return.
 * Only a 409 means "no session" (`SESSION_NONE`).
 *
 * @example
 * if (!res.ok) throw await errorFromResponse(res);
 */
export async function errorFromResponse(res: Response): Promise<PepuError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; hint?: string } | string;
  } | null;
  const e = body?.error;
  const message = typeof e === "string" ? e : e?.message;
  const rawCode = typeof e === "object" ? e?.code : undefined;
  const code: PepuErrorCode =
    res.status === 409 && !rawCode
      ? "SESSION_NONE"
      : rawCode && KNOWN_CODES.has(rawCode)
        ? (rawCode as PepuErrorCode)
        : res.status === 401
          ? "AUTH_INVALID_TOKEN"
          : "UNKNOWN";
  const Cls = code === "SESSION_NONE" ? PepuSessionError : code === "AUTH_INVALID_TOKEN" ? PepuAuthError : PepuError;
  return new Cls(code, message ?? `Request failed (${res.status}).`, {
    status: res.status,
    ...(typeof e === "object" && e?.hint ? { hint: e.hint } : {}),
  });
}

/** Session state from the server's `delegated` flag and the locally tracked expiry. */
export type SessionState = "none" | "active" | "expired";

/**
 * Derive the session state. A delegated signer with a known expiry in the
 * past is `expired` (Privy denies it, but the signer still exists until
 * revoked). Pure.
 *
 * @example
 * deriveSessionState({ delegated: true, expiresAt: 100, nowSeconds: 200 }); // { state: "expired", secondsLeft: 0 }
 */
export function deriveSessionState(p: {
  delegated: boolean;
  expiresAt?: number | undefined;
  nowSeconds: number;
}): { state: SessionState; secondsLeft?: number } {
  if (!p.delegated) return { state: "none" };
  if (p.expiresAt === undefined) return { state: "active" };
  const secondsLeft = p.expiresAt - p.nowSeconds;
  return secondsLeft <= 0 ? { state: "expired", secondsLeft: 0 } : { state: "active", secondsLeft };
}

type G = { localStorage?: Storage; dispatchEvent?: (e: Event) => boolean; addEventListener?: (t: string, l: () => void) => void; removeEventListener?: (t: string, l: () => void) => void };
const CHANGE_EVENT = "pepu-session-change";
const storageKey = (address: string): string => `pepu:session:${address.toLowerCase()}`;

interface StoredSession {
  expiresAt: number;
  policyId?: string;
}

function readStored(address: string | undefined): StoredSession | undefined {
  if (!address) return undefined;
  try {
    const raw = (globalThis as G).localStorage?.getItem(storageKey(address));
    return raw ? (JSON.parse(raw) as StoredSession) : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(address: string, value: StoredSession | null): void {
  try {
    if (value) (globalThis as G).localStorage?.setItem(storageKey(address), JSON.stringify(value));
    else (globalThis as G).localStorage?.removeItem(storageKey(address));
  } catch {
    // Storage can be blocked; the session still works without a countdown.
  }
  (globalThis as G).dispatchEvent?.(new Event(CHANGE_EVENT));
}

function useAuthFetch(o: BaseOptions): { authFetch: AuthFetch; address: string | undefined } {
  const { user } = usePrivy();
  const pepuAuthFetch = usePepuAuthFetch();
  const custom = o.authFetch;
  const authFetch = useCallback<AuthFetch>(
    (url, init) => (custom ? custom(url, init) : pepuAuthFetch(url, init)),
    [custom, pepuAuthFetch],
  );
  return { authFetch, address: o.address ?? user?.wallet?.address };
}

export type SessionGrantStatus = "idle" | "creating-policy" | "awaiting-consent" | "granted" | "error";

/**
 * Grant a session: POST the grant route, then ask the user to approve with
 * Privy's `addSigners`. Skips `addSigners` when the server says
 * `alreadyGranted`, and swallows Privy's "duplicate signer" error.
 *
 * @example
 * const { grant, status, error } = useSessionGrant();
 * <button onClick={grant} disabled={status === "creating-policy"}>Grant</button>
 */
export function useSessionGrant(o: BaseOptions & { grantEndpoint?: string } = {}): {
  grant(): Promise<void>;
  status: SessionGrantStatus;
  error?: PepuError;
} {
  const { authFetch, address } = useAuthFetch(o);
  const { addSigners } = useSigners();
  const [status, setStatus] = useState<SessionGrantStatus>("idle");
  const [error, setError] = useState<PepuError | undefined>();
  const endpoint = o.grantEndpoint ?? "/api/session/grant";

  const grant = useCallback(async () => {
    setError(undefined);
    try {
      if (!address) throw new PepuAuthError("WALLET_NOT_PROVISIONED", "No embedded wallet address yet.");
      setStatus("creating-policy");
      const res = await authFetch(endpoint, { method: "POST" });
      if (!res.ok) throw await errorFromResponse(res);
      const body = (await res.json()) as
        | { alreadyGranted: true }
        | { alreadyGranted: false; policyId: string; expiresAt: number; signerId: string };
      if (!body.alreadyGranted) {
        setStatus("awaiting-consent");
        try {
          await addSigners({ address, signers: [{ signerId: body.signerId, policyIds: [body.policyId] }] });
        } catch (caught) {
          const msg = caught instanceof Error ? caught.message : "";
          if (!/duplicate signer/i.test(msg)) throw caught;
        }
        writeStored(address, { expiresAt: body.expiresAt, policyId: body.policyId });
      } else {
        (globalThis as G).dispatchEvent?.(new Event(CHANGE_EVENT));
      }
      setStatus("granted");
    } catch (e) {
      setError(toPepuError(e, { op: "session grant" }));
      setStatus("error");
    }
  }, [address, authFetch, endpoint, addSigners]);

  return { grant, status, ...(error ? { error } : {}) };
}

/**
 * Current session state. Asks the status route whether a signer is attached
 * and combines it with the expiry tracked from the grant. Ticks every second
 * for `secondsLeft`; re-polls every `pollMs` if given.
 *
 * @example
 * const { state, secondsLeft } = useSessionStatus({ pollMs: 30_000 });
 */
export function useSessionStatus(o: BaseOptions & { statusEndpoint?: string; pollMs?: number } = {}): {
  state: SessionState;
  /**
   * True until the first status response (or failure) has been applied. Show a
   * spinner while it is true so the "start a session" UI does not flash on reload.
   */
  loading: boolean;
  expiresAt?: number;
  secondsLeft?: number;
  refetch(): void;
} {
  const { authFetch, address } = useAuthFetch(o);
  const endpoint = o.statusEndpoint ?? "/api/session/status";
  const [delegated, setDelegated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverExpiresAt, setServerExpiresAt] = useState<number | undefined>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch(endpoint);
        if (!res.ok) return;
        const body = (await res.json()) as { delegated?: boolean; expiresAt?: number };
        if (cancelled) return;
        setDelegated(Boolean(body.delegated));
        setServerExpiresAt(body.expiresAt);
      } catch {
        // Keep the last known state on a transient failure.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch, endpoint, tick]);

  useEffect(() => {
    const onChange = (): void => setTick((t) => t + 1);
    (globalThis as G).addEventListener?.(CHANGE_EVENT, onChange);
    return () => (globalThis as G).removeEventListener?.(CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!o.pollMs) return;
    const id = setInterval(() => setTick((t) => t + 1), o.pollMs);
    return () => clearInterval(id);
  }, [o.pollMs]);

  const expiresAt = serverExpiresAt ?? readStored(address)?.expiresAt;
  const derived = deriveSessionState({ delegated, expiresAt, nowSeconds: now });
  return {
    state: derived.state,
    loading,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(derived.secondsLeft !== undefined ? { secondsLeft: derived.secondsLeft } : {}),
    refetch,
  };
}

export type SessionRevokeStatus = "idle" | "revoking" | "revoked" | "error";

/**
 * Revoke the session. The Privy `removeSigners` call is the real revoke; the
 * server revoke route afterwards is best-effort cleanup of the policy.
 *
 * @example
 * const { revoke, status } = useSessionRevoke();
 */
export function useSessionRevoke(o: BaseOptions & { revokeEndpoint?: string } = {}): {
  revoke(): Promise<void>;
  status: SessionRevokeStatus;
  error?: PepuError;
} {
  const { authFetch, address } = useAuthFetch(o);
  const { removeSigners } = useSigners();
  const [status, setStatus] = useState<SessionRevokeStatus>("idle");
  const [error, setError] = useState<PepuError | undefined>();
  const endpoint = o.revokeEndpoint ?? "/api/session/revoke";

  const revoke = useCallback(async () => {
    setError(undefined);
    try {
      if (!address) throw new PepuAuthError("WALLET_NOT_PROVISIONED", "No embedded wallet address yet.");
      setStatus("revoking");
      const stored = readStored(address);
      await removeSigners({ address });
      try {
        await authFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ policyId: stored?.policyId }),
        });
      } catch {
        // Cleanup only; the signer is already gone.
      }
      writeStored(address, null);
      setStatus("revoked");
    } catch (e) {
      setError(toPepuError(e, { op: "session revoke" }));
      setStatus("error");
    }
  }, [address, authFetch, endpoint, removeSigners]);

  return { revoke, status, ...(error ? { error } : {}) };
}

export type SessionActStatus = "idle" | "pending" | "success" | "error";

/**
 * Call a session action route (built with `createSessionActionRoute`). A 409
 * is the only "no session" signal and surfaces as `error.code ===
 * "SESSION_NONE"`; any other failure is a failed transaction, so do not send
 * the user back to the consent screen for it.
 *
 * @example
 * const { act } = useSessionAct<{}, { hash: string }>({ endpoint: "/api/game/tap" });
 * const { hash } = await act({});
 */
export function useSessionAct<I, O>(o: BaseOptions & { endpoint: string }): {
  act(input: I): Promise<O>;
  status: SessionActStatus;
  error?: PepuError;
} {
  const { authFetch } = useAuthFetch(o);
  const [status, setStatus] = useState<SessionActStatus>("idle");
  const [error, setError] = useState<PepuError | undefined>();

  const act = useCallback(
    async (input: I): Promise<O> => {
      setStatus("pending");
      setError(undefined);
      try {
        const res = await authFetch(o.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input ?? {}),
        });
        if (!res.ok) throw await errorFromResponse(res);
        const out = (await res.json()) as O;
        setStatus("success");
        return out;
      } catch (e) {
        const err = toPepuError(e, { op: "session action" });
        setError(err);
        setStatus("error");
        throw err;
      }
    },
    [authFetch, o.endpoint],
  );

  return { act, status, ...(error ? { error } : {}) };
}
