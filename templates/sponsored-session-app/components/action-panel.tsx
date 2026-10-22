"use client";

import { formatEther } from "viem";
import { SuccessCheck } from "@/components/success-check";
import { explorerLinks } from "@pepu-chain/sdk";
import type { SponsoredActResult } from "@pepu-chain/sdk/combo/react";
import { truncateHex } from "@/lib/format";

/**
 * The action and its evidence. One button, no wallet prompt: the server
 * signs with the session key and the paymaster pays. Each result shows the
 * numbers that prove it: the sender is the smart account, the gas was paid
 * by the paymaster (from the EntryPoint's own UserOperationEvent), and the
 * transaction is on pepuscan.
 */
export function ActionPanel(props: {
  busy: boolean;
  error: string | null;
  results: SponsoredActResult[];
  onTap: () => void;
}) {
  const { results } = props;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="card">
        <p className="eyebrow eyebrow-brand">Action</p>
        <p className="mt-1 text-sm text-ink-soft">
          Calls <code className="code">TapScore.tap()</code> from your smart account. No popup, no PEPU from
          you.
        </p>
        <button type="button" onClick={props.onTap} disabled={props.busy} className="btn btn-primary mt-4 w-full">
          {props.busy && <span className="spinner spinner-sm" aria-hidden="true" />}
          {props.busy ? "Sending sponsored UserOperation…" : "Tap"}
        </button>
        {props.error && (
          <div className="notice notice-danger mt-3" role="alert">
            <p className="notice-title break-words">{props.error}</p>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="card card-featured reveal">
          <p className="eyebrow eyebrow-brand flex items-center gap-2">
            <SuccessCheck />
            Evidence
          </p>
          <ul className="mt-3 space-y-3">
            {results.map((result, index) => {
              const { tx: txLink, sender: senderLink } = explorerLinks({
                tx: result.transactionHash,
                sender: result.kernelAddress,
              });
              return (
                <li key={result.userOpHash} className="well text-sm">
                  <p className="font-semibold text-ink">
                    Tap #{results.length - index} · {result.success ? "confirmed" : "reverted"}
                  </p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <dt>Transaction</dt>
                    <dd className="font-mono">
                      {txLink ? (
                        <a href={txLink} target="_blank" rel="noreferrer" className="link">
                          {truncateHex(result.transactionHash)} ↗
                        </a>
                      ) : (
                        result.transactionHash
                      )}
                    </dd>
                    <dt>UserOperation</dt>
                    <dd className="font-mono break-all">{truncateHex(result.userOpHash, 10, 8)}</dd>
                    <dt>Sender</dt>
                    <dd className="font-mono">
                      {senderLink ? (
                        <a href={senderLink} target="_blank" rel="noreferrer" className="link">
                          {truncateHex(result.kernelAddress)} ↗
                        </a>
                      ) : (
                        result.kernelAddress
                      )}
                    </dd>
                    <dt>Gas paid by</dt>
                    <dd className="font-mono">
                      {result.paymaster ? `paymaster ${truncateHex(result.paymaster)}` : "the account itself"}
                    </dd>
                    <dt>Gas cost</dt>
                    <dd className="font-mono">{formatEther(BigInt(result.actualGasCostWei))} PEPU</dd>
                  </dl>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            pepuscan shows the transaction the bundler submitted and the smart account as the sender. It does not
            index ERC-4337 UserOperation pages yet, so the UserOperation hash is shown as text.
          </p>
        </div>
      )}
    </div>
  );
}
