"use client";

import { useAccount, useBalance } from "wagmi";
import { explorerLinks, formatUnitsCompact, pepuMainnet } from "@pepu-chain/sdk";
import { useEmbeddedWallet } from "@pepu-chain/sdk/privy/react";
import { truncateHex } from "@/lib/format";
import { CopyButton } from "@/components/copy-button";

/**
 * THE FIX for a real, live-reproduced bug: this card used to read wagmi's
 * `useAccount()` and label whatever address it returned "Your embedded
 * wallet" — including a connected browser extension's address. See
 * the SDK's `useEmbeddedWallet` (which wraps Privy's
 * `getEmbeddedConnectedWallet`) for the incident writeup context.
 *
 * This card always sources the embedded wallet from `useEmbeddedWallet()`,
 * never from wagmi's "currently active" account. If an external wallet is also connected,
 * it renders as its own, separately labelled section — never merged into
 * or mistaken for the embedded one — and whichever wallet wagmi's hooks
 * (balance, send) actually act on is called out with a badge, since that
 * is not always the embedded wallet.
 */
export function WalletCard() {
  const { ready, wallet: embedded, external } = useEmbeddedWallet();
  // What wagmi's hooks (balance, send) actually act on. The SDK pins this to
  // the embedded wallet (`useActiveWalletPin`), but it is not guaranteed.
  const { address: activeAddress } = useAccount();
  const activeIsEmbedded =
    Boolean(embedded) &&
    Boolean(activeAddress) &&
    activeAddress?.toLowerCase() === embedded?.address.toLowerCase();

  // Only bother pointing out "which wallet do actions use" when there's
  // more than one candidate — with a single wallet in play there's
  // nothing ambiguous to clarify.
  const showActiveBadges = Boolean(embedded) && external.length > 0;

  const embeddedEmptyHint = !ready
    ? "Loading…"
    : external.length > 0
      ? "Not created yet. The wallet below is an external, connected wallet — not this app's embedded one."
      : "Not created yet.";

  return (
    <div className="stagger space-y-3">
      <WalletSection
        label="Your embedded wallet"
        address={embedded?.address}
        isActive={showActiveBadges && activeIsEmbedded}
        emptyHint={embeddedEmptyHint}
        tone="embedded"
      />

      {external.map((wallet) => (
        <WalletSection
          key={wallet.address}
          label={`Connected external wallet · ${wallet.meta.name || wallet.walletClientType}`}
          address={wallet.address}
          isActive={
            showActiveBadges &&
            Boolean(activeAddress) &&
            activeAddress?.toLowerCase() === wallet.address.toLowerCase()
          }
          tone="external"
        />
      ))}
    </div>
  );
}

function WalletSection({
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
      className={`card card-hover ${
        tone === "external" ? "border-warn-line! bg-none! bg-warn-bg!" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`eyebrow ${tone === "external" ? "text-warn!" : ""}`}>
          {label}
        </p>
        {isActive && (
          <span className="chip chip-brand chip-tag">Used for actions</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
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
      </div>

      {!address && emptyHint && (
        <p className="mt-3 text-xs text-ink-muted">{emptyHint}</p>
      )}

      {address && (
        <div className="mt-5 flex items-baseline gap-1.5">
          {isBalanceLoading ? (
            <span className="skeleton h-9 w-28" role="status" aria-label="Loading balance" />
          ) : (
            <span className="font-display text-4xl font-bold tabular-nums text-ink">
              {balance ? formatUnitsCompact(balance.value, balance.decimals) : "0"}
            </span>
          )}
          <span className="text-sm font-semibold text-pepu-300">
            {pepuMainnet.nativeCurrency.symbol}
          </span>
        </div>
      )}
    </div>
  );
}
