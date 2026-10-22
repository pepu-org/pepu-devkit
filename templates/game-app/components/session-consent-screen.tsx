"use client";

import { useMemo } from "react";
import { explorerLinks } from "@pepu-chain/sdk";
import { SESSION_TRUST_NOTICE } from "@pepu-chain/sdk/session";
import { useSessionGrant } from "@pepu-chain/sdk/session/react";
import { describeGameScope, gameContractAddress } from "@/lib/scope";
import { truncateHex } from "@/lib/format";
import { GasNotice } from "@/components/gas-notice";

/**
 * THE CENTERPIECE OF THIS TEMPLATE.
 *
 * Everything a player is authorizing is stated here in plain language
 * before they grant it (which contract, which function, what spend cap,
 * what expiry, how to revoke, who enforces it), because an app that skips
 * this screen has reproduced the unscoped-signer footgun (AGENTS.md rule 1).
 * The contract and function rows come from `describeSessionScope`, the same
 * scope (`lib/scope.ts`) `buildSessionPolicy` turns into the Privy policy on
 * the server, so the screen cannot drift from what is enforced.
 *
 * The grant flow is the SDK's `useSessionGrant`: it asks `/api/session/grant`
 * for a policy id and hands it straight to Privy's `addSigners`; there is no
 * path that grants a bare signer. It is idempotent: when the server reports
 * a signer is already attached it skips `addSigners` (Privy rejects a second
 * one with "Duplicate signer(s)") and swallows that error on a double click.
 * On success the session status hook updates and this screen unmounts.
 */
export function SessionConsentScreen({ address }: { address: string }) {
  const { grant, status, error } = useSessionGrant({ address });
  const busy = status === "creating-policy" || status === "awaiting-consent" || status === "granted";

  const scope = useMemo(() => describeGameScope(), []);
  const tapSignature = scope.functions[0]?.signature ?? "tap()";
  const explorerLink = explorerLinks({ address: gameContractAddress }).address;

  return (
    <section
      className="card card-featured reveal sm:p-8!"
      aria-labelledby="consent-heading"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-pepu-500/50 bg-pepu-500/15 text-pepu-300"
          aria-hidden="true"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M9 12l2.2 2.2L15.5 10"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <p className="eyebrow eyebrow-brand">Grant a session signer</p>
      </div>
      <h2
        id="consent-heading"
        className="mt-3 font-display text-2xl leading-tight font-bold text-ink"
      >
        Play without a popup for every move
      </h2>
      <p className="mt-2 text-base leading-7 text-ink-soft">
        This grants our game backend a limited, temporary permission to
        submit transactions from your embedded wallet — nothing more. Read
        exactly what that means below.
      </p>

      <dl className="mt-6 space-y-3 text-sm">
        <div className="well">
          <dt className="font-semibold text-ink">Which contract</dt>
          <dd className="mt-1 leading-6 text-ink-soft">
            Only the TapScore game contract —{" "}
            {explorerLink ? (
              <a
                href={explorerLink}
                target="_blank"
                rel="noreferrer"
                className="link font-mono"
              >
                {truncateHex(gameContractAddress)} ↗
              </a>
            ) : (
              <code className="code">{truncateHex(gameContractAddress)}</code>
            )}
            . No other address can ever be called with this signer.
          </dd>
        </div>

        <div className="well">
          <dt className="font-semibold text-ink">Which function</dt>
          <dd className="mt-1 leading-6 text-ink-soft">
            Only <code className="code">{tapSignature}</code> —
            the single move this game has. Calls to any other function are
            denied, even on the same contract.
          </dd>
        </div>

        <div className="well">
          <dt className="font-semibold text-ink">Spend cap</dt>
          <dd className="mt-1 leading-6 text-ink-soft">
            Zero PEPU value per call. This signer can never move your PEPU
            balance — it can only trigger the scoring function. (Gas is
            separate and not capped by this policy — see the note below.)
          </dd>
        </div>

        <div className="well">
          <dt className="font-semibold text-ink">Expiry</dt>
          <dd className="mt-1 leading-6 text-ink-soft">
            Time-bound. Once granted, requests made after the expiry
            timestamp are denied automatically — you don&apos;t have to
            remember to revoke it for it to stop working.
          </dd>
        </div>

        <div className="well">
          <dt className="font-semibold text-ink">How to revoke</dt>
          <dd className="mt-1 leading-6 text-ink-soft">
            Instantly, any time, from the session panel that replaces this
            screen once you grant — one click removes the signer.
          </dd>
        </div>
      </dl>

      <div className="notice notice-warn mt-5" role="note">
        <p className="notice-title text-base">How this is actually enforced</p>
        <p className="mt-1 leading-6">{SESSION_TRUST_NOTICE["privy-offchain"]}</p>
      </div>

      <div className="mt-4">
        <GasNotice />
      </div>

      {error && (
        <p className="text-error mt-4 text-sm" role="alert">
          {error.message}
        </p>
      )}

      <button
        type="button"
        onClick={() => void grant()}
        disabled={busy}
        className="btn btn-primary mt-6 min-h-12! w-full text-base!"
      >
        {busy && (
          <span className="spinner spinner-sm" aria-hidden="true" />
        )}
        {busy ? "Granting…" : "Grant session signer"}
      </button>
    </section>
  );
}
