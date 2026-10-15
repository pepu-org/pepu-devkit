"use client";

import { SuccessCheck } from "@/components/success-check";
import type { BaseError } from "viem";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { explorerLinks, formatPepu, pepuMainnet, pepuMulticall } from "@pepu-chain/sdk";
import { nftContractAddress } from "@/lib/env";
import { pepuNftAbi } from "@/lib/nft-abi";

/**
 * Reads the contract's mint price, current supply, and max supply in one
 * batched Multicall3 call (`pepuMulticall` from `@pepu-chain/sdk`, pinned to
 * PEPU's own Multicall3 — see the `token-gated-app` template for the same
 * pattern applied to a balance check), then offers a "Mint" button that sends a real transaction.
 * `nftContractAddress` is guaranteed defined here — `<SetupGate>` blocks
 * rendering this component otherwise (see components/setup-gate.tsx).
 */
export function MintPanel({ onMinted }: { onMinted?: () => void }) {
  const address = nftContractAddress!;

  const publicClient = usePublicClient({ chainId: pepuMainnet.id });
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["nft-mint-info", address],
    enabled: Boolean(publicClient),
    queryFn: () =>
      pepuMulticall(publicClient!, [
        { address, abi: pepuNftAbi, functionName: "name" },
        { address, abi: pepuNftAbi, functionName: "symbol" },
        { address, abi: pepuNftAbi, functionName: "mintPrice" },
        { address, abi: pepuNftAbi, functionName: "totalSupply" },
        { address, abi: pepuNftAbi, functionName: "MAX_SUPPLY" },
      ] as const),
  });

  const name = data?.[0]?.status === "success" ? data[0].result : "this collection";
  const symbol = data?.[1]?.status === "success" ? data[1].result : "NFT";
  const mintPrice = data?.[2]?.status === "success" ? data[2].result : undefined;
  const totalSupply = data?.[3]?.status === "success" ? data[3].result : undefined;
  const maxSupply = data?.[4]?.status === "success" ? data[4].result : undefined;

  const soldOut =
    totalSupply !== undefined && maxSupply !== undefined && totalSupply >= maxSupply;

  const {
    data: hash,
    error: mintError,
    isPending,
    writeContract,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash, chainId: pepuMainnet.id });

  const txLink = hash ? explorerLinks({ tx: hash }).tx : null;
  const isBusy = isPending || isConfirming;

  function mint() {
    if (mintPrice === undefined) return;
    writeContract(
      {
        address,
        abi: pepuNftAbi,
        functionName: "mint",
        value: mintPrice,
        chainId: pepuMainnet.id,
      },
      {
        onSuccess: () => {
          refetch();
          onMinted?.();
        },
      },
    );
  }

  function mintAnother() {
    reset();
  }

  const mintedPercent =
    totalSupply !== undefined && maxSupply !== undefined && maxSupply > 0n
      ? Number((totalSupply * 100n) / maxSupply)
      : null;

  if (isLoading) {
    return (
      <div className="card">
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <span className="spinner spinner-sm" role="status" aria-label="Loading" />
          Loading contract…
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="eyebrow eyebrow-brand">
        {name} ({symbol})
      </p>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-bold tabular-nums text-ink">
          {totalSupply !== undefined ? totalSupply.toString() : "—"}
        </span>
        <span className="text-sm text-ink-muted">
          / {maxSupply !== undefined ? maxSupply.toString() : "—"} minted
        </span>
      </div>
      {mintedPercent !== null && (
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-line"
          role="progressbar"
          aria-label="Supply minted"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={mintedPercent}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-pepu-500 to-lime transition-[width] duration-500 ease-out"
            style={{ width: `${mintedPercent}%` }}
          />
        </div>
      )}

      <p className="mt-3 text-sm text-ink-soft">
        Mint price:{" "}
        <span className="font-medium text-ink">
          {mintPrice !== undefined
            ? mintPrice === 0n
              ? "free"
              : `${formatPepu(mintPrice, { maxDecimals: 4, suffix: false })} ${pepuMainnet.nativeCurrency.symbol}`
            : "—"}
        </span>{" "}
        + gas
      </p>

      {mintError && (
        <p className="text-error mt-3 text-sm" role="alert">
          {(mintError as BaseError).shortMessage ?? mintError.message}
        </p>
      )}

      {!isConfirmed ? (
        <button
          type="button"
          onClick={mint}
          disabled={isBusy || soldOut || mintPrice === undefined}
          className="btn btn-primary mt-4 w-full"
        >
          {isBusy && <span className="spinner spinner-sm" aria-hidden="true" />}
          {soldOut && "Sold out"}
          {!soldOut && isPending && "Confirm in wallet…"}
          {!soldOut && isConfirming && !isPending && "Minting…"}
          {!soldOut && !isBusy && "Mint"}
        </button>
      ) : (
        <button
          type="button"
          onClick={mintAnother}
          className="btn btn-ghost btn-sm mt-4 w-full"
        >
          Mint another
        </button>
      )}

      {hash && (
        <div className="well mt-4 text-sm" aria-live="polite">
          {isConfirming && (
            <p className="flex items-center gap-2 text-ink-soft">
              <span className="dot dot-live text-warn" />
              Waiting for confirmation…
            </p>
          )}
          {isConfirmed && (
            <p className="flex items-center gap-2 font-medium text-pepu-300">
              <SuccessCheck />
              Minted.
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
            <p className="mt-1 break-all font-mono text-xs text-ink-muted">{hash}</p>
          )}
        </div>
      )}
    </div>
  );
}
