"use client";

import { usePrivy } from "@privy-io/react-auth";
import { WalletGate } from "@pepu-chain/sdk/privy/react";
import { useEmbeddedWallet } from "@pepu-chain/sdk/privy/react";
import { useSessionRevoke, useSessionStatus } from "@pepu-chain/sdk/session/react";
import { Header } from "@/components/header";
import { WalletCard } from "@/components/wallet-card";
import { SessionConsentScreen } from "@/components/session-consent-screen";
import { SessionStatusCard } from "@/components/session-status-card";
import { GameBoard } from "@/components/game-board";

export function SignedInView() {
  const { logout, user } = usePrivy();

  return (
    <div className="min-h-screen">
      <Header>
        <button onClick={logout} className="btn btn-ghost btn-sm">
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
            <Session />
          </WalletGate>
        </div>
      </main>
    </div>
  );
}

/**
 * The session phases, all derived from `useSessionStatus`: `none` shows the
 * consent screen, `expired` explains the time-bound policy and offers a
 * re-grant, `active` shows the countdown and the game. The status hook asks
 * `/api/session/status` whether a signer is attached and combines it with the
 * expiry it tracked from the grant; a signer granted elsewhere is `active`
 * without a countdown. Rendered inside `<WalletGate>`, so the embedded wallet
 * exists, and every session hook is pinned to its address (Privy only
 * attaches a signer to an embedded wallet).
 */
function Session() {
  const { address } = useEmbeddedWallet();
  const { state, loading, secondsLeft, refetch } = useSessionStatus(address ? { address } : {});
  const { revoke } = useSessionRevoke(address ? { address } : {});

  if (!address || loading) {
    return (
      <div className="flex justify-center py-10">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (state === "none") return <SessionConsentScreen address={address} />;

  if (state === "expired") {
    return (
      <div className="notice notice-warn p-5! text-center" role="status">
        <p className="notice-title">Your session signer has expired.</p>
        <p className="mt-1">
          That&apos;s the time-bound policy working as intended — see <code className="code">lib/scope.ts</code>{" "}
          and <code className="code">buildSessionPolicy</code>. Grant a new one to keep playing without popups.
        </p>
        {/* The old signer is still attached after its policy expires (Privy only stops honoring
            requests), so remove it before granting a fresh one: the wallet never carries two
            overlapping policies for the same key quorum. */}
        <button type="button" onClick={() => void revoke()} className="btn btn-primary mt-4">
          Grant a new session
        </button>
      </div>
    );
  }

  return (
    <>
      <SessionStatusCard address={address} {...(secondsLeft !== undefined ? { secondsLeft } : {})} />
      <GameBoard address={address} onSessionRejected={refetch} />
    </>
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
