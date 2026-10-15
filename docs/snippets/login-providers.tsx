// Pillar 1, client: Google sign-in and an embedded wallet.
// See docs/sdk/privy-react.md and docs/onboarding/privy-embedded-wallets.md
import type { ReactNode } from "react";
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";
import { WalletGate, useEmbeddedWallet } from "@pepu-chain/sdk/privy/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PepuPrivyWagmiProvider
      // Read literally so the framework inlines it into the browser bundle.
      appId={process.env["NEXT_PUBLIC_PRIVY_APP_ID"]?.trim()}
      config={{ loginMethods: ["email", "google", "wallet"] }}
      fallback={<p>Set NEXT_PUBLIC_PRIVY_APP_ID</p>}
    >
      {children}
    </PepuPrivyWagmiProvider>
  );
}

function Address() {
  const { address } = useEmbeddedWallet();
  return <code>{address}</code>;
}

// Renders children once the embedded wallet exists, provisioning it through
// the ensure-wallet route (see ensure-wallet-route.ts) if needed.
export function Gated() {
  return (
    <WalletGate
      loading={<p>Setting up your wallet</p>}
      error={(e, retry) => (
        <button onClick={retry}>
          {e.message} Retry
        </button>
      )}
      stalled={(address, reload) => <button onClick={reload}>Wallet {address} is ready, reload</button>}
    >
      <Address />
    </WalletGate>
  );
}
