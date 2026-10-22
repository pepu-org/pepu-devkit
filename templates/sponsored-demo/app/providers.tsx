"use client";

import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { composeProviders, PepuPrivyProvider } from "@pepu-chain/sdk/privy/react";
import { MissingConfigNotice } from "@/components/missing-config-notice";
import { privyAppId } from "@/lib/env";

/**
 * `SmartWalletsProvider` must nest inside `PrivyProvider` (`useSmartWallets()`
 * reads a context it establishes). Which chain, bundler and paymaster it talks
 * to comes from the Privy Dashboard's "Smart Wallets" configuration (chain
 * 97741, provider Kernel, your bundler and paymaster URLs): there is no
 * client-side config for that here, by design. Built once at module level so
 * the wrapper keeps one component identity across renders.
 */
const WithSmartWallets = composeProviders([[SmartWalletsProvider, {}]]);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PepuPrivyProvider
      appId={privyAppId}
      // Google and email only: no "wallet" connector, so no Coinbase Smart
      // Wallet noise. Wallet creation is off; <WalletGate> provisions it.
      config={{
        loginMethods: ["google", "email"],
        appearance: { theme: "light", accentColor: "#16a34a" },
      }}
      fallback={<MissingConfigNotice />}
      wrapper={WithSmartWallets}
    >
      {children}
    </PepuPrivyProvider>
  );
}
