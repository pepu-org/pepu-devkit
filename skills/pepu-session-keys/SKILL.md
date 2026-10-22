---
name: pepu-session-keys
description: Privy session signers on a plain embedded EOA for Pepe Unchained (PEPU) V2 mainnet (chain 97741), so a game or app acts for a signed-in user with no wallet popup per action. Built from @pepu-chain/sdk: createSessionRoutes, createSessionActionRoute, privySessionSigner, useSessionGrant, useSessionStatus, useSessionAct, useSessionRevoke, buildSessionPolicy, generatePrivyAuthorizationKey. Complete code, Privy dashboard fields for the authorization key and key quorum, the three safety rules, denial troubleshooting. The scope is enforced off-chain by Privy and the user pays gas. For on-chain enforced sessions with no gas, see pepu-sponsored-session. Use for "no popup per transaction", repeated actions, background signing.
---

# Privy session keys on PEPU (off-chain scope, user pays gas)

Pillar 2. After the user grants a session once, your server submits scoped transactions from their embedded wallet with no popup.
It runs on the plain embedded EOA from `pepu-onboarding-privy`: no EntryPoint, bundler or paymaster.

## When to use

- A game, a recurring action, or a flow where a wallet popup per click kills the UX, and a **Privy-enforced** scope is acceptable.
- Pick the other mode when you need the limits enforced on-chain, or the user must not pay gas: that is `pepu-sponsored-session` (Kernel session plus paymaster).

| | Privy mode (this skill) | Kernel mode (`pepu-sponsored-session`) |
|---|---|---|
| Account | the user's embedded EOA | a Kernel smart account owned by the EOA |
| Scope enforced by | Privy's backend policy engine (off-chain) | the account's on-chain call and timestamp policies |
| Gas | the user's wallet pays | a paymaster can pay (needs bundler and paymaster) |
| Needs | Privy authorization key and key quorum | bundler and paymaster URLs |

## Chain facts

Chain 97741, mainnet only. See [reference/chain-facts.md](reference/chain-facts.md) (generated from the SDK) and
[reference/rules.md](reference/rules.md). Privy's server-side `eth_sendTransaction` rejects chain 97741; the SDK signs with
`eth_signTransaction` and broadcasts through the PEPU RPC itself.

## SDK functions to use

```ts
// server
import { createSessionRoutes, createSessionActionRoute, privySessionSigner } from "@pepu-chain/sdk/session/server";
import { requireUser } from "@pepu-chain/sdk/privy/server";
// client
import { useSessionGrant, useSessionStatus, useSessionAct, useSessionRevoke } from "@pepu-chain/sdk/session/react";
// pure (both sides)
import { describeSessionScope, buildSessionPolicy, SESSION_TRUST_NOTICE } from "@pepu-chain/sdk/session";
// authorization key
import { generatePrivyAuthorizationKey } from "@pepu-chain/sdk/doctor";
```

Also needs everything from `pepu-onboarding-privy` (provider, ensure-wallet route). Peers: `@privy-io/react-auth`, `@privy-io/node`.

## MCP tools to call first

1. `pepu_session_policy` with `mode: "privy"`, `contract`, `functions` (for example `["tap()"]`), `minutes`: the policy JSON, a consent summary, selectors, the trust notice and a ready snippet.
2. `pepu_generate_authorization_key` with `envFile` (absolute path to `.env.local`) and `confirm_write: true`: writes the private half to the env file and returns **only the public key**.
3. `pepu_check_env` with `template: "game-app"` (this pillar's template) and `pepu_check_privy_config` with `pillars: ["session"]`.
4. `pepu_sdk_snippet` with `task: "session-routes"`, `"session-action-route"` or `"grant-session"`.

## Steps

### 1. Scaffold or add

New app: `pepu_scaffold_app` with `template: "game-app"` (or `npx create-pepu-app@latest my-game --template game-app --yes --json`). Existing app: first complete `pepu-onboarding-privy`.

### 2. Authorization key and key quorum (the user's only dashboard step)

1. Call `pepu_generate_authorization_key`. It writes `PRIVY_AUTHORIZATION_KEY` (private, base64 PKCS8) to `.env.local` and returns the **public key**. Without MCP, run
   `node -e "import('@pepu-chain/sdk/doctor').then(async m => { const k = await m.generatePrivyAuthorizationKey(); console.log(k.publicKey) })"` and write `k.privateKey` to `.env.local` yourself without echoing it.
2. Ask the user to register the public key: Privy dashboard, Controls (Wallet infrastructure), Authorization keys, **New key**, paste the public key, create a **key quorum** containing it. Copy the key quorum id.
3. Put the quorum id in `.env.local`: `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID=<id>` (an identifier, not a secret).

### 3. Environment

```
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=
NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID=
PRIVY_AUTHORIZATION_KEY=
NEXT_PUBLIC_GAME_CONTRACT_ADDRESS=
SESSION_DURATION_MINUTES=15
```

`PRIVY_AUTHORIZATION_KEY` is a production signing key: anyone holding it can request transactions for any wallet that granted a signer to this quorum, bounded only by the attached policy.
Never commit it; rotate it if exposed (rotating invalidates sessions granted under the old quorum). `SESSION_DURATION_MINUTES` is clamped to 1..1440.

### 4. The scope, in one file (`lib/scope.ts`)

```ts
import type { Abi, AbiFunction, Address } from "viem";

export const tapScoreAbi = [
  { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const satisfies Abi;

export const tapFunction: AbiFunction = tapScoreAbi[0];

export const gameContract = process.env.NEXT_PUBLIC_GAME_CONTRACT_ADDRESS as Address;

/** The ONE contract and the ONE function a session may call. Everything else is derived from this. */
export const sessionScope = { contractAddress: gameContract, functions: [tapFunction] } as const;
```

Keep gameplay functions `nonpayable`: the policy requires zero value, so a payable function can never be called by a session.

### 5. Routes (server)

```ts
// lib/session-routes.ts
import { createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { sessionScope } from "./scope";

export const routes = createSessionRoutes({ scope: sessionScope });
```

```ts
// app/api/session/grant/route.ts    creates a scoped, time-bound Privy policy and returns its id
import { routes } from "@/lib/session-routes";
export const { POST } = routes.grant;
```

```ts
// app/api/session/status/route.ts   { delegated, active, address }
import { routes } from "@/lib/session-routes";
export const { GET } = routes.status;
```

```ts
// app/api/session/revoke/route.ts   cleanup after the client's removeSigners
import { routes } from "@/lib/session-routes";
export const { POST } = routes.revoke;
```

```ts
// app/api/game/tap/route.ts         the action: Privy signs, the SDK broadcasts
import { createSessionActionRoute } from "@pepu-chain/sdk/session/server";
import { sessionScope, gameContract, tapFunction } from "@/lib/scope";

export const { POST } = createSessionActionRoute({
  scope: sessionScope,
  parse: () => ({}),
  buildCall: () => ({ to: gameContract, abi: [tapFunction], functionName: "tap" }),
  rateLimit: { perMinute: 60 },
});
```

The factories verify the Privy token, refuse an unscoped scope at startup, re-check every call against the scope before signing, and return `409 SESSION_NONE` only when no signer is attached.
For custom flows build on `privySessionSigner({ privy, walletId, address }).signAndBroadcast({ to, abi, functionName })` and `requireUser`.

### 6. Consent, act and revoke (client)

```tsx
"use client";
import { SESSION_TRUST_NOTICE, describeSessionScope } from "@pepu-chain/sdk/session";
import { useSessionGrant, useSessionStatus, useSessionAct, useSessionRevoke } from "@pepu-chain/sdk/session/react";
import { sessionScope } from "@/lib/scope";

export function SessionPanel() {
  const { state, secondsLeft, refetch } = useSessionStatus({ pollMs: 30_000 });
  const { grant, status: grantStatus, error: grantError } = useSessionGrant();
  const { revoke } = useSessionRevoke();
  const { act, status, error } = useSessionAct<Record<string, never>, { hash: string }>({ endpoint: "/api/game/tap" });

  if (state !== "active") {
    const scope = describeSessionScope({ ...sessionScope, expiresAtUnixSeconds: Math.floor(Date.now() / 1000) });
    return (
      <section>
        <h2>Play without popups</h2>
        <p>Allows only: {scope.functions.map((f) => f.signature).join(", ")} on {scope.contractAddress}, value 0.</p>
        <p>{SESSION_TRUST_NOTICE["privy-offchain"]}</p>
        <p>Your wallet pays gas for every action. You can revoke at any time.</p>
        <button onClick={grant} disabled={grantStatus === "creating-policy" || grantStatus === "awaiting-consent"}>
          Start a session
        </button>
        {grantError && <p>{grantError.message} {grantError.hint}</p>}
      </section>
    );
  }

  return (
    <section>
      <button
        onClick={() => void act({}).then(refetch).catch(() => undefined)}
        disabled={status === "pending"}
      >
        Tap ({secondsLeft ?? "?"}s left)
      </button>
      <button onClick={() => void revoke().then(refetch)}>Revoke session</button>
      {error && error.code === "SESSION_NONE" ? <p>Session ended. Start a new one.</p> : error && <p>{error.message}</p>}
    </section>
  );
}
```

Show the consent copy and the revoke control always: the contract, function signature, zero value, expiry and who enforces it. Privy's own consent UI is not publicly specified, so the copy is your app's job.
`useSessionGrant` skips `addSigners` when the server says `alreadyGranted`; `useSessionRevoke` calls Privy's `removeSigners` (the real revoke) then the cleanup route.

## The three safety rules (never break these)

1. **A signer is always created with a scoped policy.** Privy policies are opt-in; an empty `policyIds` is unscoped over the whole wallet. `createSessionRoutes` builds the policy with `buildSessionPolicy`: exact contract, exact functions, value zero, expiry. Policy and rule names must be 49 characters or fewer (the factory enforces it).
2. **Say plainly that enforcement is off-chain.** Privy's backend enforces the scope when it receives each request. Show `SESSION_TRUST_NOTICE["privy-offchain"]`. For on-chain enforcement use Kernel mode (`pepu-sponsored-session`).
3. **Never call it free or sponsored.** The session removes the popup, not the gas: the user's wallet pays real PEPU gas per action. Cheap is accurate; "free" and "gasless" are not.

## Verify

1. `pepu_check_env` (template `game-app`): no `missing` or `placeholder`.
2. `pepu_check_privy_config` with `pillars: ["session"]`: allowed origin and authorization-key rows pass or say `unknown`.
3. `npm run typecheck && npm run build`.
4. Run it: sign in, grant once, tap with no popup, see the hash on pepuscan (`explorerLinks({ tx: hash }).tx`), revoke, tap again and get `SESSION_NONE`.
5. `pepu_explain_tx` with the hash shows who paid gas (the user's EOA).

## Pitfalls

- **Denied transaction:** work in order. (1) Policy mismatch: the method must be `eth_signTransaction` and `to`, function and zero value must match exactly. (2) Expired: the timestamp condition denies everything after expiry, grant again. (3) Policy name over 49 characters. (4) Key quorum mismatch: `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` must be the registered quorum and `PRIVY_AUTHORIZATION_KEY` the private half of that pair. Symptom `401 "No valid authorization keys or user signing keys available"` (`PRIVY_KEY_QUORUM_MISMATCH`).
- A denial or a broadcast failure (nonce race on a double tap) is a **failed transaction, not a lost session**. Only `409 SESSION_NONE` means no signer.
- `{ alreadyGranted: true }` from grant means do not call `addSigners` again (Privy fails with "Duplicate signer"); the hook handles it.
- Privy mode cannot show the remaining time after a reload in a new browser: the expiry is tracked client-side from the grant. `secondsLeft` is then `undefined`; revoking still works.
- `PRIVY_CHAIN_REJECTED_97741` or `Unsupported chain with id 97741`: something calls server-side `eth_sendTransaction`. Use the SDK routes.
- Use `pepu_explain_error` (SDK `explainError`) on any message.

## Never hand-roll

Do not write a Privy policy object, the grant, status or revoke routes, the sign-and-broadcast route, nonce and gas handling, an authorization key generator, or `addSigners` plumbing.
Use `createSessionRoutes`, `createSessionActionRoute`, `privySessionSigner`, the `useSession*` hooks and `generatePrivyAuthorizationKey`. See [reference/rules.md](reference/rules.md).

Reference app: `templates/game-app`. Production note: Privy mode's limits are Privy's promise; migrate to Kernel mode when you need on-chain enforcement.
