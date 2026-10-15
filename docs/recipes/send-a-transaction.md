# Recipe: Send a Transaction

Send native PEPU from a key you control (scripts, backend jobs), or from a Privy embedded wallet in a React app (the flow a real user goes through).

> Status: proven on mainnet. These transactions cost real gas in PEPU paid by the sender. For gas the user does not pay, see [Send a Sponsored Transaction](sponsored-send.md).

A base fee around 12,500 gwei is normal on this chain, not an error. `formatPepu` and `estimateTransactionCost` show costs in a readable form.

## Prerequisites

`@pepu-chain/sdk` and `viem`. A funded sender. For React, [Provision the Wallet and Pin the Active Account](provision-and-pin-the-wallet.md).

## From a private key (scripts, backend)

Estimate first, check the balance covers amount plus gas with `maxSendableAmount`, send, wait, then link the result.

```ts
// Estimate, send and link a native PEPU transfer from a script.
// See docs/recipes/send-a-transaction.md
import {
  estimateTransactionCost,
  formatPepu,
  getPublicClient,
  maxSendableAmount,
  pepuMainnet,
  txUrl,
} from "@pepu-chain/sdk";
import { createWalletClient, http, parseEther } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const publicClient = getPublicClient(pepuMainnet);

// SCRIPT ONLY. Never ship a private key in a browser bundle.
const account = privateKeyToAccount(process.env["DEPLOYER_PRIVATE_KEY"] as Hex);
const walletClient = createWalletClient({ account, chain: pepuMainnet, transport: http() });

export async function sendPepu(to: `0x${string}`, amountPepu: string): Promise<string> {
  const value = parseEther(amountPepu);

  const estimate = await estimateTransactionCost(publicClient, { account: account.address, to, value });
  console.log(`Estimated cost: ${estimate.costFormatted}`);

  const balanceWei = await publicClient.getBalance({ address: account.address });
  const max = await maxSendableAmount({ client: publicClient, from: account.address, to, balanceWei });
  if (max.status !== "ok") throw new Error(max.reason);
  if (value > max.amountWei) throw new Error("Amount leaves too little PEPU for gas");

  const hash = await walletClient.sendTransaction({ to, value });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Sent ${formatPepu(value)}`);
  return txUrl(pepuMainnet, hash);
}
```

Source: `docs/snippets/send-transaction.ts`, type-checked against the SDK.

The key comes from the environment. Never a key that holds real value in a script like this, and never in a browser bundle.

## From a Privy embedded wallet (React)

The embedded wallet is a normal wagmi connector once you use `@privy-io/wagmi`'s config, which `PepuPrivyWagmiProvider` does for you.

```tsx
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { pepuMainnet, txUrl } from "@pepu-chain/sdk";
import { useState } from "react";

export function SendPepuForm() {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const { sendTransaction, data: hash, isPending } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        sendTransaction({ to: to as `0x${string}`, value: parseEther(amount) });
      }}
    >
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..." />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01" />
      <button type="submit" disabled={isPending || isConfirming}>
        {isPending ? "Confirm in wallet" : isConfirming ? "Confirming" : "Send PEPU"}
      </button>
      {hash && <a href={txUrl(pepuMainnet, hash)}>View on pepuscan</a>}
      {isSuccess && <p>Sent.</p>}
    </form>
  );
}
```

This is the pattern the `consumer-app` template's send form uses. Privy's confirmation modal runs its own balance check before signing and can refuse an amount `maxSendableAmount` sized correctly, which is why the template has no "Max" button.

## Calling a contract function

Use `useWriteContract` in React or `walletClient.writeContract` in a script. Take the address from the registry:

```tsx
import { useWriteContract } from "wagmi";
import { parseAbi } from "viem";

const abi = parseAbi(["function tap() external"]);

export function TapButton() {
  const { writeContract, isPending } = useWriteContract();
  return (
    <button
      disabled={isPending}
      onClick={() =>
        writeContract({ address: "0x261eA5971B93237a56990206A46Bc80318e4d078", abi, functionName: "tap" })
      }
    >
      Tap
    </button>
  );
}
```

## What to expect

- `receipt.status` is `"success"` or `"reverted"`. A revert still costs gas.
- The cost shown by `estimateTransactionCost` excludes the L1 data fee, which reads as 0 on PEPU today (see `explainDualFeeModel`).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Transaction stuck | A hardcoded gas price below the base fee | Let viem or the SDK estimate it. Never hardcode a low price |
| `insufficient funds for gas` | Amount plus gas exceeds the balance | Use `maxSendableAmount` to size it |
| Wrong account sends | An extension became wagmi's active account | Keep the active-wallet pin on |
| Privy modal refuses a valid amount | Its own over-conservative balance check | Send a smaller amount, or sign without Privy's modal |

## Related

- [Send a Sponsored Transaction](sponsored-send.md)
- [Grant a Session](grant-a-session.md) for repeated actions with no popup
- [Sign with Privy, Broadcast Yourself](sign-with-privy-broadcast-yourself.md)
- [Core](../sdk/core.md#gas-and-fees)
