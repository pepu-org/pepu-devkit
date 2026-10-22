"use client";

import { usePrivy } from "@privy-io/react-auth";
import { WalletGate } from "@pepu-chain/sdk/privy/react";
import { Header } from "@/components/header";
import { WalletCard } from "@/components/wallet-card";
import { TokenGatePanel } from "@/components/token-gate-panel";

export function SignedInView() {
  const { logout, user } = usePrivy();

  return (
    <div className="min-h-screen">
      <Header>
        <button
          onClick={logout}
          className="btn btn-ghost btn-sm"
        >
          Sign out
        </button>
      </Header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 sm:px-6">
        <div className="reveal mb-6">
          <p className="text-sm text-ink-muted">Signed in as</p>
          <p className="font-display text-xl font-bold break-words text-ink">
            {user?.email?.address ?? user?.google?.email ?? "your account"}
          </p>
        </div>

        <div className="stagger space-y-4">
          <WalletGate loading={walletLoading} error={walletError} stalled={walletStalled}>
            <WalletCard />
            <TokenGatePanel />
          </WalletGate>
        </div>
      </main>
    </div>
  );
}

/**
 * The SDK's `WalletGate` provisions the embedded wallet (ensure-route call,
 * request bound, `refreshUser()`, the bounded "never appeared in this session"
 * stall, StrictMode-safe retries) and gates on the EMBEDDED wallet, never on
 * "any connected wallet". These three render props are only the PEPU styling.
 * Do not remove the gate: `createOnLogin` is `"off"` (the SDK default), so
 * this is what creates the wallet. See README for why creation is server-side.
 */
const walletLoading = (
  <div className="card flex items-center gap-3 text-sm text-ink-soft">
    <span className="spinner spinner-sm shrink-0" role="status" aria-label="Loading" />
    Setting up your wallet…
  </div>
);

const walletError = (error: { message: string }, retry: () => void) => (
  <div className="notice notice-danger p-5!" role="alert">
    <p className="notice-title">Could not create your wallet.</p>
    <p className="mt-1">{error.message}</p>
    <button type="button" onClick={retry} className="btn btn-danger btn-sm mt-4">
      Try again
    </button>
  </div>
);

const walletStalled = (address: string, reload: () => void) => (
  <div className="notice notice-warn p-5!" role="status">
    <p className="notice-title">
      Your wallet was created ({address.slice(0, 6)}…{address.slice(-4)}), but it hasn&apos;t
      appeared in this session yet.
    </p>
    <p className="mt-1">
      This is a client sync delay, not a lost wallet — the address above is real and already
      exists. Reloading usually fixes it.
    </p>
    <button type="button" onClick={reload} className="btn btn-warn btn-sm mt-4">
      Reload
    </button>
  </div>
);
