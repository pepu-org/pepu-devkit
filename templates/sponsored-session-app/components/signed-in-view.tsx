"use client";

import { usePrivy } from "@privy-io/react-auth";
import { WalletGate } from "@pepu-chain/sdk/privy/react";
import { PepuMark } from "@/components/pepu-mark";
import { SessionFlow } from "@/components/session-flow";

export function SignedInView() {
  const { logout } = usePrivy();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
      <header className="reveal mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          <PepuMark size={36} />
          <div>
            <p className="eyebrow eyebrow-brand">PEPU sponsored session</p>
            <h1 className="mt-0.5 font-display text-xl font-bold text-ink">No popups. No gas.</h1>
          </div>
        </div>
        <button type="button" onClick={logout} className="btn btn-ghost btn-sm">
          Sign out
        </button>
      </header>

      <WalletGate
        loading={
          <div className="card flex items-center gap-3 text-sm text-ink-soft">
            <span className="spinner spinner-sm shrink-0" role="status" aria-label="Loading" />
            Setting up your wallet…
          </div>
        }
        error={(e, retry) => (
          <div className="notice notice-danger p-5!" role="alert">
            <p className="notice-title">Could not create your wallet.</p>
            <p className="mt-1">{e.message}</p>
            <button type="button" onClick={retry} className="btn btn-danger btn-sm mt-4">
              Try again
            </button>
          </div>
        )}
      >
        <SessionFlow />
      </WalletGate>
    </main>
  );
}
