# Sign with Privy, Broadcast Yourself

**Recipe:** submit a transaction on a user's behalf from your backend, using a Privy session signer, on Pepe Unchained V2. Ask Privy to **sign**, then broadcast the signed transaction yourself through PEPU's RPC.

This is the supported pattern on PEPU, proven end to end on mainnet. It is not a workaround for a bug in your code: the one-call alternative does not work on this chain.

> Status: proven on mainnet (Privy session signers, `game-app` template). The SDK implements the pattern as `signAndBroadcast` and `privySessionSigner`.

## Why not `eth_sendTransaction`

Privy's server-side `eth_sendTransaction` asks Privy to construct, sign, broadcast and track the transaction in a single call. On PEPU it fails:

```
400 { "error": "Unsupported chain with id 97741", "code": "invalid_data" }
```

That is not a malformed request. Privy groups chain support into tiers, and "send transactions" (Tier 3) means Privy's own managed infrastructure handles the whole lifecycle. PEPU, an Arbitrum Orbit chain operated by Conduit, is not one of the chains that infrastructure covers. There is no self-serve way to register a custom chain for it; Privy's own docs point to contacting Privy support to request a chain.

It is also different from what already works on PEPU. Client-side signing in the embedded wallet works fine, because the browser broadcasts through the RPC you configured in your chain definition. Privy only has to produce a signature, which is chain-agnostic. The server-side send flow broadcasts through Privy's RPC, which is where the chain allowlist lives.

## The pattern

`eth_signTransaction` takes no chain parameter, so there is nothing for an allowlist to reject, and Privy's policy engine evaluates the same conditions against it (`ethereum_transaction` and `ethereum_calldata` field sources work for both methods). Your backend then broadcasts the raw signed transaction.

One consequence: Privy does not fill in missing nonce or gas fields for signing the way it can for a send on a chain it manages. Resolve them yourself first.

The SDK implements all three steps. `signAndBroadcast` resolves the pending nonce, gas (plus 20 percent) and gas price against PEPU's RPC, builds the legacy transaction, calls your `sign` callback (Privy `eth_signTransaction`), and broadcasts the result. `privySessionSigner` from `@pepu-chain/sdk/session/server` wraps it for a session wallet.

```ts
// Sign with Privy on the server, broadcast to PEPU yourself.
// SERVER ONLY. See docs/recipes/sign-with-privy-broadcast-yourself.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createPrivyServer, privyEnvVar } from "@pepu-chain/sdk/privy/server";
import { privySessionSigner } from "@pepu-chain/sdk/session/server";
import { signAndBroadcast } from "@pepu-chain/sdk/session";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

const privy = createPrivyServer();

// Easiest: the SDK's signer for a session wallet.
export async function tapWithSigner(walletId: string, address: `0x${string}`): Promise<`0x${string}`> {
  const signer = privySessionSigner({ privy, walletId, address });
  return signer.signAndBroadcast({ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" });
}

// Lower level: you own the sign callback.
export async function tapWithCallback(walletId: string, address: `0x${string}`): Promise<`0x${string}`> {
  const authorizationKey = privyEnvVar("authorizationKey");
  if (!authorizationKey) throw new Error("PRIVY_AUTHORIZATION_KEY is not set");

  return signAndBroadcast({
    client: getPublicClient(pepuMainnet),
    from: address,
    to: TAPSCORE_ADDRESS,
    abi: tapScoreAbi,
    functionName: "tap",
    chainId: pepuMainnet.id,
    sign: (transaction) =>
      privy
        .wallets()
        .ethereum()
        .signTransaction(walletId, {
          params: { transaction },
          authorization_context: { authorization_private_keys: [authorizationKey] },
        }),
  });
}
```

Source: `docs/snippets/sign-and-broadcast.ts`, type-checked against the SDK.

What `signAndBroadcast` does, so you can reason about failures:

1. Resolve everything Privy will not fill in, against PEPU's own RPC: `getTransactionCount` (pending), `estimateGas` and `getGasPrice`.
2. Ask Privy to sign. The attached session policy is evaluated here.
3. Broadcast the raw signed transaction with `sendRawTransaction`.

Notes on the choices above:

- **Legacy `type: 0` with a single `gas_price`.** PEPU is an Arbitrum Nitro chain with a single-component L2 execution price, and legacy transactions are accepted everywhere without depending on EIP-1559 fee-estimation RPC methods. See [`@pepu-chain/sdk`'s gas helpers](../sdk/core.md#gas-and-fees) for the dual-fee model.
- **Do not hardcode a lower gas price.** Use `getGasPrice()`. PEPU's base fee is about 12,500 gwei and a lower value gets your transaction stuck. See [Troubleshooting](../troubleshooting.md).
- **Hex quantities.** Privy's quantity fields take `0x`-prefixed hex strings. Convert `bigint` values with `toHex`; do not squeeze them through `Number`.
- **Optional authenticated RPC.** The public RPC is rate-limited. Pass a Conduit URL with your API key to `getPublicClient` through a custom transport if you expect volume. See [Network Reference](../get-started/network-reference.md#authenticated-rpc).
- **Never set `sponsor: true`.** It belongs to the same managed-chain infrastructure and does nothing here. Gas is paid by the user's embedded wallet.

## The policy must target `eth_signTransaction`

The session signer's policy rule must use `method: "eth_signTransaction"`. A rule written for `eth_sendTransaction` never matches a sign request, so every call would be denied. The scope is otherwise unchanged:

```ts
{
  name: "Allow tap() on TapScore, 0 value, expires",
  method: "eth_signTransaction",
  action: "ALLOW",
  conditions: [
    { field_source: "ethereum_transaction", field: "to", operator: "eq", value: contractAddress },
    { field_source: "ethereum_calldata", field: "function_name", abi: [tapFunctionAbi], operator: "eq", value: "tap" },
    { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0x0" },
    { field_source: "system", field: "current_unix_timestamp", operator: "lte", value: String(expiresAtUnixSeconds) },
  ],
}
```

Policy and rule names must be at most 49 characters. Privy's published spec says `maxLength: 50`, but its live validator rejects names of 50 characters or more ("must be fewer than 50 characters"), so treat 49 as the limit. `buildSessionPolicy` from `@pepu-chain/sdk/session` enforces it (also exported from `@pepu-chain/sdk/server`), and `signAndBroadcast` implements the sign-then-broadcast flow above. The full policy rules, the consent screen and the safety caveats are on [Session Keys](../onboarding/session-keys.md).

## What changes compared to a managed send

- **No pre-signing simulation.** On a chain it manages, Privy can simulate before signing, so an obviously reverting call is rejected before it is ever signed. Pure signing has no such step. A call that would revert is discovered when you broadcast it, as an ordinary on-chain revert. The policy still enforces contract, function, value and expiry before Privy signs; only the place a simulation failure surfaces moves.
- **You own nonce management.** Two rapid requests for the same wallet can race. Use `blockTag: "pending"` as above, and serialize requests per wallet if a user can trigger them quickly (a double tap, for example). A broadcast failure from a nonce race is a failed transaction, not evidence that the session is gone, so do not send the user back to the consent screen.
- **You own failures.** A policy denial and a broadcast error both come back as errors from your route. Surface them as failed transactions.

## Reference implementation

The `game-app` template does exactly this. Its tap route, `app/api/game/tap/route.ts`, carries the full investigation in a long comment, and `lib/tap-transaction.ts` builds the unsigned transaction with unit tests. `lib/session-policy.ts` is the only place a policy is built.

```bash
npx create-pepu-app@latest my-game --template game-app
```

(See the [Quickstart](../get-started/quickstart-app.md) for more on `create-pepu-app`.)

## Related

- [Session Keys: No Popup Per Transaction](../onboarding/session-keys.md)
- [Privy Setup](../onboarding/privy-setup.md)
- [Send a Transaction](send-a-transaction.md): the client-side path, where the user's own browser signs and broadcasts.

