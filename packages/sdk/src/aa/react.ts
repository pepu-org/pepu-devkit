/**
 * @pepu-chain/sdk/aa/react: React hooks for sponsored transactions with Privy
 * Smart Wallets.
 *
 * Needs `react`, `@privy-io/react-auth` and, because Privy's smart-wallets
 * module requires it, `permissionless`. It never references `@zerodev/*`,
 * statically or dynamically, so a bundler resolving it needs no ZeroDev. The
 * transport reads bundler and paymaster URLs from the Privy dashboard. To use
 * your own bundler and paymaster instead, see `@pepu-chain/sdk/aa/react-direct`.
 *
 * Flow ported from `templates/sponsored-demo/components/sponsored-tap-demo.tsx`
 * (smart-wallet client, in-flight guard, real error text via describeUserOpFailure).
 */
import { useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, PublicClient } from "viem";

import { pepuMainnet } from "../chains.js";
import { getPublicClient } from "../client.js";
import { PepuConfigError, toPepuError } from "../errors.js";
import type { PepuError } from "../errors.js";
import { txUrl } from "../explorer.js";
import { normalizeCalls, userOpEventFromReceipt } from "./calls.js";
import { describeUserOpFailure } from "./describe.js";
import { checkSponsorship } from "./status.js";
import type { SponsorshipReport } from "./status.js";
import type { Call, SponsoredResult } from "./types.js";

export type { Call, SponsoredResult } from "./types.js";

let sharedClient: PublicClient | undefined;
function publicClient(): PublicClient {
  sharedClient ??= getPublicClient(pepuMainnet) as unknown as PublicClient;
  return sharedClient;
}

/** The Privy embedded wallet, the owner of the smart account. */
function useEmbeddedWallet() {
  const { wallets } = useWallets();
  return wallets.find((w) => w.walletClientType === "privy");
}

/**
 * The two-address model made explicit: `owner` is the Privy embedded wallet
 * (an EOA that signs), `smartAccount` is the Kernel account that sends and
 * holds assets. With Privy Smart Wallets the smart account comes from the
 * provider: `useSmartWallets().client`, or, while that is still unset,
 * `getClientForChain({ id: 97741 })`. For an address derived without Privy
 * Smart Wallets, use `useDirectSmartAccount` from `@pepu-chain/sdk/aa/react-direct`.
 *
 * @example
 * const { owner, smartAccount, ready } = usePepuSmartAccount();
 */
export function usePepuSmartAccount(): { owner?: Address; smartAccount?: Address; ready: boolean } {
  const embedded = useEmbeddedWallet();
  const { client, getClientForChain } = useSmartWallets();
  const getClientRef = useRef(getClientForChain);
  getClientRef.current = getClientForChain;
  const owner = embedded?.address as Address | undefined;
  const fromProvider = client?.account?.address as Address | undefined;
  const [resolved, setResolved] = useState<{ owner: Address; address: Address } | undefined>();

  useEffect(() => {
    if (!owner || fromProvider) return;
    let cancelled = false;
    // Privy's per-chain client may populate after `client`.
    Promise.resolve(getClientRef.current?.({ id: pepuMainnet.id }))
      .then((c) => {
        const address = c?.account?.address as Address | undefined;
        if (!cancelled && address) setResolved({ owner, address });
      })
      .catch(() => {
        // Smart Wallets not configured for this chain: `ready` stays false.
      });
    return () => {
      cancelled = true;
    };
  }, [owner, fromProvider]);

  const smartAccount = fromProvider ?? (resolved && resolved.owner === owner ? resolved.address : undefined);
  return {
    ...(owner ? { owner } : {}),
    ...(smartAccount ? { smartAccount } : {}),
    ready: owner !== undefined && smartAccount !== undefined,
  };
}

/** Status of a {@link useSponsoredSend} send. */
export type SponsoredSendStatus = "idle" | "signing" | "submitting" | "confirmed" | "error";

/** Options for {@link useSponsoredSend}. */
export interface UseSponsoredSendOptions {
  /** The only transport here. Your own bundler and paymaster: `useDirectSponsoredSend` in `@pepu-chain/sdk/aa/react-direct`. */
  transport?: "privy-smart-wallets";
}

/**
 * Send calls with gas sponsored through Privy's smart-wallet client (bundler
 * and paymaster URLs come from the Privy dashboard). One send at a time: a
 * second call while one is in flight is ignored. For your own bundler and
 * paymaster, use `useDirectSponsoredSend` from `@pepu-chain/sdk/aa/react-direct`.
 *
 * @example
 * const { send, status, result, error } = useSponsoredSend({ transport: "privy-smart-wallets" });
 * await send([{ to: tapScore, abi: tapScoreAbi, functionName: "tap" }]);
 */
export function useSponsoredSend(_options: UseSponsoredSendOptions = {}): {
  send: (calls: Call[]) => Promise<SponsoredResult>;
  status: SponsoredSendStatus;
  result?: SponsoredResult;
  error?: PepuError;
} {
  const { client, getClientForChain } = useSmartWallets();
  const [status, setStatus] = useState<SponsoredSendStatus>("idle");
  const [result, setResult] = useState<SponsoredResult | undefined>();
  const [error, setError] = useState<PepuError | undefined>();
  const inFlight = useRef(false);

  const send = useCallback(
    async (calls: Call[]): Promise<SponsoredResult> => {
      if (inFlight.current) {
        throw new PepuConfigError("UNKNOWN", "A sponsored send is already in progress.", {
          hint: "Wait for the current send to finish.",
        });
      }
      inFlight.current = true;
      setStatus("signing");
      setError(undefined);
      setResult(undefined);
      try {
        const encoded = normalizeCalls(calls);
        const pc = publicClient();


        const sw = client ?? (await getClientForChain({ id: pepuMainnet.id }));
        if (!sw) {
          throw new PepuConfigError(
            "CONFIG_PRIVY_DASHBOARD",
            "No Privy smart-wallet client is available.",
            { hint: 'Enable "Smart Wallets" for chain 97741 in the Privy dashboard and wrap the app in SmartWalletsProvider.' },
          );
        }
        setStatus("submitting");
        const hash =
          encoded.length === 1 && encoded[0]
            ? await sw.sendTransaction({ to: encoded[0].to, data: encoded[0].data, value: encoded[0].value })
            : await sw.sendTransaction({ calls: encoded });
        const receipt = await pc.waitForTransactionReceipt({ hash });
        const paid = userOpEventFromReceipt(receipt, sw.account.address as Address);
        const out: SponsoredResult = {
          userOpHash: paid?.userOpHash ?? null,
          transactionHash: hash,
          success: paid?.success ?? receipt.status === "success",
          paymaster: paid?.paymaster ?? null,
          actualGasCostWei: paid?.actualGasCost ?? 0n,
          explorerUrl: txUrl(pepuMainnet, hash),
        };
        setResult(out);
        setStatus("confirmed");
        return out;
      } catch (caught) {
        const err = toPepuError(caught) === caught ? (caught as PepuError) : describeUserOpFailure(caught);
        setError(err);
        setStatus("error");
        throw err;
      } finally {
        inFlight.current = false;
      }
    },
    [client, getClientForChain],
  );

  return { send, status, ...(result ? { result } : {}), ...(error ? { error } : {}) };
}

/**
 * Live sponsorship status, polled. The live replacement for the deprecated
 * `useSponsorshipStatus` (which always said unavailable).
 *
 * @example
 * const s = usePepuSponsorship({ pollMs: 15000 });
 * if (!s.loading && !s.available) console.log(s.reason, s.fixes);
 */
export function usePepuSponsorship(
  o: { pollMs?: number; bundlerUrl?: string; paymasterUrl?: string } = {},
): SponsorshipReport & { loading: boolean } {
  const [report, setReport] = useState<SponsorshipReport>({
    available: false,
    transport: "none",
    bundler: { configured: false },
    paymaster: { configured: false },
    reason: "Checking sponsorship status.",
    fixes: [],
  });
  const [loading, setLoading] = useState(true);
  const { pollMs = 30_000, bundlerUrl, paymasterUrl } = o;

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const r = await checkSponsorship({
          publicClient: publicClient(),
          ...(bundlerUrl !== undefined ? { bundlerUrl } : {}),
          ...(paymasterUrl !== undefined ? { paymasterUrl } : {}),
        });
        if (!cancelled) setReport(r);
      } catch (e) {
        if (!cancelled) {
          setReport((prev) => ({ ...prev, available: false, reason: toPepuError(e).message, fixes: [toPepuError(e).hint] }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    const id = pollMs > 0 ? setInterval(() => void run(), pollMs) : undefined;
    return () => {
      cancelled = true;
      if (id !== undefined) clearInterval(id);
    };
  }, [pollMs, bundlerUrl, paymasterUrl]);

  return { ...report, loading };
}
