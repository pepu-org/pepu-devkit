import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createConfig, WagmiProvider, useSetActiveWallet } from "@privy-io/wagmi";
import { http, useAccount } from "wagmi";
import type { Config } from "wagmi";
import { pepuMainnet } from "../chains.js";
import type { PepuChain } from "../chains.js";
import { composeProviders, PepuPrivyProvider, usePinEmbeddedWallet } from "./react.js";
import type { PepuPrivyProviderProps } from "./react.js";

/**
 * `@pepu-chain/sdk/privy/wagmi` (browser). wagmi config for PEPU, a combined
 * Privy + react-query + wagmi provider, and the active-wallet pin.
 *
 * `react` is never imported here directly (the boundary test only allows it in
 * `react.ts` files): React-level glue lives in `./react.ts` and is reused.
 *
 * Optional peers of this entry only: `wagmi`, `@privy-io/wagmi`,
 * `@tanstack/react-query`.
 */

/**
 * Default policy: keep the user's Privy embedded wallet pinned as wagmi's active
 * account whenever one exists. Pass `{ enabled: false }` to `useActiveWalletPin`
 * (or `pinEmbeddedWallet={false}` to the provider) to opt out, for example for
 * an app that is deliberately external-wallet-first.
 *
 * Ported from templates/consumer-app/lib/wallet.ts.
 */
export const EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT = true;

/**
 * A wagmi config for PEPU, built with `@privy-io/wagmi`'s `createConfig` (plain
 * wagmi's is a documented footgun with Privy: embedded wallets would not appear
 * as a connector). The chain carries `contracts.multicall3` at PEPU's own
 * address, so batched reads work.
 *
 * Ported from templates/consumer-app/lib/wagmi-config.ts.
 *
 * @example
 * ```ts
 * const wagmiConfig = pepuWagmiConfig();
 * const custom = pepuWagmiConfig({ rpcUrl: "https://my-rpc.example.com" });
 * ```
 */
export function pepuWagmiConfig(o: { chain?: PepuChain; rpcUrl?: string } = {}): Config {
  const chain = o.chain ?? pepuMainnet;
  return createConfig({
    chains: [chain],
    transports: { [chain.id]: http(o.rpcUrl) },
  } as Parameters<typeof createConfig>[0]) as unknown as Config;
}

/**
 * Keeps wagmi's active account (what `useAccount`, `useBalance` and
 * `useSendTransaction` act on) pinned to the user's Privy embedded wallet.
 * Without it an installed extension such as Phantom can silently become the
 * active account. It only calls `setActiveWallet` when the active address
 * differs from the embedded wallet's, so it cannot loop; a user with no
 * embedded wallet is left alone. Call it once near the root, inside the wagmi
 * provider (`PepuPrivyWagmiProvider` already does).
 *
 * Ported from templates/consumer-app/lib/wallet.ts (`useActiveWalletSync`).
 *
 * @example
 * ```tsx
 * function Pin() { useActiveWalletPin(); return null; }
 * ```
 */
export function useActiveWalletPin(o: { enabled?: boolean } = {}): void {
  const { enabled = EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT } = o;
  const { address } = useAccount();
  const { setActiveWallet } = useSetActiveWallet();
  usePinEmbeddedWallet({ enabled, activeAddress: address, setActiveWallet });
}

function ActiveWalletPinLeaf(): null {
  useActiveWalletPin();
  return null;
}

export type PepuPrivyWagmiProviderProps = Omit<PepuPrivyProviderProps, "wrapper"> & {
  wagmiConfig?: Config | undefined;
  queryClient?: QueryClient | undefined;
  /** Default {@link EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT}. */
  pinEmbeddedWallet?: boolean | undefined;
};

type Wrapper = NonNullable<PepuPrivyProviderProps["wrapper"]>;
type Leaf = NonNullable<Parameters<typeof composeProviders>[1]>[number];
// A wrapper must keep one component identity per (config, client, pin), or
// React would remount the whole tree on every render.
const wrapperCache = new WeakMap<Config, WeakMap<QueryClient, Partial<Record<"pin" | "nopin", Wrapper>>>>();

function wrapperFor(config: Config, client: QueryClient, pin: boolean): Wrapper {
  let byClient = wrapperCache.get(config);
  if (!byClient) wrapperCache.set(config, (byClient = new WeakMap()));
  let slot = byClient.get(client);
  if (!slot) byClient.set(client, (slot = {}));
  const key = pin ? "pin" : "nopin";
  return (slot[key] ??= composeProviders(
    [
      [QueryClientProvider, { client }],
      [WagmiProvider, { config }],
    ],
    pin ? [ActiveWalletPinLeaf as Leaf] : [],
  ));
}

let defaultConfig: Config | undefined;
let defaultClient: QueryClient | undefined;

/**
 * `PepuPrivyProvider` + react-query + `@privy-io/wagmi`'s `WagmiProvider`, in
 * the order Privy requires, with the active-wallet pin mounted. Defaults to
 * {@link pepuWagmiConfig} and a shared `QueryClient` (a fresh one per render on
 * the server, so requests never share a cache).
 *
 * Ported from templates/consumer-app/app/providers.tsx.
 *
 * @example
 * ```tsx
 * <PepuPrivyWagmiProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}>
 *   <App />
 * </PepuPrivyWagmiProvider>
 * ```
 */
export function PepuPrivyWagmiProvider(p: PepuPrivyWagmiProviderProps): ReturnType<typeof PepuPrivyProvider> {
  const { wagmiConfig, queryClient, pinEmbeddedWallet, ...rest } = p;
  const config = wagmiConfig ?? (defaultConfig ??= pepuWagmiConfig());
  const client =
    queryClient ??
    ((globalThis as { window?: unknown }).window === undefined ? new QueryClient() : (defaultClient ??= new QueryClient()));
  const wrapper = wrapperFor(config, client, pinEmbeddedWallet ?? EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT);
  // PepuPrivyProvider is a hook-free function component, so calling it returns
  // its element without needing `createElement` (and so without importing react).
  return PepuPrivyProvider({ ...rest, wrapper });
}
