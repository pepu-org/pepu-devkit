"use client";

import { useEffect, useState } from "react";
import { useSponsoredSession, type SponsoredActResult } from "@pepu-chain/sdk/combo/react";
import { ActionPanel } from "@/components/action-panel";
import { AddressCard } from "@/components/address-card";
import { ConsentScreen } from "@/components/consent-screen";
import { useServerConfig } from "@/components/setup-gate";
import { formatClock, formatCountdown } from "@/lib/format";
import { scope } from "@/lib/scope";
import { describeKernelSessionScope } from "@pepu-chain/sdk/session/kernel";

/** Re-renders once a second so the countdown stays live. */
function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The whole flow, in the order the user sees it:
 *
 * 1. (signed in, wallet ready: handled by `SignedInView` and the SDK's `WalletGate`)
 * 2. both addresses are shown,
 * 3. "Start session" -> consent screen -> ONE owner signature (`grant()`),
 * 4. the action runs with no popup and no gas (`act()`),
 * 5. evidence links to pepuscan,
 * 6. revoke.
 *
 * All of the session mechanics (prepare, owner signature, activate, status,
 * act, revoke) are `useSponsoredSession` from `@pepu-chain/sdk/combo/react`.
 * The browser's only signing job is `grant()`.
 */
export function SessionFlow() {
  const now = useNowSeconds();
  const { sessionMinutes } = useServerConfig();
  const session = useSponsoredSession<undefined, SponsoredActResult>({ scope });
  const { phase, statusLoading, owner, smartAccount, expiresAt, error } = session;

  const [consenting, setConsenting] = useState(false);
  const [busy, setBusy] = useState<"tap" | "revoke" | null>(null);
  const [results, setResults] = useState<SponsoredActResult[]>([]);

  if (!owner) return null;

  const active = phase === "active" && expiresAt !== undefined && now < expiresAt;
  const expired = phase === "expired";
  const granting = phase === "granting";
  const message = error ? (error.hint ? `${error.message} ${error.hint}` : error.message) : null;
  // Just a preview of the scope (the expiry in it is not shown on this screen).
  const preview = describeKernelSessionScope({ calls: scope.calls, validUntil: now + sessionMinutes * 60 });

  const grant = async () => {
    setResults([]);
    await session.grant();
    setConsenting(false);
  };

  const tap = async () => {
    setBusy("tap");
    try {
      const result = await session.act();
      setResults((previous) => [result, ...previous]);
    } catch (caught) {
      console.error("[sponsored-session-app] tap failed", caught); // the hook already exposes `error`
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    try {
      await session.revoke();
      setConsenting(false);
    } catch (caught) {
      console.error("[sponsored-session-app] revoke failed", caught);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stagger space-y-4 sm:space-y-6">
      <AddressCard signer={owner} smartAccount={smartAccount ?? null} />

      {statusLoading && (
        <div className="flex justify-center py-10">
          <span className="spinner" role="status" aria-label="Loading" />
        </div>
      )}

      {!statusLoading && !active && !consenting && (
        <div className="card">
          <p className="eyebrow eyebrow-brand">Session</p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">
            {expired ? "Your session ended" : "Start a session"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Approve one scoped, time-limited session. After that, actions run with no popup and no gas from you.
            You will see exactly what is allowed before you approve.
          </p>
          <button type="button" onClick={() => setConsenting(true)} className="btn btn-primary mt-4">
            Start session
          </button>
        </div>
      )}

      {!active && consenting && (
        <ConsentScreen
          scope={preview}
          minutes={sessionMinutes}
          busy={granting}
          onApprove={() => void grant()}
          onCancel={() => setConsenting(false)}
        />
      )}

      {active && expiresAt !== undefined && (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow eyebrow-brand flex items-center gap-2">
                <span className="dot dot-live" />
                Session active
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Expires at <span className="font-semibold text-ink">{formatClock(expiresAt)}</span> (
                <span className="font-mono">{formatCountdown(expiresAt - now)}</span> left) · only{" "}
                <code className="code">{session.scope?.calls[0]?.signature ?? "tap()"}</code> on TapScore
              </p>
            </div>
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy !== null}
              className="btn btn-secondary btn-sm"
            >
              {busy === "revoke" ? "Ending…" : "Revoke session"}
            </button>
          </div>
          <ActionPanel busy={busy === "tap"} error={message} results={results} onTap={() => void tap()} />
        </>
      )}

      {!active && message && (
        <div className="notice notice-danger" role="alert">
          <p className="notice-title break-words">{message}</p>
        </div>
      )}
    </div>
  );
}
