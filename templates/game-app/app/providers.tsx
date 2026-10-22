"use client";

import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";
import { PRIVY_ENV } from "@pepu-chain/sdk/privy";
import { MissingConfigNotice } from "@/components/missing-config-notice";
import { privyAppId } from "@/lib/env";

/**
 * Privy + react-query + wagmi in the order Privy requires, on PEPU mainnet
 * only, with the embedded wallet pinned as wagmi's active account. The pin
 * matters more here than in the other templates: Privy only attaches a
 * session signer to an embedded wallet, so session-signer actions must never
 * target an external wallet that happened to become active. Session signers
 * work on the plain embedded EOA: no smart-wallet config is involved.
 *
 * A missing app id renders `MissingConfigNotice` instead of letting Privy
 * throw; the remaining variables are checked one level down by `<SetupGate>`.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PepuPrivyWagmiProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "light", accentColor: "#16a34a" },
      }}
      fallback={<MissingConfigNotice missing={[PRIVY_ENV.appId]} />}
    >
      {children}
    </PepuPrivyWagmiProvider>
  );
}
