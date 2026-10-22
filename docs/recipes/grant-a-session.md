# Recipe: Grant a Session

Grant your app a scoped session so it can act for a signed-in user with no popup per action. Two modes exist: Privy mode (this page, in full) and Kernel mode (on-chain scope, see the end of the page and [Sponsored Session in One Flow](sponsored-session.md)).

Privy mode: the scope is enforced by Privy's policy engine, off-chain, and the user pays gas. Kernel mode: the scope is enforced on-chain and, with the paymaster, the user pays no gas.

## Prerequisites

- Google to wallet working (see [Provision the Wallet and Pin the Active Account](provision-and-pin-the-wallet.md)).
- A Privy authorization key and key quorum, with `PRIVY_AUTHORIZATION_KEY` and `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` set. See [Authorization Keys and Key Quorums](../privy/authorization-keys.md). Generate the key with `generatePrivyAuthorizationKey` from [/doctor](../sdk/doctor.md).
- The one contract and function the session may call. This recipe uses TapScore's `tap()`.

## Steps

### 1. Server: mount the routes

`createSessionRoutes` gives you `grant`, `status` and `revoke`. `createSessionActionRoute` is the one action the session may perform. The action route signs with Privy `eth_signTransaction` and broadcasts the raw transaction itself, because Privy's server-side `eth_sendTransaction` rejects chain 97741.

```ts
// Pillar 2 (Privy mode), server: grant, status, revoke and one scoped action.
// SERVER ONLY (reads PRIVY_APP_SECRET and PRIVY_AUTHORIZATION_KEY).
// See docs/sdk/session.md and docs/recipes/grant-a-session.md
import { createSessionActionRoute, createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { TAPSCORE_ADDRESS, tapFunction } from "./tapscore";

const scope = { contractAddress: TAPSCORE_ADDRESS, functions: [tapFunction] } as const;

const routes = createSessionRoutes({ scope });

// app/api/session/grant/route.ts
export const grant = routes.grant;
// app/api/session/status/route.ts
export const status = routes.status;
// app/api/session/revoke/route.ts
export const revoke = routes.revoke;

// app/api/game/tap/route.ts: signs with Privy eth_signTransaction and broadcasts itself,
// because Privy's server-side eth_sendTransaction rejects chain 97741.
export const tap = createSessionActionRoute({
  scope,
  parse: () => ({}),
  buildCall: () => ({ to: TAPSCORE_ADDRESS, abi: [tapFunction], functionName: "tap" }),
  rateLimit: { perMinute: 60 },
});
```

Source: `docs/snippets/session-privy-server.ts`, type-checked against the SDK.

Put each handler in its own route file (`app/api/session/grant/route.ts` exports `const { POST } = routes.grant`, and so on).

### 2. Client: grant, act, revoke

```tsx
// Pillar 2 (Privy mode), client: grant once, then act with no popup.
// See docs/sdk/session.md and docs/recipes/grant-a-session.md
import { useSessionAct, useSessionGrant, useSessionRevoke, useSessionStatus } from "@pepu-chain/sdk/session/react";

export function Session() {
  const { state, secondsLeft, loading } = useSessionStatus({ pollMs: 30_000 });
  const { grant, status: grantStatus, error: grantError } = useSessionGrant();
  const { revoke } = useSessionRevoke();
  const { act, status: actStatus, error: actError } = useSessionAct<Record<string, never>, { hash: string }>({
    endpoint: "/api/game/tap",
  });

  // Avoid flashing the consent screen on reload.
  if (loading) return <p>Checking session</p>;

  if (state !== "active") {
    return (
      <button onClick={() => void grant()} disabled={grantStatus === "creating-policy" || grantStatus === "awaiting-consent"}>
        {state === "expired" ? "Session expired, start a new one" : "Start session"}
        {grantError ? ` (${grantError.code})` : ""}
      </button>
    );
  }

  return (
    <div>
      <p>{secondsLeft}s left</p>
      <button onClick={() => void act({}).then((r) => console.log(r.hash))} disabled={actStatus === "pending"}>
        Tap
      </button>
      <button onClick={() => void revoke()}>End session</button>
      {actError ? <p>{actError.code === "SESSION_NONE" ? "No active session" : actError.message}</p> : null}
    </div>
  );
}
```

Source: `docs/snippets/session-privy-react.tsx`, type-checked against the SDK.

`useSessionGrant` asks the server for a fresh scoped policy, then asks the user to approve it with Privy's `addSigners`. Show the user what they approve with `describeSessionScope` and `SESSION_TRUST_NOTICE["privy-offchain"]`.

## What to expect

- One consent for the whole session, then each `act` returns `{ hash, address, explorerUrl }` with no popup.
- The session length defaults to 15 minutes (`SESSION_DURATION_MINUTES`, clamped 1 to 1440).
- The user still pays gas from their embedded wallet. Privy mode does not sponsor gas.
- Privy mode limits are enforced by Privy's backend, not on-chain. Say so on the consent screen.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Every action returns an error right after grant | The policy was built for `eth_sendTransaction` | Use `buildSessionPolicy`, which targets `eth_signTransaction` |
| `SESSION_NONE` (HTTP 409) | No signer attached | Send the user to the grant button. Any other failure is a failed transaction, not a lost session |
| 401 "No valid authorization keys" | The server key is not the key whose quorum the user granted | Match `PRIVY_AUTHORIZATION_KEY` to `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` |
| `CONFIG_MISSING_ENV` as JSON from every route | The contract address variable is unset | Set it. Routes answer at request time naming the variable |
| "Duplicate signer" | `addSigners` called twice | Use the hook; it skips `addSigners` on `alreadyGranted` |

## Kernel mode: on-chain scope

When the limit must hold even if your backend is compromised, and you want no gas for the user, use the on-chain session from [/session/kernel](../sdk/session-kernel.md), wired up by [/combo](../sdk/combo.md). The owner signs one EIP-712 message with no gas, and ZeroDev's call and timestamp policies enforce the scope during UserOperation validation. The primitives:

```ts
// Pillar 2 (Kernel mode), the low-level primitives behind /combo.
// Most apps use createSponsoredSessionRoutes instead (see combo-server.ts).
// See docs/sdk/session-kernel.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import {
  approveKernelSession,
  buildKernelSessionPolicies,
  checkApproval,
  describeKernelSessionScope,
  expectedPermissionId,
  generateSessionKey,
  isCallInScope,
  loadKernelSessionAccount,
} from "@pepu-chain/sdk/session/kernel";
import type { KernelOwner, KernelSessionCall } from "@pepu-chain/sdk/session/kernel";
import { encodeFunctionData } from "viem";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

const publicClient = getPublicClient(pepuMainnet);

const calls: KernelSessionCall[] = [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }];
const validUntil = Math.floor(Date.now() / 1000) + 15 * 60;

// --- SERVER: create the session key. The private key never leaves the server. ---
export const sessionKey = generateSessionKey();
export const policies = buildKernelSessionPolicies({ calls, validUntil });

// Consent-screen data, plain JSON.
export const scope = describeKernelSessionScope({ calls, validUntil });

// --- BROWSER: the owner signs ONE EIP-712 message. No gas, no private key leaves the wallet. ---
export function grant(owner: KernelOwner) {
  return approveKernelSession({ publicClient, owner, sessionKeyAddress: sessionKey.address, policies });
}

// --- SERVER: verify the approval before storing it, then act with the session key. ---
export async function activate(approval: string, kernelAddress: `0x${string}`) {
  const permissionId = await expectedPermissionId({ publicClient, sessionKeyAddress: sessionKey.address, policies });
  const check = checkApproval(approval, { kernelAddress, permissionId });
  if (!check.ok) throw new Error(check.reason);
  return loadKernelSessionAccount({ publicClient, approval, sessionPrivateKey: sessionKey.privateKey });
}

// Pure, fails fast before sponsoring. The chain enforces the real limit.
export const tapIsAllowed = isCallInScope(scope, {
  to: TAPSCORE_ADDRESS,
  data: encodeFunctionData({ abi: tapScoreAbi, functionName: "tap" }),
  value: 0n,
});
```

Source: `docs/snippets/session-kernel.ts`, type-checked against the SDK.

## Related

- [Session Keys: No Popup Per Transaction](../onboarding/session-keys.md)
- [/session](../sdk/session.md), [/session/kernel](../sdk/session-kernel.md)
- [Sign with Privy, Broadcast Yourself](sign-with-privy-broadcast-yourself.md)
- [Sponsored Session in One Flow](sponsored-session.md)
