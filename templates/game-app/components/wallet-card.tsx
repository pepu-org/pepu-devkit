"use client";

import { formatUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { pepuMainnet, explorerLinks } from "@pepu-chain/sdk";
import { useEmbeddedWallet } from "@pepu-chain/sdk/privy/react";
import { truncateHex } from "@/lib/format";
import { CopyButton } from "@/components/copy-button";

/**
 * Every row is explicitly labelled "Embedded" or by the external wallet's
 * own name (e.g. "MetaMask"), never wagmi's active address presented as the
 * embedded one: Privy only attaches a session signer to the embedded wallet.
 * `useEmbeddedWallet` (SDK) tells the two apart with Privy's own
 * `getEmbeddedConnectedWallet`.
 */
export function WalletCard() {
  const { ready, wallet: embedded, external } = useEmbeddedWallet();
  const { address: activeAddress } = useAccount();
  const activeIsEmbedded =
    Boolean(embedded) && activeAddress?.toLowerCase() === embedded?.address.toLowerCase();

  const showActiveBadges = Boolean(embedded) && external.length > 0;

  const embeddedEmptyHint = !ready
    ? "Loading…"
    : external.length > 0
      ? "Not created yet — the wallet below is external, not this app's embedded one."
      : "Not created yet.";

  return (
    <div className="space-y-2">
      <WalletRow
        label="Embedded"
        tone="embedded"
        address={embedded?.address}
        isActive={showActiveBadges && activeIsEmbedded}
        emptyHint={embeddedEmptyHint}
      />

      {external.map((wallet) => (
        <WalletRow
          key={wallet.address}
          label={wallet.meta.name || wallet.walletClientType}
          tone="external"
          address={wallet.address}
          isActive={
            showActiveBadges &&
            Boolean(activeAddress) &&
            activeAddress?.toLowerCase() === wallet.address.toLowerCase()
          }
        />
      ))}
    </div>
  );
}

function WalletRow({
  label,
  address,
  isActive,
  tone,
  emptyHint,
}: {
  label: string;
  address: string | undefined;
  isActive: boolean;
  tone: "embedded" | "external";
  emptyHint?: string;
}) {
  const typedAddress = address as `0x${string}` | undefined;

  const { data: balance, isLoading: isBalanceLoading } = useBalance({
    address: typedAddress,
    chainId: pepuMainnet.id,
    query: { enabled: Boolean(typedAddress) },
  });

  const explorerLink = address ? explorerLinks({ address }).address : null;

  return (
    <div
      className={`card p-4! ${
        tone === "external" ? "border-warn-line! bg-none! bg-warn-bg!" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className={`chip chip-tag ${
              tone === "external" ? "chip-warn" : "chip-brand"
            }`}
          >
            {label}
          </span>
          <code className="code text-sm!">
            {address ? truncateHex(address) : "—"}
          </code>
          {address && <CopyButton value={address} />}
          {explorerLink && (
            <a
              href={explorerLink}
              target="_blank"
              rel="noreferrer"
              className="link text-xs"
            >
              View on pepuscan ↗
            </a>
          )}
          {isActive && (
            <span className="chip chip-brand chip-tag">Used for actions</span>
          )}
        </div>
        {address ? (
          <div className="flex items-baseline gap-1.5">
            {isBalanceLoading ? (
              <span className="skeleton h-6 w-16" role="status" aria-label="Loading balance" />
            ) : (
              <span className="font-display text-xl font-bold tabular-nums text-ink">
                {balance
                  ? Number(formatUnits(balance.value, balance.decimals)).toFixed(4)
                  : "0"}
              </span>
            )}
            <span className="text-xs font-semibold text-pepu-300">
              {pepuMainnet.nativeCurrency.symbol}
            </span>
          </div>
        ) : (
          emptyHint && <p className="text-xs text-ink-muted">{emptyHint}</p>
        )}
      </div>
    </div>
  );
}
