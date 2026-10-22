"use client";

import { useEffect, useState } from "react";
import { explorerLinks, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { formatEther, type Address } from "viem";
import { CopyButton } from "@/components/copy-button";
import { truncateHex } from "@/lib/format";

const publicClient = getPublicClient(pepuMainnet);

/** Polls a native balance. Transient RPC errors are ignored; the next tick retries. */
function useBalance(address: Address | null): bigint | null {
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await publicClient.getBalance({ address });
        if (!cancelled) setBalance(next);
      } catch {
        // retry on the next tick
      }
    };
    void load();
    const id = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);
  return balance;
}

function Row(props: { label: string; role: string; address: Address | null; balance: bigint | null; hint: string }) {
  const { label, role, address, balance, hint } = props;
  const link = address ? explorerLinks({ address }).address ?? null : null;
  return (
    <div className="well">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="chip chip-brand chip-tag">{label}</span>
        <span className="text-xs text-ink-muted">{role}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {address ? (
          <>
            <code className="code text-sm!">{truncateHex(address)}</code>
            <CopyButton value={address} />
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="link text-xs">
                pepuscan ↗
              </a>
            )}
          </>
        ) : (
          <span className="skeleton h-5 w-28" role="status" aria-label="Loading address" />
        )}
        <span className="ml-auto font-mono text-sm text-ink">
          {balance === null ? "…" : `${formatEther(balance)} PEPU`}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-ink-muted">{hint}</p>
    </div>
  );
}

/**
 * Both addresses, always labelled: the embedded wallet is the SIGNER, the
 * Kernel smart account is the SENDER (the address that appears on pepuscan,
 * holds the score, and can stay at zero PEPU). See
 * docs/onboarding/two-address-model.md in the devkit repository.
 */
export function AddressCard(props: { signer: Address; smartAccount: Address | null }) {
  const signerBalance = useBalance(props.signer);
  const smartBalance = useBalance(props.smartAccount);

  return (
    <div className="card space-y-3">
      <p className="eyebrow eyebrow-brand">Your two addresses</p>
      <Row
        label="Signer"
        role="Embedded wallet (EOA)"
        address={props.signer}
        balance={signerBalance}
        hint="Owns the smart account and approves the session, once. Never sends the actions."
      />
      <Row
        label="Smart account"
        role="Kernel v3.1 (the sender)"
        address={props.smartAccount}
        balance={smartBalance}
        hint="Sends the actions and holds the score. It can stay at 0 PEPU because the paymaster pays the gas. Look transactions up by this address."
      />
    </div>
  );
}
