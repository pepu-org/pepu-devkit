// Path 1 (ZeroDev-native), browser: the SDK builds the Kernel account for the Privy embedded wallet.
// No Privy Smart Wallets setting is needed. The owner signs each send (no session here).
// NEXT_PUBLIC_ values are visible to every visitor: use a project CLIENT token (ppt_) with allowed origins, never a server key (ppk_).
// See docs/concepts/smart-account-paths.md
import { useDirectSmartAccount, useDirectSponsoredSend } from "@pepu-chain/sdk/aa/react-direct";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

export function NativeTap() {
  const { owner, smartAccount } = useDirectSmartAccount(); // two addresses: the EOA signs, the Kernel account sends
  // Next.js only inlines literal process.env.NEXT_PUBLIC_X reads, so pass the URLs explicitly.
  const { send, status, result, error } = useDirectSponsoredSend({
    ...(process.env["NEXT_PUBLIC_PEPU_BUNDLER_URL"] ? { bundlerUrl: process.env["NEXT_PUBLIC_PEPU_BUNDLER_URL"] } : {}),
    ...(process.env["NEXT_PUBLIC_PEPU_PAYMASTER_URL"] ? { paymasterUrl: process.env["NEXT_PUBLIC_PEPU_PAYMASTER_URL"] } : {}),
  });

  return (
    <div>
      <p>Owner (signs): {owner}</p>
      <p>Smart account (sends): {smartAccount}</p>
      <button
        disabled={status === "signing" || status === "submitting"}
        onClick={() => void send([{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }])}
      >
        Tap, no gas
      </button>
      {status === "confirmed" && result ? <a href={result.explorerUrl}>Paid by {result.paymaster}</a> : null}
      {error ? <p>{error.code}: {error.hint}</p> : null}
    </div>
  );
}
