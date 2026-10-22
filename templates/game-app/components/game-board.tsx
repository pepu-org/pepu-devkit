"use client";

import { useState } from "react";
import { explorerLinks, PepuError } from "@pepu-chain/sdk";
import { useSessionAct } from "@pepu-chain/sdk/session/react";
import { useAccount, useReadContract } from "wagmi";
import { gameContractAddress, tapScoreAbi } from "@/lib/scope";
import { truncateHex } from "@/lib/format";

/**
 * The game itself, and the whole point of this template: every tap below
 * is a real `tap()` transaction on Pepe Unchained, submitted by
 * `app/api/game/tap/route.ts` (`createSessionActionRoute`) via the session
 * signer, with zero wallet popups. The "actions taken without signing"
 * counter makes that contrast visible; without it "no popups" is invisible.
 *
 * `useSessionAct` surfaces only a 409 as `error.code === "SESSION_NONE"`
 * (the server found no delegated wallet). Any other failure (policy denial,
 * broadcast error, RPC hiccup) is a failed transaction and says nothing
 * about whether a session exists: treating it as "no session" sent players
 * back to the grant screen, where granting again failed with Privy's
 * "Duplicate signer(s)" error. An expired session is caught by the status
 * hook's own countdown instead.
 */
export function GameBoard({ address: walletAddress, onSessionRejected }: { address: string; onSessionRejected: () => void }) {
  const { address } = useAccount();
  const { act } = useSessionAct<Record<string, never>, { hash: string }>({
    endpoint: "/api/game/tap",
    address: walletAddress,
  });

  const [actionsWithoutSigning, setActionsWithoutSigning] = useState(0);
  const [isTapping, setIsTapping] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPopped, setIsPopped] = useState(false);

  const {
    data: score,
    refetch: refetchScore,
  } = useReadContract({
    address: gameContractAddress as `0x${string}`,
    abi: tapScoreAbi,
    functionName: "scores",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const txLink = lastHash ? explorerLinks({ tx: lastHash }).tx : null;

  async function tap() {
    setIsTapping(true);
    setError(null);
    setIsPopped(true);
    setTimeout(() => setIsPopped(false), 150);

    try {
      const result = await act({});
      setLastHash(result.hash);
      setActionsWithoutSigning((count) => count + 1);
      void refetchScore();
    } catch (caught) {
      if (caught instanceof PepuError && caught.code === "SESSION_NONE") onSessionRejected();
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsTapping(false);
    }
  }

  return (
    <div className="card card-featured">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">On-chain score</p>
          {score !== undefined ? (
            <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ink">
              {score.toString()}
            </p>
          ) : (
            <span
              className="skeleton mt-2 h-9 w-16"
              role="status"
              aria-label="Loading score"
            />
          )}
        </div>
        <div className="text-right">
          <p className="eyebrow">Actions taken without signing</p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums text-lime">
            {actionsWithoutSigning}
          </p>
        </div>
      </div>

      <div className="relative mt-6">
        <button
          type="button"
          onClick={tap}
          disabled={isTapping || !address}
          className={`btn btn-primary w-full rounded-3xl! py-10! font-display text-2xl! font-extrabold! tracking-wide ${
            isPopped ? "tap-pop" : ""
          }`}
        >
          {isTapping && <span className="spinner" aria-hidden="true" />}
          {isTapping ? "Sending…" : "TAP"}
        </button>
        {actionsWithoutSigning > 0 && (
          <span
            key={actionsWithoutSigning}
            className="float-up top-2 left-1/2 -translate-x-1/2 text-3xl"
            aria-hidden="true"
          >
            +1
          </span>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-ink-muted">
        Every tap is a real transaction — no wallet popup, because you
        already granted this exact permission.
      </p>

      {error && (
        <p className="text-error mt-3 text-center text-sm" role="alert">
          {error}
        </p>
      )}

      {lastHash && (
        <div className="well mt-3 text-center text-xs" aria-live="polite">
          Last tap:{" "}
          {txLink ? (
            <a
              href={txLink}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              {truncateHex(lastHash)} ↗
            </a>
          ) : (
            <span className="font-mono text-ink-muted">{truncateHex(lastHash)}</span>
          )}
        </div>
      )}
    </div>
  );
}
