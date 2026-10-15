/**
 * @pepu-chain/sdk/aa/react-direct: React hooks for sponsored transactions that
 * go through your own bundler and paymaster (no Privy Smart Wallets).
 *
 * Needs `react`, `@privy-io/react-auth` and the optional peers `@zerodev/sdk`
 * and `@zerodev/ecdsa-validator`. It builds a Kernel account for the Privy
 * embedded wallet and passes the Privy access token as paymaster context for
 * the free tier. Apps on Privy Smart Wallets use `@pepu-chain/sdk/aa/react`
 * instead, which never resolves ZeroDev.
 */
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import type { Address, PublicClient } from "viem";

import { pepuMainnet } from "../chains.js";
import { getPublicClient } from "../client.js";
import { PepuConfigError, toPepuError } from "../errors.js";
import type { PepuError } from "../errors.js";
import { buildPaymasterContext } from "../erc7677.js";
import { describeUserOpFailure } from "./describe.js";
import { getKernelAddress, createPepuSponsoredClient, sendSponsored, toPepuKernelAccount } from "./kernel.js";
import type { Call, SponsoredResult } from "./types.js";

export type { Call, SponsoredResult } from "./types.js";

let sharedClient: PublicClient | undefined;
function publicClient(): PublicClient {
  sharedClient ??= getPublicClient(pepuMainnet) as unknown as PublicClient;
  return sharedClient;
}

function useEmbeddedWallet() {
  const { wallets } = useWallets();
  return wallets.find((w) => w.walletClientType === "privy");
}

/**
 * The two-address model for the direct transport: `owner` is the Privy
 * embedded wallet (an EOA that signs), `smartAccount` is the Kernel address
 * derived from it with {@link getKernelAddress} (a read).
 *
 * @example
 * const { owner, smartAccount, ready } = useDirectSmartAccount();
 */
export function useDirectSmartAccount(): { owner?: Address; smartAccount?: Address; ready: boolean } {
  const embedded = useEmbeddedWallet();
  const owner = embedded?.address as Address | undefined;
  const [derived, setDerived] = useState<{ owner: Address; address: Address } | undefined>();

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    getKernelAddress(publicClient(), owner)
      .then((address) => {
        if (!cancelled) setDerived({ owner, address });
      })
      .catch(() => {
        // Derivation is best effort; `ready` stays false.
      });
    return () => {
      cancelled = true;
    };
  }, [owner]);

  const smartAccount = derived && derived.owner === owner ? derived.address : undefined;
  return {
    ...(owner ? { owner } : {}),
    ...(smartAccount ? { smartAccount } : {}),
    ready: owner !== undefined && smartAccount !== undefined,
  };
}

/** Status of a {@link useDirectSponsoredSend} send. */
export type DirectSponsoredSendStatus = "idle" | "signing" | "submitting" | "confirmed" | "error";

/** Options for {@link useDirectSponsoredSend}. */
export interface UseDirectSponsoredSendOptions {
  bundlerUrl?: string;
  paymasterUrl?: string;
}

/**
 * Send calls with gas sponsored through your own bundler and paymaster. Builds
 * a Kernel account for the embedded wallet and passes the Privy access token
 * as paymaster context for the free tier. One send at a time: a second call
 * while one is in flight is ignored.
 *
 * @example
 * const { send, status, result, error } = useDirectSponsoredSend();
 * await send([{ to: tapScore, abi: tapScoreAbi, functionName: "tap" }]);
 */
export function useDirectSponsoredSend(o: UseDirectSponsoredSendOptions = {}): {
  send: (calls: Call[]) => Promise<SponsoredResult>;
  status: DirectSponsoredSendStatus;
  result?: SponsoredResult;
  error?: PepuError;
} {
  const { getAccessToken } = usePrivy();
  const embedded = useEmbeddedWallet();
  const [status, setStatus] = useState<DirectSponsoredSendStatus>("idle");
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
        if (!embedded) {
          throw new PepuConfigError("WALLET_NOT_PROVISIONED", "No Privy embedded wallet to own the smart account.");
        }
        const pc = publicClient();
        const provider = await embedded.getEthereumProvider();
        const owner = createWalletClient({
          account: embedded.address as Address,
          chain: pepuMainnet,
          transport: custom(provider),
        });
        const token = await getAccessToken();
        const account = await toPepuKernelAccount({ publicClient: pc, owner });
        const kernel = createPepuSponsoredClient({
          account,
          publicClient: pc,
          ...(o.bundlerUrl !== undefined ? { bundlerUrl: o.bundlerUrl } : {}),
          ...(o.paymasterUrl !== undefined ? { paymasterUrl: o.paymasterUrl } : {}),
          ...(token ? { paymasterContext: buildPaymasterContext({ privyAccessToken: token }) } : {}),
        });
        setStatus("submitting");
        const out = await sendSponsored({ client: kernel, calls });
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
    [embedded, getAccessToken, o.bundlerUrl, o.paymasterUrl],
  );

  return { send, status, ...(result ? { result } : {}), ...(error ? { error } : {}) };
}
