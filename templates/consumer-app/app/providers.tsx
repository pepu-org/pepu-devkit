"use client";

import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";
import { MissingConfigNotice } from "@/components/missing-config-notice";

/**
 * Everything the app needs from Privy + wagmi comes from the SDK:
 * `PepuPrivyWagmiProvider` mounts PrivyProvider (mainnet only, Coinbase pinned
 * to `eoaOnly`, wallet creation `"off"`), react-query and `@privy-io/wagmi`'s
 * WagmiProvider in the order Privy requires, and keeps wagmi's active account
 * pinned to the Privy embedded wallet (`useActiveWalletPin`). It renders
 * `fallback` instead of throwing deep inside Privy when the app id is unset.
 *
 * `loginMethods` is a starting point, not the source of truth: the methods
 * offered at login are the intersection of this list and what is enabled in
 * your Privy Dashboard under "User management" -> "Login methods".
 *
 * `NEXT_PUBLIC_PRIVY_APP_ID` is read literally so Next.js inlines it.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PepuPrivyWagmiProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "light", accentColor: "#16a34a" },
      }}
      fallback={<MissingConfigNotice />}
    >
      {children}
    </PepuPrivyWagmiProvider>
  );
}
