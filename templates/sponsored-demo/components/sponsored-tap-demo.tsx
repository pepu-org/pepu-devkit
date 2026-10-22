"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, type PublicClient } from "viem";
import { explorerLinks, getPublicClient, pepuMainnet, type PepuError } from "@pepu-chain/sdk";
import { getPaymasterDeposit } from "@pepu-chain/sdk/aa";
import { usePepuSmartAccount, usePepuSponsorship, useSponsoredSend } from "@pepu-chain/sdk/aa/react";
import { SuccessCheck } from "@/components/success-check";
import { paymasterContractAddress } from "@/lib/env";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "@/lib/tapscore";

const publicClient = getPublicClient(pepuMainnet) as unknown as PublicClient;

type Stage = "idle" | "reading-deposit-before" | "sending" | "reading-deposit-after" | "done" | "error";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The paymaster's current EntryPoint deposit, in wei (SDK `getPaymasterDeposit`). */
const readPaymasterDepositWei = (): Promise<bigint> => getPaymasterDeposit(publicClient, paymasterContractAddress);

/**
 * The actual proof-of-sponsorship UI. Requires an embedded wallet to already
 * exist (see `<WalletGate>` in `components/signed-in-view.tsx`): the embedded wallet is the Kernel
 * account's owner/signer.
 *
 * The sponsored path is one SDK call: `useSponsoredSend({ transport:
 * "privy-smart-wallets" })` sends through Privy's smart-wallet client (which
 * runs pm_getPaymasterStubData, eth_estimateUserOperationGas,
 * pm_getPaymasterData and eth_sendUserOperation against the bundler and
 * paymaster URLs configured in the Privy Dashboard), waits for the receipt,
 * allows one send at a time, and turns any failure into a typed error via
 * `describeUserOpFailure`. Every number shown is a real on-chain read or a
 * real bundler round-trip; nothing is simulated.
 */
export function SponsoredTapDemo() {
  // The SDK resolves the smart account from Privy's client, falling back to getClientForChain.
  const { smartAccount: address } = usePepuSmartAccount();

  const { send } = useSponsoredSend({ transport: "privy-smart-wallets" });
  // Direct bundler/paymaster probe (`checkSponsorship`): only consulted when a
  // send fails, to say whether PEPU_BUNDLER_URL / PEPU_PAYMASTER_URL are set.
  // The privy-smart-wallets transport uses the Dashboard's URLs instead.
  const sponsorship = usePepuSponsorship({ pollMs: 0 });

  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<PepuError | null>(null);
  // Synchronous in-flight guard: state (`busy`) only updates on the next
  // render, so a double-fired handler would otherwise both pass. One click == one attempt.
  const inFlightRef = useRef(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [depositBeforeWei, setDepositBeforeWei] = useState<bigint | null>(null);
  const [depositAfterWei, setDepositAfterWei] = useState<bigint | null>(null);

  // Poll the smart account's own native PEPU balance: expected zero, since
  // this account has never held any and pays no gas of its own.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const load = async () => {
      try {
        const bal = await publicClient.getBalance({ address: address as `0x${string}` });
        if (!cancelled) setBalanceWei(bal);
      } catch {
        // Transient RPC hiccup: the next poll tick retries. Not fatal.
      }
    };
    void load();
    const intervalId = setInterval(load, 6000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [address]);

  const busy = stage === "reading-deposit-before" || stage === "sending" || stage === "reading-deposit-after";

  const handleTap = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setTxHash(null);
    setDepositBeforeWei(null);
    setDepositAfterWei(null);

    try {
      setStage("reading-deposit-before");
      setDepositBeforeWei(await readPaymasterDepositWei());

      // The entire sponsored path. `send` resolves once the UserOperation is
      // included on-chain, which is what makes the before/after deposit
      // comparison honest rather than a race against the bundler.
      setStage("sending");
      const result = await send([{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }]);
      setTxHash(result.transactionHash);

      setStage("reading-deposit-after");
      setDepositAfterWei(await readPaymasterDepositWei());

      setStage("done");
    } catch (caught) {
      // `send` already ran describeUserOpFailure (real denial reason, secrets redacted).
      console.error("[sponsored-demo] sponsored tap failed", caught);
      setError(caught as PepuError);
      setStage("error");
    } finally {
      inFlightRef.current = false;
    }
  }, [send]);

  if (!address) {
    return (
      <div className="card flex items-center gap-3 text-sm text-ink-soft">
        <span className="spinner spinner-sm shrink-0" role="status" aria-label="Loading" />
        Setting up your smart wallet… (this needs &quot;Smart Wallets&quot;
        enabled for chain 97741 in the Privy Dashboard)
      </div>
    );
  }

  const txExplorerUrl = txHash ? explorerLinks({ tx: txHash }).tx : null;
  const depositDropWei =
    depositBeforeWei !== null && depositAfterWei !== null ? depositBeforeWei - depositAfterWei : null;

  return (
    <div className="stagger space-y-4 sm:space-y-6">
      <div className="card">
        <p className="eyebrow eyebrow-brand">
          Your Kernel smart wallet
        </p>
        <p className="mt-2 text-sm">
          <code className="code">{shortAddress(address)}</code>
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Balance:{" "}
          <span className="font-semibold text-ink">
            {balanceWei === null ? "…" : `${formatEther(balanceWei)} PEPU`}
          </span>{" "}
          {balanceWei === 0n && (
            <span className="font-medium text-pepu-300">(zero — this account has never held gas money)</span>
          )}
        </p>
      </div>

      <div className="card">
        <p className="eyebrow eyebrow-brand">
          Sponsored action
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Calls <code className="code">TapScore.tap()</code> at{" "}
          <code className="code">{shortAddress(TAPSCORE_ADDRESS)}</code>{" "}
          as a sponsored UserOperation — no PEPU leaves (or needs to exist in) your wallet.
        </p>
        <button
          type="button"
          onClick={() => void handleTap()}
          disabled={busy}
          className="btn btn-primary mt-4 w-full"
        >
          {busy && <span className="spinner spinner-sm" aria-hidden="true" />}
          {stage === "idle" && "Sponsor a tap"}
          {stage === "reading-deposit-before" && "Reading paymaster deposit…"}
          {stage === "sending" && "Submitting sponsored UserOperation…"}
          {stage === "reading-deposit-after" && "Reading paymaster deposit again…"}
          {stage === "done" && "Tap again"}
          {stage === "error" && "Try again"}
        </button>

        {error && (
          <div className="notice notice-danger mt-3 space-y-1" role="alert">
            <p className="notice-title break-words">{error.message}</p>
            {error.hint && <p className="font-mono text-xs break-words">fix: {error.hint}</p>}
            <p className="text-error text-xs">{error.code}</p>
            {!sponsorship.loading && !sponsorship.available && (
              <p className="font-mono text-xs break-words">
                direct endpoint check (PEPU_BUNDLER_URL / PEPU_PAYMASTER_URL): {sponsorship.reason}
              </p>
            )}
          </div>
        )}
      </div>

      {(txHash || depositBeforeWei !== null) && (
        <div className="card card-featured reveal">
          <p className="eyebrow eyebrow-brand flex items-center gap-2">
            {depositDropWei !== null && depositDropWei > 0n && <SuccessCheck />}
            Evidence
          </p>

          {txHash && (
            <p className="mt-2 text-sm text-ink-soft">
              Transaction:{" "}
              {txExplorerUrl ? (
                <a
                  href={txExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link font-mono"
                >
                  {shortAddress(txHash)} ↗
                </a>
              ) : (
                <span className="font-mono break-all">{txHash}</span>
              )}
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="well p-3!">
              <p className="eyebrow text-[11px]!">
                Deposit before
              </p>
              <p className="mt-1 font-mono text-sm text-ink">
                {depositBeforeWei === null ? "…" : `${formatEther(depositBeforeWei)} PEPU`}
              </p>
            </div>
            <div className="well p-3!">
              <p className="eyebrow text-[11px]!">
                Deposit after
              </p>
              <p className="mt-1 font-mono text-sm text-ink">
                {depositAfterWei === null ? "…" : `${formatEther(depositAfterWei)} PEPU`}
              </p>
            </div>
            <div className="well p-3!">
              <p className="eyebrow text-[11px]!">
                Drop (gas paid by paymaster)
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-lime">
                {depositDropWei === null ? "…" : `${formatEther(depositDropWei)} PEPU`}
              </p>
            </div>
          </div>

          {depositDropWei !== null && (
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              {depositDropWei > 0n
                ? "The paymaster's own EntryPoint deposit just paid for this transaction's gas — your wallet's balance never moved. That drop is the proof this was actually sponsored, not just that a transaction happened to succeed."
                : "The deposit didn't move this time — see the on-chain transaction above before trusting this run as sponsored."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
