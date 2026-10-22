// Pillar 3, client: send with gas sponsored from a component.
// See docs/sdk/aa.md and docs/recipes/sponsored-send.md
import { usePepuSmartAccount, usePepuSponsorship, useSponsoredSend } from "@pepu-chain/sdk/aa/react";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

export function SponsoredTap() {
  const { smartAccount } = usePepuSmartAccount();
  // "privy-smart-wallets" uses the bundler and paymaster URLs from the Privy dashboard.
  // For your own bundler and paymaster, use useDirectSponsoredSend from "@pepu-chain/sdk/aa/react-direct".
  const { send, status, result, error } = useSponsoredSend({ transport: "privy-smart-wallets" });
  const sponsorship = usePepuSponsorship({ pollMs: 0 });

  return (
    <div>
      <p>Smart account: {smartAccount}</p>
      <button
        disabled={status === "signing" || status === "submitting"}
        onClick={() => void send([{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }])}
      >
        Tap, no gas
      </button>
      {status === "confirmed" && result ? <a href={result.explorerUrl}>Paid by {result.paymaster}</a> : null}
      {error ? (
        <p>
          {error.code}: {error.hint}
        </p>
      ) : null}
      {!sponsorship.loading && !sponsorship.available ? <p>{sponsorship.reason}</p> : null}
    </div>
  );
}
