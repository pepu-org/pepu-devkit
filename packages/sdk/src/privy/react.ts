import { createElement, Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { getEmbeddedConnectedWallet, PrivyProvider, usePrivy, useUser, useWallets } from "@privy-io/react-auth";
import type { ConnectedWallet, PrivyClientConfig } from "@privy-io/react-auth";
import type { Address } from "viem";
import { PepuAuthError, PepuError, toPepuError } from "../errors.js";
import { createPepuPrivyConfig, PRIVY_ENV } from "./config.js";
import type { CreatePepuPrivyConfigOptions } from "./config.js";
import {
  DEFAULT_ENSURE_APPEAR_TIMEOUT_MS,
  DEFAULT_ENSURE_ENDPOINT,
  DEFAULT_ENSURE_REQUEST_TIMEOUT_MS,
  requestEnsureWallet,
} from "./ensure-client.js";

/**
 * `@pepu-chain/sdk/privy/react` (browser). Provider, embedded-wallet
 * detection, wallet provisioning and the gate. Add `"use client"` in the file
 * where you import these from a Next.js server component.
 *
 * `react` and `@privy-io/react-auth` are optional peers of this entry only.
 */

export { requestEnsureWallet } from "./ensure-client.js";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface PepuPrivyProviderProps {
  /** Privy app id. When missing, `fallback` renders instead of throwing deep inside Privy. */
  appId: string | undefined;
  /** Overrides for {@link createPepuPrivyConfig}. */
  config?: Partial<CreatePepuPrivyConfigOptions> | undefined;
  /** Shown when `appId` is empty. Defaults to a short notice naming the env variable. */
  fallback?: ReactNode;
  /**
   * Extra providers rendered inside PrivyProvider (used by `/privy/wagmi`).
   * Build one with {@link composeProviders}.
   */
  wrapper?: ComponentType<{ children?: ReactNode }> | undefined;
  children?: ReactNode;
}

/**
 * Compose providers (outermost first) into one wrapper component, with optional
 * leaf components rendered next to `children` in the innermost position. A
 * building block for `/privy/wagmi`; it keeps `react` imports in this entry.
 *
 * @example
 * ```ts
 * const Wrapper = composeProviders([[QueryClientProvider, { client }]], [MyEffectOnlyComponent]);
 * ```
 */
export function composeProviders(
  layers: readonly (readonly [ComponentType<any>, Record<string, unknown>])[], // eslint-disable-line @typescript-eslint/no-explicit-any
  leaves: readonly ComponentType<Record<string, never>>[] = [],
): ComponentType<{ children?: ReactNode }> {
  return function ComposedProviders({ children }: { children?: ReactNode }): ReactElement {
    let node: ReactElement = createElement(
      Fragment,
      null,
      ...leaves.map((Leaf, i) => createElement(Leaf as ComponentType<{ key?: string }>, { key: `leaf-${i}` })),
      children,
    );
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer) continue;
      node = createElement(layer[0], layer[1], node);
    }
    return node;
  };
}

/**
 * `<PrivyProvider>` preconfigured for PEPU: mainnet only, Coinbase pinned to
 * `eoaOnly`, wallet creation off (the server provisions it, see
 * {@link WalletGate}). Renders `fallback` instead of crashing when `appId` is
 * missing.
 *
 * Ported from templates/consumer-app/app/providers.tsx.
 *
 * @example
 * ```tsx
 * <PepuPrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID} config={{ loginMethods: ["email", "google"] }}>
 *   <App />
 * </PepuPrivyProvider>
 * ```
 */
export function PepuPrivyProvider(props: PepuPrivyProviderProps): ReactElement {
  const { appId, config, fallback, wrapper, children } = props;
  if (!appId) {
    return createElement(
      Fragment,
      null,
      fallback ??
        createElement(
          "div",
          { role: "alert" },
          `Missing ${PRIVY_ENV.appId}. Set it to your Privy app id and restart the dev server.`,
        ),
    );
  }
  const inner: ReactNode = wrapper ? createElement(wrapper, null, children) : children;
  return createElement(PrivyProvider, {
    appId,
    config: createPepuPrivyConfig(config) as unknown as PrivyClientConfig,
    children: inner,
  });
}

// ---------------------------------------------------------------------------
// Embedded wallet
// ---------------------------------------------------------------------------

/**
 * This user's Privy embedded wallet, separated from any external wallet Privy
 * is tracking (an installed MetaMask or Phantom). Never re-implements the
 * embedded filter: it calls Privy's `getEmbeddedConnectedWallet`.
 *
 * Ported from templates/consumer-app/lib/wallet.ts (`useWalletSnapshot`).
 *
 * @example
 * ```tsx
 * const { ready, address, external } = useEmbeddedWallet();
 * ```
 */
export function useEmbeddedWallet(): {
  ready: boolean;
  wallet: ConnectedWallet | null;
  address?: Address;
  external: ConnectedWallet[];
} {
  const { wallets, ready } = useWallets();
  const wallet = getEmbeddedConnectedWallet(wallets);
  const external = wallets.filter((w) => w !== wallet);
  return wallet
    ? { ready, wallet, address: wallet.address as Address, external }
    : { ready, wallet: null, external };
}

/**
 * Pure decision behind the pin hooks: pin only when enabled, hydrated, an
 * embedded wallet exists and the active account is not already it. The address
 * comparison is what prevents a render loop.
 *
 * @example
 * ```ts
 * shouldPinEmbeddedWallet({ enabled: true, ready: true, embeddedAddress: "0xA", activeAddress: "0xB" }); // true
 * ```
 */
export function shouldPinEmbeddedWallet(o: {
  enabled: boolean;
  ready: boolean;
  embeddedAddress: string | undefined;
  activeAddress: string | undefined;
}): boolean {
  if (!o.enabled || !o.ready || !o.embeddedAddress) return false;
  return o.activeAddress?.toLowerCase() !== o.embeddedAddress.toLowerCase();
}

/**
 * Generic half of the active-wallet pin: re-asserts the embedded wallet whenever
 * the active account drifts away from it. `useActiveWalletPin` in
 * `/privy/wagmi` supplies wagmi's active address and `setActiveWallet`.
 *
 * Ported from templates/consumer-app/lib/wallet.ts (`useActiveWalletSync`).
 * A user with no embedded wallet is left alone on purpose.
 *
 * @example
 * ```ts
 * usePinEmbeddedWallet({ enabled: true, activeAddress, setActiveWallet });
 * ```
 */
export function usePinEmbeddedWallet(o: {
  enabled: boolean;
  activeAddress: string | undefined;
  setActiveWallet: (wallet: ConnectedWallet) => Promise<unknown> | void;
}): void {
  const { enabled, activeAddress, setActiveWallet } = o;
  const { wallets, ready } = useWallets();
  const embedded = getEmbeddedConnectedWallet(wallets);
  const embeddedAddress = embedded?.address;
  useEffect(() => {
    if (!embedded) return;
    if (!shouldPinEmbeddedWallet({ enabled, ready, embeddedAddress, activeAddress })) return;
    void setActiveWallet(embedded);
  }, [enabled, ready, embedded, embeddedAddress, activeAddress, setActiveWallet]);
}

// ---------------------------------------------------------------------------
// Ensure wallet
// ---------------------------------------------------------------------------

type FetchInput = Parameters<typeof fetch>[0];

export type EnsureWalletStatus = "idle" | "checking" | "creating" | "ready" | "stalled" | "error";

/**
 * Provision this user's embedded wallet through the ensure-wallet route (see
 * `createEnsureWalletRoute` in `/privy/server`), not Privy's client-side
 * creation, which hangs for apps with the dashboard's creation setting off.
 * Gates on the EMBEDDED wallet, never on "any connected wallet".
 *
 * Ported from templates/consumer-app/components/wallet-gate.tsx.
 *
 * @example
 * ```tsx
 * const { status, address, error, retry } = useEnsureWallet();
 * ```
 */
export function useEnsureWallet(o: { endpoint?: string; requestTimeoutMs?: number; appearTimeoutMs?: number } = {}): {
  status: EnsureWalletStatus;
  address?: Address;
  error?: PepuError;
  retry(): void;
} {
  const endpoint = o.endpoint ?? DEFAULT_ENSURE_ENDPOINT;
  const requestTimeoutMs = o.requestTimeoutMs ?? DEFAULT_ENSURE_REQUEST_TIMEOUT_MS;
  const appearTimeoutMs = o.appearTimeoutMs ?? DEFAULT_ENSURE_APPEAR_TIMEOUT_MS;

  const { ready: privyReady, authenticated, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { refreshUser } = useUser();

  const [error, setError] = useState<PepuError | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [confirmed, setConfirmed] = useState<Address | null>(null);
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The attempt number whose request already settled. An unsettled attempt is
  // restarted if the effect re-runs (React StrictMode mounts effects twice), a
  // settled one never is, so a re-render cannot trigger a second POST.
  const settledFor = useRef(-1);
  // Latest Privy callbacks, kept out of the effect deps so a new function
  // identity never cancels an in-flight request.
  const getAccessTokenRef = useRef(getAccessToken);
  const refreshUserRef = useRef(refreshUser);
  getAccessTokenRef.current = getAccessToken;
  refreshUserRef.current = refreshUser;

  const embedded = getEmbeddedConnectedWallet(wallets);
  const hasWallet = embedded !== null;

  useEffect(() => {
    if (!privyReady || !authenticated || !walletsReady || hasWallet) return;
    if (settledFor.current === attempt) return;

    let cancelled = false;
    const controller = new AbortController();
    setRequesting(true);
    void (async () => {
      try {
        const { address } = await requestEnsureWallet({
          getAccessToken: () => getAccessTokenRef.current(),
          endpoint,
          timeoutMs: requestTimeoutMs,
          signal: controller.signal,
        });
        // Pull the server-side change into Privy's client state without a reload.
        await refreshUserRef.current();
        if (cancelled) return;
        settledFor.current = attempt;
        setConfirmed(address);
      } catch (e) {
        if (cancelled) return;
        settledFor.current = attempt;
        setError(toPepuError(e, { op: "ensure wallet" }));
      } finally {
        if (!cancelled) setRequesting(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [privyReady, authenticated, walletsReady, hasWallet, attempt, endpoint, requestTimeoutMs]);

  // Bounded safety net: the server confirmed the wallet, the client never saw it.
  useEffect(() => {
    if (!confirmed || hasWallet) return;
    const id = setTimeout(() => setStalled(true), appearTimeoutMs);
    return () => {
      clearTimeout(id);
      setStalled(false);
    };
  }, [confirmed, hasWallet, appearTimeoutMs]);

  const retry = useCallback((): void => {
    setError(null);
    setConfirmed(null);
    setStalled(false);
    setRequesting(false);
    setAttempt((n) => n + 1);
  }, []);

  if (hasWallet) return { status: "ready", address: embedded.address as Address, retry };
  if (!privyReady || !authenticated || !walletsReady) return { status: "idle", retry };
  if (error) return { status: "error", error, retry };
  if (stalled && confirmed) return { status: "stalled", address: confirmed, retry };
  if (confirmed) return { status: "checking", address: confirmed, retry };
  return { status: requesting ? "creating" : "checking", retry };
}

/**
 * Renders `children` once the user's embedded wallet exists, provisioning it
 * first through the ensure-wallet route. Shows `loading`, an error (with
 * retry) or a reload prompt when the wallet exists but has not synced yet.
 * Each of the three states takes a render prop (`loading`, `error`, `stalled`)
 * so an app can use the gate directly with its own markup and classes.
 *
 * Ported from templates/consumer-app/components/wallet-gate.tsx.
 *
 * @example
 * ```tsx
 * <WalletGate
 *   loading={<Spinner />}
 *   error={(e, retry) => <button onClick={retry}>{e.message}</button>}
 *   stalled={(address, reload) => <button onClick={reload}>Reload ({address})</button>}
 * >
 *   <Dashboard />
 * </WalletGate>
 * ```
 */
export function WalletGate(p: {
  endpoint?: string;
  loading?: ReactNode;
  error?: (e: PepuError, retry: () => void) => ReactNode;
  /**
   * The server confirmed the wallet but this session has not seen it after a
   * bounded wait (a client sync delay). `reload` reloads the page.
   */
  stalled?: (address: Address, reload: () => void) => ReactNode;
  children: ReactNode;
}): ReactElement {
  const ensure = useEnsureWallet(p.endpoint !== undefined ? { endpoint: p.endpoint } : {});
  if (ensure.status === "ready") return createElement(Fragment, null, p.children);

  if (ensure.status === "error" && ensure.error) {
    const { error, retry } = ensure;
    return createElement(
      Fragment,
      null,
      p.error
        ? p.error(error, retry)
        : createElement(
            "div",
            { role: "alert" },
            createElement("p", null, "Could not create your wallet."),
            createElement("p", null, error.message),
            createElement("button", { type: "button", onClick: retry }, "Try again"),
          ),
    );
  }

  if (ensure.status === "stalled" && ensure.address) {
    const a = ensure.address;
    const reload = (): void => (globalThis as unknown as { location: { reload(): void } }).location.reload();
    if (p.stalled) return createElement(Fragment, null, p.stalled(a, reload));
    return createElement(
      "div",
      { role: "status" },
      createElement("p", null, `Your wallet was created (${a.slice(0, 6)}…${a.slice(-4)}), but it has not appeared in this session yet.`),
      createElement("p", null, "This is a client sync delay, not a lost wallet. Reloading usually fixes it."),
      createElement("button", { type: "button", onClick: reload }, "Reload"),
    );
  }

  return createElement(
    Fragment,
    null,
    p.loading ?? createElement("div", { role: "status", "aria-label": "Loading" }, "Setting up your wallet…"),
  );
}

// ---------------------------------------------------------------------------
// Authenticated fetch
// ---------------------------------------------------------------------------

/**
 * A `fetch` that attaches `Authorization: Bearer <Privy access token>`. Throws
 * {@link PepuAuthError} when there is no token (signed out or expired).
 *
 * @example
 * ```tsx
 * const authFetch = usePepuAuthFetch();
 * const res = await authFetch("/api/session/status");
 * ```
 */
export function usePepuAuthFetch(): (input: FetchInput, init?: RequestInit) => Promise<Response> {
  const { getAccessToken } = usePrivy();
  return useCallback(
    async (input: FetchInput, init?: RequestInit): Promise<Response> => {
      const token = await getAccessToken();
      if (!token) {
        throw new PepuAuthError(
          "AUTH_INVALID_TOKEN",
          "No Privy access token for this session. Sign in again.",
        );
      }
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    [getAccessToken],
  );
}
