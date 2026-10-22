"use client";

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { explorerLinks, pepuMainnet } from "@pepu-chain/sdk";
import { nftContractAddress } from "@/lib/env";
import { pepuNftAbi } from "@/lib/nft-abi";

/**
 * Lists every token id the signed-in wallet owns from this collection.
 * Two-stage read, both batched via Multicall3 where possible:
 *
 *   1. `balanceOf(owner)` — how many tokens this wallet holds.
 *   2. `tokenOfOwnerByIndex(owner, i)` for every `i` in `[0, balance)` —
 *      one `useReadContracts` call covering all of them at once (this is
 *      the ERC-721Enumerable extension the contract inherits — see
 *      `contracts/README.md`).
 *
 * The parent remounts this whole component (via a React `key`) after a
 * successful mint, which re-runs both reads fresh — see
 * `components/signed-in-view.tsx`.
 *
 * `nftContractAddress` is guaranteed defined here — `<SetupGate>` blocks
 * rendering this component otherwise (see components/setup-gate.tsx).
 */
export function OwnedTokens() {
  const nftAddress = nftContractAddress!;
  const { address } = useAccount();

  const { data: balance, isLoading: isBalanceLoading } = useReadContract({
    address: nftAddress,
    abi: pepuNftAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: pepuMainnet.id,
    query: { enabled: Boolean(address) },
  });

  const count = balance !== undefined ? Number(balance) : 0;

  const { data: tokenIdResults, isLoading: isTokensLoading } = useReadContracts({
    contracts: Array.from({ length: count }, (_, index) => ({
      address: nftAddress,
      abi: pepuNftAbi,
      functionName: "tokenOfOwnerByIndex",
      args: address ? ([address, BigInt(index)] as const) : undefined,
      chainId: pepuMainnet.id,
    })),
    query: { enabled: count > 0 && Boolean(address) },
  });

  const tokenIds =
    tokenIdResults
      ?.filter((entry) => entry.status === "success")
      .map((entry) => entry.result as bigint) ?? [];

  const collectionLink = explorerLinks({ token: nftAddress }).token;

  const isLoading = isBalanceLoading || (count > 0 && isTokensLoading);

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow eyebrow-brand">
          Tokens you own
        </p>
        {collectionLink && (
          <a
            href={collectionLink}
            target="_blank"
            rel="noreferrer"
            className="link text-xs"
          >
            View collection on pepuscan ↗
          </a>
        )}
      </div>

      {isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
          <span className="spinner spinner-sm" role="status" aria-label="Loading" />
          Loading…
        </p>
      ) : tokenIds.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          You don&apos;t own any tokens from this collection yet.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {tokenIds.map((tokenId) => (
            <li
              key={tokenId.toString()}
              className="chip reveal rounded-lg! px-3! py-1.5! text-sm! text-ink!"
            >
              #{tokenId.toString()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
