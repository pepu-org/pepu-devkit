"use client";

import { PepuPrivyProvider } from "@pepu-chain/sdk/privy/react";
import { MissingConfigNotice } from "@/components/missing-config-notice";

/**
 * Only `PepuPrivyProvider` (mainnet only, wallet creation off, Coinbase pinned
 * to EOA). There is no smart-wallets provider: the Kernel account and its
 * session key are built by the SDK (`@pepu-chain/sdk/session/kernel`) with
 * ZeroDev, so nothing about smart wallets needs configuring in the Privy
 * Dashboard. When the app id is missing the fallback renders instead of
 * Privy throwing deep inside its SDK.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PepuPrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()}
      config={{ loginMethods: ["google", "email"], appearance: { theme: "light", accentColor: "#16a34a" } }}
      fallback={<MissingConfigNotice missing={["NEXT_PUBLIC_PRIVY_APP_ID"]} />}
    >
      {children}
    </PepuPrivyProvider>
  );
}
