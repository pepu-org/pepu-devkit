import { pepuMainnet } from "../chains.js";
import type { PepuChain } from "../chains.js";

/**
 * Typed Privy client config for PEPU (`@pepu-chain/sdk/privy`). Client-safe:
 * no secrets, no Node APIs, and no dependency on any Privy package (the result
 * is structurally assignable to `PrivyClientConfig` from
 * `@privy-io/react-auth`).
 *
 * What it encodes, each a real, reproduced PEPU requirement:
 *
 * - `defaultChain` / `supportedChains` are PEPU mainnet only.
 * - `embeddedWallets.ethereum.createOnLogin` defaults to `"off"`: the
 *   recommended pattern is to provision the wallet server-side (see the
 *   wallet-provisioning recipe). NOTE the Privy Dashboard's setting wins over
 *   this value at runtime; it is kept for intent and documentation.
 * - Coinbase Wallet is pinned to `eoaOnly`: Coinbase Smart Wallet does not
 *   support chain 97741, and the default floods the console with "The
 *   configured chains are not supported by Coinbase Smart Wallet".
 */

export type PrivyLoginMethod =
  | "email"
  | "google"
  | "wallet"
  | "sms"
  | "apple"
  | "twitter"
  | "discord"
  | "github";

export type EmbeddedWalletCreateOnLogin = "off" | "users-without-wallets" | "all-users";

export interface PepuPrivyClientConfig {
  loginMethods?: PrivyLoginMethod[];
  appearance?: { theme?: "light" | "dark" | `#${string}`; accentColor?: `#${string}`; logo?: string };
  defaultChain: PepuChain;
  supportedChains: PepuChain[];
  embeddedWallets: {
    ethereum: { createOnLogin: EmbeddedWalletCreateOnLogin };
  };
  externalWallets: {
    coinbaseWallet: { config: { preference: { options: "eoaOnly" } } };
  };
}

export interface CreatePepuPrivyConfigOptions {
  loginMethods?: PrivyLoginMethod[];
  appearance?: PepuPrivyClientConfig["appearance"];
  /** Default `"off"`. The Privy Dashboard setting overrides this at runtime. */
  createOnLogin?: EmbeddedWalletCreateOnLogin;
  /** Default {@link pepuMainnet}. Only pass a different PEPU chain deliberately. */
  chain?: PepuChain;
}

/** Build the `config` prop for Privy's `<PrivyProvider>` on PEPU. */
export function createPepuPrivyConfig(
  options: CreatePepuPrivyConfigOptions = {},
): PepuPrivyClientConfig {
  const chain = options.chain ?? pepuMainnet;
  return {
    ...(options.loginMethods ? { loginMethods: options.loginMethods } : {}),
    ...(options.appearance ? { appearance: options.appearance } : {}),
    defaultChain: chain,
    supportedChains: [chain],
    embeddedWallets: {
      ethereum: { createOnLogin: options.createOnLogin ?? "off" },
    },
    externalWallets: {
      coinbaseWallet: { config: { preference: { options: "eoaOnly" } } },
    },
  };
}

export * from "./requirements.js";
