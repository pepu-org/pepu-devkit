# /session

`@pepu-chain/sdk/session` is the session-key layer in **Privy mode**: the user grants your app a scoped, time-bound Privy session signer once, and your server then signs for them with no popup per action. This page covers three entries that belong together: `/session` (pure, shared), `/session/server` (routes and signer) and `/session/react` (hooks). The on-chain alternative is [/session/kernel](session-kernel.md).

> Status: proven on mainnet (Privy session signers, `game-app` template). The scope is enforced by Privy's backend policy engine, **not on-chain**, and the user still pays gas. For an on-chain limit and no user gas, use [/combo](combo.md).

## Import, peers and boundary

| Entry | Server or client | Peer dependencies |
|---|---|---|
| `@pepu-chain/sdk/session` | Client-safe, pure | `viem` |
| `@pepu-chain/sdk/session/server` | **Server only** (`CONFIG_SERVER_ONLY` in a browser) | `@privy-io/node` |
| `@pepu-chain/sdk/session/react` | Client only | `react`, `@privy-io/react-auth` |
| `@pepu-chain/sdk/server` | **Server only**. Stable alias that re-exports the pure policy helpers from `/session` | `viem` |

Secrets read by `/session/server`: `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, and `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`. The authorization key never reaches the browser and is never logged or put in an error.

## How the pieces fit

1. The browser calls `grant` (`useSessionGrant`). The server builds a fresh scoped policy with `buildSessionPolicy` and returns its id.
2. The browser asks the user to approve with Privy's `addSigners`. One consent, no gas.
3. Each action calls your action route (`useSessionAct`). The server re-checks the call against the scope, signs with `eth_signTransaction` and **broadcasts the raw transaction itself**, because Privy's server-side `eth_sendTransaction` rejects chain 97741.
4. `revoke` removes the signer (`removeSigners` in the browser is the real revoke) and the server deletes the policy.

## Pure exports (`/session`)

| Export | Signature | What it abstracts |
|---|---|---|
| `buildSessionPolicy` | `(p: { contractAddress: Address; functions: readonly AbiFunction[]; expiresAtUnixSeconds: number; name?: string }) => SessionPolicy` | One `ALLOW` rule per function pinning contract, function, zero value and expiry, on `eth_signTransaction`. Throws `POLICY_UNSCOPED` instead of building an unscoped policy |
| `describeSessionScope` | `(p: { contractAddress; functions; expiresAtUnixSeconds }) => SessionScope` | Consent-screen data: contract, each function's name, signature and selector, value `"0"`, expiry |
| `signAndBroadcast` | `(params: SignAndBroadcastParams) => Promise<Hash>` | Resolves pending nonce, gas (+20 percent) and gas price against PEPU's RPC, builds the legacy transaction, hands it to your `sign` callback, broadcasts, returns the hash |
| `broadcastSignedTransaction` | `(client: BroadcastClient, signed: SignedTransactionLike) => Promise<Hash>` | Broadcast a raw signed transaction (hex or `{ signed_transaction }`) |
| `withGasLimitBuffer` | `(estimatedGas: bigint) => bigint` | Estimate plus 20 percent |
| `resolveSessionMinutes` | `(raw: string \| number \| null \| undefined) => number` | Session length rule: default 15, clamped to 1..1440 (`DEFAULT_SESSION_MINUTES`, `MAX_SESSION_MINUTES`) |
| `sessionExpiry` | `(nowSeconds: number, minutes: number) => number` | Unix-seconds expiry |
| `assertWithinPolicyNameLimit`, `PRIVY_POLICY_NAME_MAX_LENGTH` | `(value, field) => string`, `49` | Privy rejects names of 50 or more characters; the real limit is 49 |
| `SESSION_TRUST_NOTICE` | `Record<"privy-offchain" \| "kernel-onchain", string>` | The mandatory honest statement of who enforces the limits. Show the one for your mode on the consent screen |
| `describeKernelSessionScope`, `isCallInScope`, `parseApproval`, `checkApproval` | pure Kernel helpers | Re-exported so you can avoid the `@zerodev/*` peers. See [/session/kernel](session-kernel.md) |

## Server exports (`/session/server`)

| Export | Signature | What it abstracts |
|---|---|---|
| `createSessionRoutes` | `(o: { scope: LazySessionScopeInput; contractAddressEnv?; minutes?; keyQuorumId?; privy?; verifyUser? }) => { grant: { POST }, status: { GET }, revoke: { POST } }` | The three route handlers. `grant` answers `{ alreadyGranted, policyId, expiresAt, signerId, durationMinutes }`. When a signer is already attached it answers `{ alreadyGranted: true }` and the client must not call `addSigners` again (Privy fails with "Duplicate signer"). `status` answers `{ delegated, active, address }` |
| `createSessionActionRoute` | `<I>(o: { scope; contractAddressEnv?; parse(body): I; buildCall(i, ctx): SessionCall; rateLimit?: { perMinute }; authorizationKey?; client?; ... }) => { POST }` | The action route. 409 `SESSION_NONE` is the only "no session" signal. It answers `{ hash, address, explorerUrl }` |
| `privySessionSigner` | `(o: { privy; walletId; address; authorizationKey?; client? }) => { signTransaction(tx), signAndBroadcast(p) }` | A signer for a session wallet that signs with `eth_signTransaction` and broadcasts itself |
| `signAndBroadcast`, `broadcastSignedTransaction`, `withGasLimitBuffer` | as above | Re-exported |
| Types | `SessionScopeInput`, `LazySessionScopeInput`, `VerifyUser`, `SessionPrivyClient`, `CreateSessionRoutesOptions`, `PrivySessionSignerOptions`, `SessionCall`, `CreateSessionActionRouteOptions` | |

An empty or `undefined` `scope.contractAddress` (an unset env variable) does not throw at module load: every route answers `CONFIG_MISSING_ENV` as JSON at request time, naming `contractAddressEnv`. A non-empty malformed address still throws at creation. Auth defaults to `verifyRequestUser` from [/privy/server](privy-server.md); pass `verifyUser` for your own.

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

## React exports (`/session/react`)

| Export | Signature | Notes |
|---|---|---|
| `useSessionGrant` | `(o?: BaseOptions & { grantEndpoint? }) => { grant(), status: SessionGrantStatus, error?: PepuError }` | POST the grant route, then ask for consent with `addSigners`. Skips `addSigners` when `alreadyGranted`. `status`: `idle`, `creating-policy`, `awaiting-consent`, `granted`, `error` |
| `useSessionStatus` | `(o?: BaseOptions & { statusEndpoint?, pollMs? }) => { state, loading, expiresAt?, secondsLeft?, refetch() }` | `state` is `none`, `active` or `expired`. `loading` is true until the first response, so the consent screen does not flash on reload |
| `useSessionRevoke` | `(o?: BaseOptions & { revokeEndpoint? }) => { revoke(), status, error? }` | `removeSigners` is the real revoke |
| `useSessionAct` | `<I, O>(o: BaseOptions & { endpoint }) => { act(input): Promise<O>, status, error? }` | A 409 is `error.code === "SESSION_NONE"`. Any other failure is a failed transaction, not a lost session |
| `deriveSessionState` | `(p: { delegated; expiresAt?; nowSeconds }) => { state, secondsLeft? }` | Pure |
| `errorFromResponse` | `(res: Response) => Promise<PepuError>` | Reads the `{ error: { code, message, hint } }` body |

`BaseOptions` is `{ authFetch?, address? }`; auth defaults to `usePepuAuthFetch()` from [/privy/react](privy-react.md). Privy does not expose a policy's expiry, so the client tracks `expiresAt` from the grant.

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

## Errors

| Code | Where |
|---|---|
| `POLICY_UNSCOPED` | `buildSessionPolicy`, `describeSessionScope`, and the action route when a call is outside the scope (invalid address, no functions, non-function ABI item, bad expiry) |
| `POLICY_NAME_TOO_LONG` | A policy or rule name over 49 characters |
| `SESSION_NONE` | The action route (HTTP 409) with no signer attached; the hooks surface it |
| `AUTH_INVALID_TOKEN` | The route cannot authenticate the request |
| `CONFIG_MISSING_ENV` | Unset contract address or Privy variable, at request time |
| `CONFIG_SERVER_ONLY` | `/session/server` or `/server` imported in a browser bundle |
| `PRIVY_KEY_QUORUM_MISMATCH` | Privy 401 "No valid authorization keys": the server key is not the signer the user granted |
| `PRIVY_CHAIN_REJECTED_97741` | Someone used Privy's server-side `eth_sendTransaction`. Sign and broadcast instead |
| `TX_NONCE_RACE`, `TX_GAS_UNDERSHOOT`, `TX_REVERTED` | Broadcast failures. A failed transaction, not proof the session is gone |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Every action is denied | The policy rule targets `eth_sendTransaction` | Rules must use `eth_signTransaction`; `buildSessionPolicy` does |
| "Duplicate signer" | `addSigners` called when `alreadyGranted` was true | Use `useSessionGrant`, which skips it |
| Policy create returns 400 on name length | Name of 50 or more characters | Keep names at 49 or fewer |
| 401 "No valid authorization keys" | Key quorum mismatch | `PRIVY_AUTHORIZATION_KEY` must be the private half of the key whose quorum id is `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` |
| Two quick taps race | Nonce collision on the same wallet | Use `rateLimit`, serialize per wallet |

## Related

- [Session Keys: No Popup Per Transaction](../onboarding/session-keys.md)
- [Grant a Session](../recipes/grant-a-session.md)
- [Authorization Keys and Key Quorums](../privy/authorization-keys.md)
- [/session/kernel](session-kernel.md), [/combo](combo.md)
