"use client";

import { explorerLinks } from "@pepu-chain/sdk";
import type { KernelSessionScope } from "@pepu-chain/sdk/session/kernel";
import { truncateHex } from "@/lib/format";

/**
 * The "Start session" consent screen. It states, in plain terms, exactly
 * what is being granted, for how long, who pays gas, and where the limits
 * are enforced. The allowed call comes from `describeKernelSessionScope`
 * over `lib/scope.ts`, the same definition the on-chain policy is built from;
 * nothing here is separate copy that could drift.
 */
export function ConsentScreen(props: {
  scope: KernelSessionScope;
  minutes: number;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { scope, busy } = props;
  const call = scope.calls[0];
  if (!call) return null;
  const targetLink = explorerLinks({ address: call.target }).address;

  return (
    <div className="card card-featured reveal">
      <p className="eyebrow eyebrow-brand">Start a session</p>
      <h2 className="mt-1 font-display text-xl font-bold text-ink">Approve once. Then no more popups.</h2>

      <ul className="mt-4 space-y-2.5 text-sm leading-6 text-ink-soft">
        <li>
          <span className="font-semibold text-ink">Allowed:</span> call{" "}
          <code className="code">{call.functionName}</code> (selector{" "}
          <code className="code">{call.selector}</code>) on TapScore{" "}
          {targetLink ? (
            <a href={targetLink} target="_blank" rel="noreferrer" className="link font-mono">
              {truncateHex(call.target)} ↗
            </a>
          ) : (
            <code className="code">{truncateHex(call.target)}</code>
          )}
          , and nothing else.
        </li>
        <li>
          <span className="font-semibold text-ink">Never allowed:</span> sending PEPU or tokens, calling any
          other function or contract.
        </li>
        <li>
          <span className="font-semibold text-ink">For how long:</span> {props.minutes} minutes from your
          approval; the exact end time is shown once the session starts. Then it stops working by itself.
        </li>
        <li>
          <span className="font-semibold text-ink">Gas:</span> paid by the sponsor (the PEPU paymaster). Your
          wallet does not need any PEPU.
        </li>
      </ul>

      <div className="notice notice-info mt-4 text-sm leading-6">
        <p className="notice-title">Where the limits live</p>
        <p className="mt-1">
          Your smart account enforces them on-chain. This app&apos;s server holds a fresh session key that can
          do only what is listed above. Even a stolen key cannot do more. Ending the session here stops the
          server using the key immediately; the on-chain permission itself simply lapses at the expiry time.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={props.onApprove} disabled={busy} className="btn btn-primary">
          {busy && <span className="spinner spinner-sm" aria-hidden="true" />}
          {busy ? "Waiting for your signature…" : "Approve (one signature)"}
        </button>
        <button type="button" onClick={props.onCancel} disabled={busy} className="btn btn-ghost">
          Cancel
        </button>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Your wallet will ask you to sign one message. That is the only prompt in the whole session.
      </p>
    </div>
  );
}
