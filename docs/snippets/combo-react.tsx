// The combination, client: one owner signature, then actions with no popup and no gas.
// See docs/sdk/combo.md and docs/recipes/sponsored-session.md
import { describeKernelSessionScope } from "@pepu-chain/sdk/session/kernel";
import type { KernelSessionCall } from "@pepu-chain/sdk/session/kernel";
import { useSponsoredSession } from "@pepu-chain/sdk/combo/react";
import type { SponsoredActResult } from "@pepu-chain/sdk/combo/react";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

// The browser rebuilds the policies from the same scope the server uses.
const calls: KernelSessionCall[] = [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }];
const scope = { calls };

export function SponsoredSession() {
  const { phase, statusLoading, owner, smartAccount, expiresAt, grant, act, revoke, error } = useSponsoredSession<
    undefined,
    SponsoredActResult
  >({ scope });

  if (statusLoading) return <p>Checking session</p>;
  const preview = describeKernelSessionScope({ calls, validUntil: Math.floor(Date.now() / 1000) + 15 * 60 });

  return (
    <div>
      <p>Owner (signs once): {owner}</p>
      <p>Smart account (sends, holds assets): {smartAccount}</p>

      {phase === "ready" || phase === "expired" ? (
        <div>
          <p>This session may call: {preview.calls.map((c) => c.signature).join(", ")}</p>
          <button onClick={() => void grant()}>Start session</button>
        </div>
      ) : null}

      {phase === "active" ? (
        <div>
          <p>Active until {expiresAt}</p>
          <button onClick={() => void act().then((r) => console.log(r.explorerUrl))}>Tap, no popup, no gas</button>
          <button onClick={() => void revoke()}>End session</button>
        </div>
      ) : null}

      {error ? (
        <p>
          {error.code}: {error.hint}
        </p>
      ) : null}
    </div>
  );
}
