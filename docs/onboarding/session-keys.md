# Session Keys: No Popup Per Transaction

Pillar 2 of the dev kit. A user approves a limited session once, and your app then acts for them with no wallet popup per action. The kit offers two modes that differ in who enforces the limits and who pays gas. This page explains both, the trust model of each, the SDK code for each, and how to choose.

Kernel mode needs a bundler and a paymaster, which PEPU hosts (`https://bundler.pepeunchained.com`, `https://paymaster.pepeunchained.com`) and which need a funded project of yours.

Terms used on this page: [session key](../reference/glossary.md), [session signer](../reference/glossary.md), [Kernel](../reference/glossary.md), [UserOperation](../reference/glossary.md). All are defined in the [Glossary](../reference/glossary.md).

## Prerequisites

- Pillar 1 working: [Social Login and Embedded Wallets](privy-embedded-wallets.md). A session needs the user's embedded wallet address. Privy attaches a session signer only to an embedded wallet, so use `useEmbeddedWallet`, not wagmi's `useAccount()`, to get it.
- Privy mode: an authorization key and key quorum ([Authorization Keys and Key Quorums](../privy/authorization-keys.md)) and a deployed target contract.
- Kernel mode: a bundler, a paymaster, a target contract on the paymaster's allowlist and a `SessionStore`. See [Sponsored Transactions](sponsored-transactions.md).

## Choose a mode

| | Privy session signers | Kernel on-chain session keys |
|---|---|---|
| Limits enforced by | Privy's policy engine, off-chain | Call and timestamp policy contracts in the user's smart account, on-chain |
| Gas | The user pays, a fraction of a cent | Typically sponsored (the combination); without a paymaster the account pays |
| Scope fields | One contract, listed functions, value must be 0, expiry | One or more targets and functions, `valueLimit` (default 0), validity window |
| Revocation | `removeSigners` from the browser is the real revoke | Server deletes the key at once; the on-chain grant lapses at expiry |
| Custody of the acting key | Privy holds the wallet; your server holds an authorization key | Your server holds a session private key |
| Setup | Dashboard authorization key plus quorum | Bundler, paymaster, durable encrypted store |
| Template | `game-app` | `sponsored-session-app` |

If you want the chain, not a vendor or your backend, to enforce the limits, use Kernel mode. If you want popup-free actions with the least infrastructure, use Privy mode.

## Mode A: Privy session signers

### How it works

1. **Sign in.** The user has an embedded wallet.
2. **Grant, once.** Your grant route creates a fresh scoped, time-bound Privy policy and returns its id. The browser calls Privy's `addSigners` with your key quorum id and that policy id. Privy shows its consent step; the user approves.
3. **Act.** Your action route finds the user's delegated wallet, re-checks the call against the scope, asks Privy to sign with `eth_signTransaction` (authorized by your authorization key), then broadcasts the raw transaction to PEPU's RPC itself.
4. **Revoke.** The browser calls `removeSigners`. Your server then deletes the now-unattached policy as cleanup.

Privy's server-side `eth_sendTransaction` rejects chain 97741 ("Unsupported chain with id 97741"). That is why the route signs and broadcasts itself, with a 20% gas-limit buffer. See [Sign with Privy, Broadcast Yourself](../recipes/sign-with-privy-broadcast-yourself.md).

### Trust model

- The scope is enforced by Privy's backend policy engine when it receives each signing request. It is not on-chain. You trust Privy and your policy configuration. Show `SESSION_TRUST_NOTICE["privy-offchain"]` on the consent screen.
- A policy bounds `to`, function, `value` and expiry. It cannot bound gas, so the user's wallet pays for every action.
- `PRIVY_AUTHORIZATION_KEY` is a production signing key. Anyone holding it can request transactions for any wallet that granted a signer to its quorum, bounded by the attached policy. It is server-only.
- A policy must always be attached. A signer granted with no policy is unscoped over the wallet. The SDK refuses to build an unscoped policy, and `createSessionActionRoute` re-checks every call against the scope before signing.

### The policy

`buildSessionPolicy` produces one `ALLOW` rule per function with four conditions: `to` equals the contract, calldata decodes to the function, `value` equals `0x0`, and `current_unix_timestamp` is at most the expiry. The rule's method is `eth_signTransaction`. Privy denies by default when no rule matches. Policy and rule names must be at most 49 characters (`PRIVY_POLICY_NAME_MAX_LENGTH`): Privy's live validator says "fewer than 50" although its OpenAPI spec says 50. The SDK throws `POLICY_NAME_TOO_LONG` instead of letting Privy return an opaque 400. Keep functions non-payable; that is what makes the zero-value condition meaningful.

### SDK code

```ts
// lib/scope.ts  (the one place the scope is defined)
import type { AbiFunction, Address } from "viem";

export const tapFunction = {
  type: "function",
  name: "tap",
  stateMutability: "nonpayable",
  inputs: [],
  outputs: [],
} as const satisfies AbiFunction;

export const sessionScope: { contractAddress: Address; functions: readonly AbiFunction[] } = {
  contractAddress: process.env.NEXT_PUBLIC_GAME_CONTRACT_ADDRESS as Address,
  functions: [tapFunction],
};
```

```ts
// app/api/session/grant/route.ts
import { createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { sessionScope } from "@/lib/scope";

export const { POST } = createSessionRoutes({
  scope: sessionScope,
  contractAddressEnv: "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
}).grant;
```

`createSessionRoutes` returns `grant.POST`, `status.GET` and `revoke.POST`; mount each in its own `app/api/session/<name>/route.ts`. Grant returns `{ alreadyGranted: false, policyId, expiresAt, signerId, durationMinutes }`, or `{ alreadyGranted: true }` when a signer is already attached (the client must not call `addSigners` again: Privy fails with "Duplicate signer"). Status returns `{ delegated, active, address }`. Privy does not expose a policy's expiry, so the client tracks `expiresAt` from the grant. Session length comes from `SESSION_DURATION_MINUTES`, default 15, clamped to 1 to 1440. If the contract address is unset the routes answer every request with a `CONFIG_MISSING_ENV` JSON error instead of crashing at import.

```ts
// app/api/game/tap/route.ts
import { createSessionActionRoute } from "@pepu-chain/sdk/session/server";
import { sessionScope, tapFunction } from "@/lib/scope";

export const { POST } = createSessionActionRoute({
  scope: sessionScope,
  contractAddressEnv: "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
  parse: () => ({}),
  buildCall: () => ({ to: sessionScope.contractAddress, abi: [tapFunction], functionName: "tap" }),
  rateLimit: { perMinute: 30 },
});
```

The action route answers 409 `SESSION_NONE` only when no signer is attached. That is the single "no session" signal. Any other failure (policy denial, revert, nonce race) is a failed transaction, not proof the session is gone. The optional `rateLimit` is per user and in memory per server instance. A lower-level signer is `privySessionSigner({ privy, walletId, address })` from the same entry.

```tsx
// browser
"use client";
import { useEmbeddedWallet, WalletGate } from "@pepu-chain/sdk/privy/react";
import { useSessionAct, useSessionGrant, useSessionRevoke, useSessionStatus } from "@pepu-chain/sdk/session/react";

function Game() {
  const { address } = useEmbeddedWallet();
  const { state, secondsLeft } = useSessionStatus({ address });
  const { grant, status: grantStatus } = useSessionGrant({ address });
  const { revoke } = useSessionRevoke({ address });
  const { act } = useSessionAct<Record<string, never>, { hash: string }>({ endpoint: "/api/game/tap" });
  // state is "none" | "active" | "expired"
  if (state !== "active") return <button onClick={grant} disabled={grantStatus === "creating-policy"}>Start session</button>;
  return (
    <>
      <button onClick={() => act({})}>Tap ({secondsLeft}s left)</button>
      <button onClick={revoke}>Revoke</button>
    </>
  );
}
```

Hooks authenticate with `usePepuAuthFetch` by default. `describeSessionScope` gives you the consent screen rows (contract, function signature, selector, zero value, expiry).

### Dashboard

An authorization key and a key quorum. See [Authorization Keys and Key Quorums](../privy/authorization-keys.md). Smart Wallets are not needed.

### Tools and template

| Need | Tool |
|---|---|
| Build and preview the scoped policy | `pepu_session_policy` with `mode: "privy"` |
| Generate the authorization key without printing it | `pepu_generate_authorization_key` |
| Canonical routes and hooks | `pepu_sdk_snippet` with `session-routes`, `session-action-route`, `grant-session` |
| Check keys and dashboard | `pepu_check_env` with template `game-app`, `pepu_check_privy_config` with `pillars: ["session"]` |
| Slash command and skill | `/pepu-add-session`, skill `pepu-session-keys` |

Template: `game-app`. See [Game App](../templates/game-app.md).

## Mode B: Kernel on-chain session keys

### How it works

The user's Kernel v3.1 smart account (owned by the embedded wallet) installs a permission: a call policy (targets, function selectors, value limit) plus a timestamp policy (validity window). Your server holds a session key that signs UserOperations within that permission. The five steps:

1. **prepare.** The server generates a fresh session key (`generateSessionKey`), decides the expiry, computes the expected permission id, and stores the record. The response carries only the session key's address, the expiry and the scope. The private key stays on the server.
2. **Owner signs once.** The browser rebuilds the same policies from the scope and the server's expiry, and the embedded wallet signs ONE EIP-712 message (`approveKernelSession`). That signature is the whole grant. It costs no gas.
3. **activate.** The server checks the approval is for this user's smart account and for exactly the key, scope and expiry it issued (permission id match), then stores it.
4. **act.** The server loads the session account (`loadKernelSessionAccount`), signs one UserOperation with the session key and sends it through the bundler and paymaster. The first action also deploys the account and enables the permission on-chain, so it costs more.
5. **revoke.** The server deletes the key and approval immediately.

### Trust model

- The chain enforces the scope. The call policy v0.0.4 (`0x9a52283276A0ec8740DF50bF01B28A80D880eaf2`) allows only the listed targets and selectors with value at most `valueLimit`; the timestamp policy (`0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F`) rejects the permission outside its window. An operation outside the scope fails EntryPoint validation, whoever relays it. Call policy v0.0.5 is not deployed on PEPU, so the version is pinned.
- The owner key never leaves Privy and the browser. The session key is held by your server. A compromised server or leaked session key can do only what the permission allows until it expires.
- The approval holds no secret. It is the enable signature plus policy parameters and is useless without the session key.
- Revoke deletes the server-side key at once, but does not uninstall the permission on-chain. Uninstalling is an owner-signed call to the user's own account, which a destination-allowlisted paymaster should not sponsor. The grant stays valid until its expiry, usable only by the deleted key and only within scope. Keep sessions short.
- Sponsorship is a separate trust relationship: the paymaster operator decides what to pay for, within its caps.
- The default `createMemoryStore()` is dev-grade. See [Trust and Security Model](../concepts/trust-and-security.md) for what production needs.

Show `SESSION_TRUST_NOTICE["kernel-onchain"]` on the consent screen.

### SDK code

```ts
// lib/scope.ts
import { getContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";
import type { KernelSessionCall } from "@pepu-chain/sdk/session/kernel";
import { tapScoreAbi } from "./tapscore"; // your ABI

const entry = getContract(pepuMainnet.id, "tapScore");
if (!isDeployed(entry)) throw new Error("TapScore is not deployed in the SDK registry.");
export const TAPSCORE_ADDRESS = entry.address;

export const scope: { calls: readonly KernelSessionCall[] } = {
  calls: [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
};
```

```ts
// lib/session-routes.ts (server)
import { createMemoryStore, createSponsoredSessionRoutes } from "@pepu-chain/sdk/combo";
import { scope, TAPSCORE_ADDRESS } from "./scope";
import { tapScoreAbi } from "./tapscore";

export const routes = createSponsoredSessionRoutes({
  scope,
  store: createMemoryStore(), // DEV ONLY
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  },
});
// app/api/session/prepare/route.ts: export const { POST } = routes.prepare;
// likewise activate (POST), status (GET), act (POST), revoke (POST)
```

```tsx
// browser
"use client";
import { useSponsoredSession, type SponsoredActResult } from "@pepu-chain/sdk/combo/react";
import { scope } from "@/lib/scope";

const session = useSponsoredSession<undefined, SponsoredActResult>({ scope });
// session.phase: "signed-out" | "provisioning" | "ready" | "granting" | "active" | "expired" | "error"
```

The building blocks, for custom flows, are in `@pepu-chain/sdk/session/kernel`: `buildKernelSessionPolicies`, `generateSessionKey`, `expectedPermissionId`, `approveKernelSession`, `loadKernelSessionAccount`, `describeKernelSessionScope`, `isCallInScope`, `checkApproval`. Each `KernelSessionCall` takes `target`, `abi`, `functionName` and an optional `valueLimit`. Argument rules and ZeroDev's rate-limit policy are not wrapped. Keep the policy as narrow as the action allows. The full flow with failure modes is on [Google Login, Session and Sponsorship End to End](google-session-sponsored.md).

### Tools and template

| Need | Tool |
|---|---|
| Build and preview on-chain policies | `pepu_session_policy` with `mode: "kernel"` |
| Canonical code | `pepu_sdk_snippet` with `kernel-session-policy`, `sponsored-session`, `sponsored-session-client` |
| Slash command and skill | `/pepu-add-sponsored-session`, skill `pepu-sponsored-session` |

Template: `sponsored-session-app`. See [Sponsored Session App](../templates/sponsored-session-app.md).

## What to expect

- Privy mode: the first grant shows Privy's consent step once; every tap after that is silent. A tap costs the user a fraction of a cent.
- Kernel mode: one signature prompt (`eth_signTypedData_v4` on chain 97741), then silent actions. Gas reservation per sponsored operation is large: about 20.5 PEPU worst case for a session's first operation and about 6.9 PEPU for later ones (`SESSION_GAS_RESERVATION_PEPU`). Size per-user spend caps above that, or users hit `trailing-hour spend ... would exceed cap` after their first action.

## Common failures

| Symptom | Mode | Cause | Fix |
|---|---|---|---|
| 401 "No valid authorization keys or user signing keys available" (`PRIVY_KEY_QUORUM_MISMATCH`) | Privy | `PRIVY_AUTHORIZATION_KEY` is not the private half of the quorum in `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`, or the user granted a different quorum | Align the pair; users must re-grant after a rotation |
| `POLICY_NAME_TOO_LONG` | Privy | A custom policy `name` of 50 or more characters | Keep names at most 49 |
| Every signed request denied | Privy | Method not `eth_signTransaction`, `to`, function or value mismatch, or past expiry | Check the scope; grant again |
| "Duplicate signer" from `addSigners` | Privy | A signer is already attached | The grant route's `alreadyGranted: true` means skip `addSigners`; `useSessionGrant` handles it |
| "Unsupported chain with id 97741" | Privy | Something calls Privy's server-side `eth_sendTransaction` | Use `createSessionActionRoute` or `privySessionSigner` |
| 409 `SESSION_NONE` | Both | No signer attached (Privy) or no live approved session (Kernel) | Grant again |
| 410 `SESSION_EXPIRED` | Kernel | The offered session expired before activation | Call prepare again |
| 400 `SESSION_APPROVAL_MISMATCH` | Kernel | The browser's scope differs from the server's, or the approval is for another account | Import one shared `scope` on both sides |
| 403 `POLICY_UNSCOPED` | Both | A call targets a contract, function or value outside the scope | Fix the call or widen the scope deliberately |
| 429 "An action is already in flight" | Kernel | Another act for this user is running | Wait and retry |
| `trailing-hour spend ... would exceed cap` | Kernel | Paymaster per-user caps are below the gas reservation | Raise caps above 20.5 PEPU for the first operation |
| Sessions vanish after a server restart | Kernel | `createMemoryStore()` is in memory only | Implement `SessionStore` on a persistent store; encrypt the key |

## Related

- [Authorization Keys and Key Quorums](../privy/authorization-keys.md)
- [Sponsored Session](sponsored-session.md)
- [Google Login, Session and Sponsorship End to End](google-session-sponsored.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
- [/session](../sdk/session.md), [/session/kernel](../sdk/session-kernel.md), [/combo](../sdk/combo.md)
- [Recipes: Grant a Session](../recipes/grant-a-session.md)
- [Smart Accounts](smart-accounts.md)
