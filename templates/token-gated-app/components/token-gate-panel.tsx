"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { erc20Abi, erc721Abi, explorerLinks, formatUnitsCompact, pepuMainnet, pepuMulticall } from "@pepu-chain/sdk";
import { gateErc20Address, gateErc721Address } from "@/lib/env";
import { GatedContent } from "@/components/gated-content";

/**
 * The core of this template: one batched read that checks the signed-in
 * wallet's balance of every configured gate token, then unlocks
 * `<GatedContent>` if it holds a positive balance of at least one of
 * them.
 *
 * "Batched" here means a single `pepuMulticall` call (from
 * `@pepu-chain/sdk`) covering up to six contract reads
 * (symbol/decimals/balanceOf for the ERC-20, plus name/symbol/balanceOf for
 * the ERC-721, whichever are configured). `pepuMulticall` is viem's
 * `multicall` pinned to PEPU's own Multicall3 deployment (never the
 * canonical 0xcA11… address), so this is one RPC round trip, not up to six.
 * ERC-20/721 ABIs come from viem, which already ships them.
 */
export function TokenGatePanel() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: pepuMainnet.id });

  const contracts = useMemo(() => {
    const list: {
      address: `0x${string}`;
      abi: typeof erc20Abi | typeof erc721Abi;
      functionName: string;
      args?: readonly [`0x${string}`];
    }[] = [];

    if (gateErc20Address && address) {
      list.push(
        { address: gateErc20Address, abi: erc20Abi, functionName: "balanceOf", args: [address] },
        { address: gateErc20Address, abi: erc20Abi, functionName: "decimals" },
        { address: gateErc20Address, abi: erc20Abi, functionName: "symbol" },
      );
    }
    if (gateErc721Address && address) {
      list.push(
        { address: gateErc721Address, abi: erc721Abi, functionName: "balanceOf", args: [address] },
        { address: gateErc721Address, abi: erc721Abi, functionName: "name" },
        { address: gateErc721Address, abi: erc721Abi, functionName: "symbol" },
      );
    }
    return list;
  }, [address]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["gate-balances", address, gateErc20Address, gateErc721Address],
    queryFn: () => pepuMulticall(publicClient!, contracts, { allowFailure: true }),
    enabled: contracts.length > 0 && Boolean(publicClient),
  });

  // Slice the flat results array back into per-token groups, in the same
  // order they were pushed above.
  let cursor = 0;
  const erc20Result = gateErc20Address ? data?.slice(cursor, (cursor += 3)) : undefined;
  const erc721Result = gateErc721Address ? data?.slice(cursor, (cursor += 3)) : undefined;

  const erc20Balance =
    erc20Result?.[0]?.status === "success"
      ? (erc20Result[0].result as unknown as bigint)
      : undefined;
  const erc20Decimals =
    erc20Result?.[1]?.status === "success" ? (erc20Result[1].result as number) : 18;
  const erc20Symbol =
    erc20Result?.[2]?.status === "success" ? (erc20Result[2].result as string) : "tokens";

  const erc721Balance =
    erc721Result?.[0]?.status === "success"
      ? (erc721Result[0].result as unknown as bigint)
      : undefined;
  const erc721Name =
    erc721Result?.[1]?.status === "success" ? (erc721Result[1].result as string) : "the collection";
  const erc721Symbol =
    erc721Result?.[2]?.status === "success" ? (erc721Result[2].result as string) : "NFT";

  const holdsErc20 = Boolean(erc20Balance && erc20Balance > 0n);
  const holdsErc721 = Boolean(erc721Balance && erc721Balance > 0n);
  const unlocked = holdsErc20 || holdsErc721;

  if (isLoading) {
    return (
      <div className="card">
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <span className="spinner spinner-sm" role="status" aria-label="Loading" />
          Checking token balance…
        </p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="notice notice-danger p-5!" role="alert">
        <p className="notice-title">
          Couldn&apos;t read the gate token balance right now.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="btn btn-danger btn-sm mt-3"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="eyebrow eyebrow-brand">
          Gate status
        </p>

        <div className="mt-3 space-y-3">
          {gateErc20Address && (
            <GateRow
              label={`${erc20Symbol} balance`}
              value={erc20Balance !== undefined ? formatUnitsCompact(erc20Balance, erc20Decimals) : "—"}
              holds={holdsErc20}
              explorerHref={explorerLinks({ token: gateErc20Address }).token ?? null}
            />
          )}
          {gateErc721Address && (
            <GateRow
              label={`${erc721Name} (${erc721Symbol}) owned`}
              value={erc721Balance !== undefined ? erc721Balance.toString() : "—"}
              holds={holdsErc721}
              explorerHref={explorerLinks({ token: gateErc721Address }).token ?? null}
            />
          )}
        </div>
      </div>

      {unlocked ? (
        <GatedContent />
      ) : (
        <div className="notice notice-warn p-5!" role="status">
          <p className="notice-title">Locked.</p>
          <p className="mt-1">
            This wallet doesn&apos;t hold any of the configured gate
            token{gateErc20Address && gateErc721Address ? "s" : ""} on{" "}
            {pepuMainnet.name}. Acquire one and refresh, or connect a
            different wallet.
          </p>
        </div>
      )}
    </div>
  );
}

function GateRow({
  label,
  value,
  holds,
  explorerHref,
}: {
  label: string;
  value: string;
  holds: boolean;
  explorerHref: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`dot ${holds ? "text-pepu-400" : "text-ink-muted"}`}
          aria-hidden="true"
        />
        <span className="text-ink-soft">{label}</span>
        <span
          className={`chip chip-tag ${holds ? "chip-brand" : ""}`}
        >
          {holds ? "Holding" : "Not held"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-display text-lg font-bold tabular-nums text-ink">{value}</span>
        {explorerHref && (
          <a
            href={explorerHref}
            target="_blank"
            rel="noreferrer"
            className="link text-xs"
          >
            pepuscan ↗
          </a>
        )}
      </div>
    </div>
  );
}
