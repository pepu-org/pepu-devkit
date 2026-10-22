"use client";

import { useSessionRevoke } from "@pepu-chain/sdk/session/react";
import { formatCountdown } from "@/lib/format";

/**
 * Shows the session signer's remaining time and the revocation control, the
 * second half of the consent story. Revocation is a first-class,
 * always-reachable action here, not a buried settings toggle (AGENTS.md
 * rule 1). `useSessionRevoke` calls Privy's `removeSigners`, which is the
 * real revoke, then cleans up the now-unused policy server-side.
 *
 * `secondsLeft` is `undefined` when the signer was granted from another
 * browser or local storage was cleared: revocation still works, there is
 * just no countdown.
 */
export function SessionStatusCard({ address, secondsLeft }: { address: string; secondsLeft?: number }) {
  const { revoke, status, error } = useSessionRevoke({ address });
  const isRevoking = status === "revoking";

  if (secondsLeft === undefined) {
    return (
      <div className="notice flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <span className="text-ink-soft">A session signer is active (expiry not tracked in this browser).</span>
        <button type="button" onClick={revoke} disabled={isRevoking} className="btn btn-ghost btn-sm">
          {isRevoking ? "Revoking…" : "Revoke session"}
        </button>
      </div>
    );
  }

  return (
    <div className="notice flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-pepu-500/50! bg-pepu-500/10!">
      <div className="flex items-center gap-2.5">
        <span className="dot dot-live text-pepu-300" />
        <span className="text-ink-soft">
          <strong className="font-semibold text-ink">Session active</strong> — playing without a popup for{" "}
          <span className="font-mono font-semibold text-lime">{formatCountdown(secondsLeft)}</span> more
        </span>
      </div>
      <div className="flex items-center gap-3">
        {error && <span className="text-error text-xs">{error.message}</span>}
        <button type="button" onClick={revoke} disabled={isRevoking} className="btn btn-ghost btn-sm">
          {isRevoking ? "Revoking…" : "Revoke session"}
        </button>
      </div>
    </div>
  );
}
