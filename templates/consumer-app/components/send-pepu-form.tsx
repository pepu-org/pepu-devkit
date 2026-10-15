"use client";

import { useState, type FormEvent } from "react";
import { isAddress, parseEther, type BaseError } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { explorerLinks, pepuMainnet } from "@pepu-chain/sdk";
import { SuccessCheck } from "@/components/success-check";

export function SendPepuForm() {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: hash,
    error: sendError,
    isPending,
    sendTransaction,
    reset,
  } = useSendTransaction();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash, chainId: pepuMainnet.id });

  const txLink = hash ? explorerLinks({ tx: hash }).tx : null;
  const isBusy = isPending || isConfirming;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!isAddress(to)) {
      setFormError("That doesn't look like a valid address.");
      return;
    }

    let value: bigint;
    try {
      value = parseEther(amount);
    } catch {
      setFormError("Enter a valid amount, e.g. 0.01");
      return;
    }

    if (value <= 0n) {
      setFormError("Amount must be greater than zero.");
      return;
    }

    sendTransaction({ to, value });
  }

  function sendAnother() {
    reset();
    setTo("");
    setAmount("");
    setFormError(null);
  }

  return (
    <div className="card">
      <p className="eyebrow eyebrow-brand">
        Send {pepuMainnet.nativeCurrency.symbol}
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        A plain native transfer — the simplest onchain action there is.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="to" className="sr-only">
            Recipient address
          </label>
          <input
            id="to"
            name="to"
            placeholder="0xRecipientAddress…"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            disabled={isBusy}
            required
            className="input w-full"
          />
        </div>
        <div>
          <label htmlFor="amount" className="sr-only">
            Amount
          </label>
          <div className="relative">
            <input
              id="amount"
              name="amount"
              placeholder="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={isBusy}
              required
              className="input w-full pr-16"
            />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs font-semibold text-pepu-300">
              {pepuMainnet.nativeCurrency.symbol}
            </span>
          </div>
        </div>

        {formError && (
          <p className="text-error text-sm" role="alert">
            {formError}
          </p>
        )}
        {sendError && (
          <p className="text-error text-sm" role="alert">
            {(sendError as BaseError).shortMessage ?? sendError.message}
          </p>
        )}

        {!isConfirmed ? (
          <button
            type="submit"
            disabled={isBusy}
            className="btn btn-primary w-full"
          >
            {isBusy && <span className="spinner spinner-sm" aria-hidden="true" />}
            {isPending && "Confirm in wallet…"}
            {isConfirming && !isPending && "Sending…"}
            {!isBusy && "Send"}
          </button>
        ) : (
          <button
            type="button"
            onClick={sendAnother}
            className="btn btn-ghost btn-sm w-full"
          >
            Send another
          </button>
        )}
      </form>

      {hash && (
        <div className="well mt-4 text-sm" aria-live="polite">
          {isConfirming && (
            <p className="flex items-center gap-2 text-ink-soft">
              <span className="dot dot-live text-warn" />
              Waiting for confirmation…
            </p>
          )}
          {isConfirmed && (
            <p className="flex items-center gap-2 text-pepu-300">
              <SuccessCheck />
              Confirmed.
            </p>
          )}
          {txLink ? (
            <a
              href={txLink}
              target="_blank"
              rel="noreferrer"
              className="link mt-1 inline-block"
            >
              View transaction on pepuscan ↗
            </a>
          ) : (
            <p className="mt-1 break-all font-mono text-xs text-ink-muted">
              {hash}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
