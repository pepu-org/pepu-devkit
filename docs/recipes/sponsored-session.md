# Recipe: Sponsored Session in One Flow

Google sign-in, one owner signature that grants an on-chain session, then actions with no popup and no gas for the user. This is the combination of all three pillars, and `@pepu-chain/sdk/combo` is the whole backend plus the hook.

An on-chain Kernel session key plus sponsorship runs end to end in the `sponsored-session-app` template. The hosted bundler (the SDK default) and paymaster are available; set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<project server key>`. You need your own claimed and funded project.

## Prerequisites

- A Privy app with Google login enabled and your origin allowed. See [Privy Setup Walkthrough](../onboarding/privy-setup.md). Smart Wallets are not needed: the SDK builds its own Kernel account.
- `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PEPU_PAYMASTER_URL` (and optionally `PEPU_BUNDLER_URL`, which defaults to `https://bundler.pepeunchained.com`). Treat `PEPU_PAYMASTER_URL` as a secret: it embeds your project's server key. The routes forward the signed-in user's Privy token as ERC-7677 context (`forwardPrivyToken`, default true; set it false for a paymaster you do not trust with it); a project ignores it for billing.
- The wallet provisioning pieces from [Provision the Wallet and Pin the Active Account](provision-and-pin-the-wallet.md).
- The target contract on the paymaster's allowlist.
- Peers: `@privy-io/node`, `@privy-io/react-auth`, and the three `@zerodev/*` packages.

## Steps

### 1. Server: five routes

```ts
// The combination, server: Google login + on-chain session key + sponsored gas.
// SERVER ONLY. See docs/sdk/combo.md and docs/recipes/sponsored-session.md
// Needs PRIVY_APP_SECRET and PEPU_PAYMASTER_URL (https://paymaster.pepeunchained.com/v2/paymaster/<project server key>).
// PEPU_BUNDLER_URL defaults to https://bundler.pepeunchained.com.
import { createMemoryStore, createSponsoredSessionRoutes } from "@pepu-chain/sdk/combo";
import type { SessionStore } from "@pepu-chain/sdk/combo";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

// DEV ONLY. The store holds session private keys: production needs a persistent
// SessionStore with sessionPrivateKey encrypted at rest.
const store: SessionStore = createMemoryStore();

export const routes = createSponsoredSessionRoutes({
  scope: { calls: [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }] },
  store,
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
  },
});

// app/api/session/prepare/route.ts   export const { POST } = routes.prepare;
// app/api/session/activate/route.ts  export const { POST } = routes.activate;
// app/api/session/status/route.ts    export const { GET } = routes.status;
// app/api/session/act/route.ts       export const { POST } = routes.act;
// app/api/session/revoke/route.ts    export const { POST } = routes.revoke;
export const { prepare, activate, status, act, revoke } = routes;
```

Source: `docs/snippets/combo-server.ts`, type-checked against the SDK.

Mount `prepare`, `activate`, `status`, `act` and `revoke` at `app/api/session/<name>/route.ts`, the paths the hook expects by default.

### 2. Client: one hook

```tsx
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
```

Source: `docs/snippets/combo-react.tsx`, type-checked against the SDK.

The browser rebuilds the policies from the same `scope` the server uses. If they differ, the server rejects the approval with `SESSION_APPROVAL_MISMATCH`, so share one `scope` module between both sides.

## What to expect

- The user signs once (an EIP-712 message, no gas). Every `act` after that has no popup and costs the user nothing.
- The scope is enforced on-chain: only the listed contract and function selectors, with zero native value, between the grant and its expiry. A call outside it is rejected by the EntryPoint no matter what your backend does.
- `revoke` deletes the key on the server at once. The on-chain grant stays valid until its expiry, but only the deleted key could use it.
- Reserve for gas: about 20.5 PEPU for the first action of a session and 6.9 PEPU after (`SESSION_GAS_RESERVATION_PEPU`). Size spend caps above it.
- `createMemoryStore` is for development. It holds the session private key in process memory. Production needs a `SessionStore` on a database with the key encrypted at rest.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `phase` stuck on `provisioning` | The user has no embedded wallet yet | Wrap the app in `WalletGate` |
| `SESSION_APPROVAL_MISMATCH` | Browser and server scopes differ | Share the scope |
| `SESSION_NONE` on act | No live session, or the server restarted with an in-memory store | Grant again; use a persistent store |
| `PAYMASTER_CAP` after the first action | Caps below the reservation | Raise per-user caps |
| `PAYMASTER_DESTINATION_NOT_ALLOWED` | The contract is not allowlisted | Add it to the project targets |
| 429 on act | Another action is running for that user | Wait and retry |

## Related

- [Sponsored Session: No Popup, No Gas](../onboarding/sponsored-session.md)
- [Google Login, Session and Sponsorship End to End](../onboarding/google-session-sponsored.md)
- [/combo](../sdk/combo.md)
- [Sponsored Session App template](../templates/sponsored-session-app.md)
