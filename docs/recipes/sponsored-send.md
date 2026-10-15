# Recipe: Send a Sponsored Transaction

Send a transaction from a smart account whose gas is paid by a paymaster, from a script or from a React component.

> Status: proven on mainnet. A zero-balance Kernel smart account transacted, paid for by the v2 paymaster `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (a canary: internally reviewed 3x, external audit pending, funded in small tranches) through the hosted bundler `https://bundler.pepeunchained.com` and paymaster `https://paymaster.pepeunchained.com/v2/paymaster/<server key>`. The bundler is the SDK default; you supply a project token. Local development defaults for your own services are `http://localhost:4337` and `http://localhost:8788`.

## Prerequisites

- The hosted bundler and paymaster (the SDK defaults), plus a project of yours that is claimed, configured and funded (see [Deposit and Claim a Paymaster Project](v2-deposit-and-claim.md)) and its token. The free tier needs a Privy token from PEPU's own Privy app and is not available to third-party apps.
- `@pepu-chain/sdk`, `viem`, and for the script path `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator`.
- The destination contract must be on the paymaster's allowlist. TapScore is the sample.

## Steps

1. Check the services are reachable with `checkSponsorship`. It never throws for an unreachable service and returns `fixes`.
2. Build the Kernel account with `toPepuKernelAccount`. Two addresses exist: the owner (signs) and the smart account (sends, holds assets). See [The Two-Address Model](../onboarding/two-address-model.md).
3. Create the client with `createPepuSponsoredClient`.
4. Send with `sendSponsored`. It encodes the calls, sends one UserOperation, waits for the receipt and reports who paid.

### Script

```ts
// Pillar 3: a sponsored transaction from a script (direct transport).
// Needs a bundler and a paymaster: set PEPU_BUNDLER_URL and PEPU_PAYMASTER_URL
// (the bundler defaults to https://bundler.pepeunchained.com; the ERC-7677 URL is https://paymaster.pepeunchained.com/v2/paymaster/<token>).
// Local dev defaults are http://localhost:4337 and http://localhost:8788 for your own services.
// See docs/sdk/aa.md and docs/recipes/sponsored-send.md
import { buildPaymasterContext, checkSponsorship, explorerLinks, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createPepuSponsoredClient, sendSponsored, toPepuKernelAccount } from "@pepu-chain/sdk/aa/kernel";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

const publicClient = getPublicClient(pepuMainnet);

// SCRIPT ONLY: the owner key stays in your environment.
const owner = privateKeyToAccount(process.env["OWNER_PRIVATE_KEY"] as Hex);

export async function sponsoredTap(privyAccessToken?: string) {
  // 1. Is sponsorship reachable? Never throws for an unreachable service.
  const status = await checkSponsorship({ publicClient });
  if (!status.available) throw new Error(`${status.reason} ${status.fixes.join(" ")}`);

  // 2. The Kernel smart account that sends and holds assets. The owner EOA only signs.
  const account = await toPepuKernelAccount({ publicClient, owner });

  // 3. A client that sends through your bundler and has gas paid by your paymaster.
  const client = createPepuSponsoredClient({
    account,
    // The v2 free tier wants the user's Privy access token (from PEPU's own Privy app).
    ...(privyAccessToken ? { paymasterContext: buildPaymasterContext({ privyAccessToken }) } : {}),
  });

  // 4. One UserOperation: encode, send, wait for the receipt, report who paid.
  const result = await sendSponsored({
    client,
    calls: [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  });

  return { ...result, links: explorerLinks({ tx: result.transactionHash, sender: account.address }) };
}
```

Source: `docs/snippets/sponsored-send.ts`, type-checked against the SDK.

### React

There are two hook entries. `useSponsoredSend` from `/aa/react` uses Privy's smart-wallet client with the bundler and paymaster URLs set in the Privy dashboard, and never needs ZeroDev. `useDirectSponsoredSend` from `/aa/react-direct` builds a Kernel account for the embedded wallet and uses the hosted endpoints (override with `PEPU_*`), passing the Privy access token as paymaster context (it only unlocks the free tier for PEPU's own Privy app) (it needs `@zerodev/sdk` and `@zerodev/ecdsa-validator`).

```tsx
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
```

Source: `docs/snippets/sponsored-send-react.tsx`, type-checked against the SDK.

## What to expect

- The smart account balance can be zero. `result.paymaster` is the paymaster address and `result.actualGasCostWei` is what it paid.
- A bundle can carry several operations. Use `userOpEventsFromReceipt` from `/aa` to inspect them all.
- pepuscan has no UserOperation page. Link the bundle transaction and the sender with `explorerLinks` (see [Explorer Links](explorer-links.md)).
- The first operation of a new account is larger because it deploys the account. The paymaster reserves about 20.5 PEPU for it and about 6.9 PEPU for later operations.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| "No bundler or paymaster URL is configured" | No paymaster token or `PEPU_PAYMASTER_URL` was supplied (the ERC-7677 URL always embeds a token) | Pass `paymasterToken` or set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<token>` |
| `project_origin_not_allowed` | A client token (`ppt_`) was used with no allowed origins or from another origin | Set the project's allowed origins, or use the server key (`ppk_`) from a backend |
| `PAYMASTER_NO_BALANCE` | The project's balance cannot cover the operation | Deposit PEPU into the project (`depositFor`). `checkSponsorship({ publicClient })` reports `depositWei` |
| `PAYMASTER_DESTINATION_NOT_ALLOWED` | The contract is not on the allowlist | Add it to the project's targets |
| `PAYMASTER_IDENTITY_REQUIRED` | The v2 free tier needs a verified Privy access token from PEPU's own Privy app | Pass `buildPaymasterContext({ privyAccessToken })`, or use a project instead |
| `BUNDLER_AA_FAILED` with an `AAxx` code | The EntryPoint rejected the operation | `error.hint` names the fix; `describeUserOpFailure` mapped it |
| `zd_getUserOperationGasPrice` not found | ZeroDev's default fee estimator against Alto | Use `createPepuSponsoredClient`, which wires the Alto-compatible one |

## Related

- [Sponsored Transactions](../onboarding/sponsored-transactions.md)
- [/aa](../sdk/aa.md), [/paymaster](../sdk/paymaster.md)
- [Sponsored Session in One Flow](sponsored-session.md)
- [Smart Accounts](../onboarding/smart-accounts.md)
