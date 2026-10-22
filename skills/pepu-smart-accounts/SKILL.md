---
name: pepu-smart-accounts
description: Account mechanics for ERC-4337 Kernel v3.1 smart accounts on Pepe Unchained (PEPU) V2 mainnet (chain 97741) with @pepu-chain/sdk - the two-address model (embedded EOA owner plus Kernel smart account), counterfactual addresses with getKernelAddress, toPepuKernelAccount, getPepuKernelStack, the ERC-7579 policy modules, and when a smart account is or is not the right choice. Deliberately slim - sending sponsored transactions is pepu-sponsored-transactions, the Google plus session plus sponsored combination is pepu-sponsored-session, v2 project funding is pepu-paymaster-projects. Use to compute or inspect a smart account, explain owner vs smart account, or choose between an EOA, Privy session signers and a Kernel account.
---

# Smart accounts on PEPU (mechanics only)

This skill is the account layer. Pick the task skill instead when you can:

| You want | Skill |
|---|---|
| gasless sends, bundler, paymaster, `useSponsoredSend` | `pepu-sponsored-transactions` |
| Google login, one signature, then no popups and no user gas | `pepu-sponsored-session` |
| claim, fund and configure a v2 sponsorship project  | `pepu-paymaster-projects` |
| popup-free actions where the user pays gas and an off-chain scope is fine | `pepu-session-keys` |

## When to use

- Compute a user's smart account address (a read, no signature, no deployment needed).
- Explain or inspect the owner / smart account split, the deployed Kernel stack, or the policy modules.
- Decide whether a Kernel account is worth it at all.

Which smart-account path (plain embedded wallet, ZeroDev-native, or Privy Smart Wallets), what each can do, mixing and migrating: https://docs.pepeunchained.com/concepts/smart-account-paths.

## Chain facts

Mainnet 97741 only; none of the AA stack exists on testnet. EntryPoint v0.6 and v0.7, the Kernel v3.1 factory, MetaFactory, implementation, ECDSA validator and signer module, the call policy v0.0.4, the timestamp policy and the verifying paymaster are in the generated table:
[reference/chain-facts.md](reference/chain-facts.md). Rules: [reference/rules.md](reference/rules.md). Use EntryPoint v0.7 for new work.
The chain's plain RPC does not serve bundler methods (`eth_sendUserOperation` and friends); those come from a bundler service you point `PEPU_BUNDLER_URL` at.

## SDK functions to use

```ts
import { getPublicClient, pepuMainnet, getPepuAddresses } from "@pepu-chain/sdk";
import { getPepuKernelStack, getKernelAccountAddress } from "@pepu-chain/sdk/aa";
import { toPepuKernelAccount, getKernelAddress } from "@pepu-chain/sdk/aa/kernel";
import { usePepuSmartAccount } from "@pepu-chain/sdk/aa/react";
import { privateKeyToAccount } from "viem/accounts";

const publicClient = getPublicClient(pepuMainnet);
const owner = "0x1111111111111111111111111111111111111111";

const smartAccount = await getKernelAddress(publicClient, owner);   // counterfactual, a read: needs no signature
const stack = getPepuKernelStack(pepuMainnet.id);                    // undefined unless every Kernel contract is deployed
const account = await toPepuKernelAccount({ publicClient, owner: privateKeyToAccount("0x" + "11".repeat(32) as `0x${string}`) });
console.log(smartAccount, stack?.entryPoint07.address, account.address, getPepuAddresses().length, typeof getKernelAccountAddress, typeof usePepuSmartAccount);
```

`getKernelAddress(publicClient, ownerAddress)` and `toPepuKernelAccount({ publicClient, owner, index? })` are the only way to build an account object: they pin Kernel v3.1, EntryPoint v0.7 and the registry's factory.
In React, `usePepuSmartAccount()` returns `{ owner, smartAccount, ready }`.

## MCP tools to call first

- `pepu_smart_account_info`: the counterfactual Kernel address for an owner via the factory's own `getAddress`, and whether it is deployed. Never signs or sends.
- `pepu_chain_info` and `pepu_check_contract_deployed`: the AA stack and whether each contract has code.
- `pepu_sponsorship_status`: before anything sponsorship-shaped.

## Steps

1. Get the owner address (the Privy embedded wallet from `useEmbeddedWallet`, or a given EOA).
2. Compute the smart account with `getKernelAddress` or `pepu_smart_account_info`. It is deployed on its first UserOperation.
3. Show the smart account address in the UI, not the owner address (below).
4. To send from it, go to `pepu-sponsored-transactions`; to add sessions, `pepu-sponsored-session`.

### The two-address model

A user has two addresses. The **owner** is the embedded EOA that signs and sends nothing. The **Kernel smart account** is a separate contract at a different address: it is the sender of every UserOperation, holds the user's assets and appears on pepuscan.
Never expect them to match and never tell a user to send funds to one expecting them at the other. The address depends only on the owner and `index`, never on a session.

### What a Kernel account adds over an EOA

- Batched, atomic multi-call transactions (`sendSponsored({ calls: [...] })`).
- Gas paid by a paymaster (`pepu-sponsored-transactions`).
- **On-chain-enforced session keys** via the permission validator, call policy v0.0.4 and timestamp policy (`pepu-sponsored-session`, `@pepu-chain/sdk/session/kernel`).
- ERC-7579 modules, custom validators. PEPU's P256 precompile (`0x100`) makes passkey validators cheap.

### When not to use one

A plain embedded EOA (`pepu-onboarding-privy`) needs nothing pre-funded and works immediately; a smart account needs a working bundler (or self-relay) and, unless a paymaster pays, its own PEPU balance, which is more moving parts for the same outcome.
For "no popup per transaction" with minimal infrastructure use `pepu-session-keys` (Privy mode). Reach for Kernel when you need on-chain-enforced scoping, batching or sponsorship.

### Without a bundler: self-relay

You can act as your own bundler by calling the EntryPoint's `handleOps` yourself. It is a standard ERC-4337 pattern, not a hack, but it is plumbing, not SDK: see [reference/self-relay-useroperations.md](reference/self-relay-useroperations.md) for the walkthrough and what to verify. Neither self-relay nor a self-run bundler sponsors gas unless you also run the paymaster policy service ([reference/self-hosting.md](../pepu-sponsored-transactions/reference/self-hosting.md)).

## Verify

1. `pepu_smart_account_info` for the owner returns the same address as `getKernelAddress`.
2. `pepu_check_contract_deployed` shows the factory and EntryPoint v0.7 deployed.
3. After a first UserOperation, the account has code (`deployed: true`).

## Pitfalls

- **Wrong address shown:** you displayed the owner, or computed with a different `index` or Kernel version. Use the SDK helpers only; never `permissionless`'s defaults, which target a different Kernel patch version than PEPU's deployed factory.
- **Bundler methods fail against the plain RPC:** viem's `createBundlerClient` or permissionless's `createSmartAccountClient` pointed at the chain RPC cannot work. Use a bundler URL (`probeBundler` / `pepu_bundler_health` checks it).
- **Testnet:** nothing here exists on 97740.
- Never claim gasless from this skill: that is decided by `pepu_sponsorship_status`.

## Never hand-roll

Do not build the account with raw `permissionless` or `@zerodev/sdk` calls, hand-compute counterfactual addresses, or hard-code the factory or EntryPoint addresses. Use `getKernelAddress`, `toPepuKernelAccount`, `getPepuKernelStack`, `usePepuSmartAccount`. See [reference/rules.md](reference/rules.md).
