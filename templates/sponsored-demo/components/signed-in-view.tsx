"use client";

import { usePrivy } from "@privy-io/react-auth";
import { WalletGate } from "@pepu-chain/sdk/privy/react";
import { PepuMark } from "@/components/pepu-mark";
import { SponsoredTapDemo } from "@/components/sponsored-tap-demo";

export function SignedInView() {
  const { logout } = usePrivy();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
      <header className="reveal mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          <PepuMark size={36} />
          <div>
            <p className="eyebrow eyebrow-brand">PEPU sponsored tap demo</p>
            <h1 className="mt-0.5 font-display text-xl font-bold text-ink">
            Gas sponsorship, proven in a browser
            </h1>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="btn btn-ghost btn-sm"
        >
          Sign out
        </button>
      </header>

      <WalletGate loading={walletLoading} error={walletError} stalled={walletStalled}>
        <SponsoredTapDemo />
      </WalletGate>
    </main>
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
