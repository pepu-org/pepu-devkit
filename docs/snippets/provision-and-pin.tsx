// Provision the embedded wallet and keep it the active account.
// See docs/recipes/provision-and-pin-the-wallet.md
import type { ReactNode } from "react";
import { useActiveWalletPin } from "@pepu-chain/sdk/privy/wagmi";
import { WalletGate, useEmbeddedWallet, useEnsureWallet } from "@pepu-chain/sdk/privy/react";

// Inside PepuPrivyWagmiProvider the pin is already mounted. Call this yourself only when you
// built your own provider tree.
export function Pin(): null {
  useActiveWalletPin();
  return null;
}

// The hook behind WalletGate, for custom UI.
export function Custom({ children }: { children: ReactNode }) {
  const { status, address, error, retry } = useEnsureWallet({ endpoint: "/api/wallet/ensure" });
  const { external } = useEmbeddedWallet();

  if (status === "error") return <button onClick={retry}>{error?.message}</button>;
  if (status !== "ready") return <p>{status}</p>;
  return (
    <div>
      <p>Embedded wallet {address}. External wallets tracked by Privy: {external.length}</p>
      {children}
    </div>
  );
}

// Or the finished component.
export const Gated = ({ children }: { children: ReactNode }) => <WalletGate>{children}</WalletGate>;
