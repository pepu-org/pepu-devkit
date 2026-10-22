# /combo

`@pepu-chain/sdk/combo` is the combination of all three pillars: Google sign-in, one scoped on-chain session, then actions with no popup and no user gas. The server entry (`/combo`) gives you five route handlers; the browser entry (`/combo/react`) gives you one hook. This is the shortest path to the product experience PEPU is built for.

An on-chain Kernel session key plus sponsorship, end to end (the `sponsored-session-app` template). The bundler defaults to the hosted `https://bundler.pepeunchained.com`. The paymaster needs a project token: set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<project server key>` (a secret, server only) or pass `endpoints.paymasterToken`. You bring a project: claim, deposit, token.

`/combo` is Path 1 (ZeroDev-native): the SDK builds the Kernel account, so Privy Smart Wallets is not needed. [Smart Account Paths](../concepts/smart-account-paths.md) compares it with the other setups.

## Import, peers and boundary

| Entry | Server or client | Peer dependencies |
|---|---|---|
| `@pepu-chain/sdk/combo` | **Server only** (`CONFIG_SERVER_ONLY` in a browser) | `@privy-io/node`, `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator`, `viem` |
| `@pepu-chain/sdk/combo/react` | Client only | `react`, `@privy-io/react-auth`, the `@zerodev/*` peers |

Secrets read on the server: `PRIVY_APP_SECRET`, and the bundler and paymaster URLs (`PEPU_PAYMASTER_URL` can embed an app key, so treat it as a secret). The session private key is generated and held on the server and never reaches the browser. The browser's only signing job is the one owner signature that grants the session.

## The flow

1. `prepare`: the server creates a session key, decides the expiry, and returns only the key's address, the expiry and the scope.
2. The browser asks the owner (the Privy embedded wallet) for ONE EIP-712 signature. No gas.
3. `activate`: the server checks the approval is for this user's smart account and exactly the key, scope and expiry it issued, then stores it.
4. `act`: the server signs one sponsored UserOperation with the session key. The scope is enforced on-chain by the call and timestamp policies; the paymaster pays the gas.
5. `revoke`: deletes the key and approval from the server immediately. The on-chain grant lapses at its expiry, and only the deleted key could use it.

## Exports: `/combo`

| Export | Signature | What it abstracts |
|---|---|---|
| `createSponsoredSessionRoutes` | `<I>(o: SponsoredSessionRoutesOptions<I>) => SponsoredSessionRoutes` | The five handlers: `prepare.POST`, `activate.POST`, `status.GET`, `act.POST`, `revoke.POST` |
| `assertCallsInScope` | `(scope: Pick<KernelSessionScope, "calls">, calls: readonly Call[]) => void` | Throws `POLICY_UNSCOPED` (403) unless every call hits an allowed target, selector and value. Pure; used by `act` and exported for custom routes |
| `createMemoryStore`, `isLive`, `SessionStore`, `SessionRecord` | | Dev-grade store. See [/session/kernel](session-kernel.md) |
| `resolveSessionMinutes` | `(raw) => number` | Default 15, clamped 1..1440 |
| Types | `SponsoredSessionRoutesOptions`, `SponsoredSessionRoutes`, `ComboUser`, `ComboAuthenticate`, `SponsoredActResult`, `KernelSessionCall`, `KernelSessionScope` | |

`SponsoredSessionRoutesOptions<I>`:

| Field | Meaning |
|---|---|
| `scope` | `{ calls: readonly KernelSessionCall[]; targetEnv? }`. Enforced on-chain. An empty target (unset env variable) answers `CONFIG_MISSING_ENV` at request time, naming `targetEnv` |
| `store` | Where session records, including the private key, live. `createMemoryStore()` for development only |
| `act` | `{ parse(body): I; buildCalls(input, { kernelAddress, ownerAddress }): Call[] }`. Every call is re-checked against `scope` before sponsoring |
| `endpoints?` | `{ bundlerUrl?, paymasterUrl?, paymasterToken? }`. The bundler defaults to env, then the hosted bundler. The paymaster needs a complete ERC-7677 URL (`paymasterUrl` or `PEPU_PAYMASTER_URL`) or a project `paymasterToken`, built against the hosted paymaster base |
| `forwardPrivyToken?` | Default `true`: forwards the request's `Authorization: Bearer` Privy token to the paymaster as ERC-7677 `context.privyAccessToken`. The v2 free tier needs it; a project paying from its own deposit ignores it. Set `false` if your paymaster URL is not a PEPU policy service you trust with the token |
| `minutes?` | Session length, default `SESSION_DURATION_MINUTES` then 15 |
| `privy?`, `authenticate?` | Privy client and custom auth. Default: `requireUser` from [/privy/server](privy-server.md) |
| `publicClient?` | Chain reads. Default viem on the PEPU RPC (`PEPU_RPC_URL` aware) |

Route behavior: `activate` answers 409 `SESSION_NONE` with nothing pending, 410 `SESSION_EXPIRED` for an expired offer, 400 `SESSION_APPROVAL_MISMATCH` for a wrong approval. `act` answers 409 `SESSION_NONE` without a live session and 429 while another action is running. `status` never returns the key or the approval. Calling `prepare` again replaces any pending or active session. A brand-new user's embedded wallet exists in the browser a moment before Privy's server lists it, so with the default authentication the routes look the user up again (`provisioningWait`, default 3 retries, 400 ms times the attempt number); if the wallet is still not visible, `status` answers a normal `{ active: false, provisioning: true }` and the other routes a retryable 409 `WALLET_NOT_PROVISIONED`.

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

## Exports: `/combo/react`

| Export | Signature | What it abstracts |
|---|---|---|
| `useSponsoredSession` | `<I = undefined, O = unknown>(o: { scope; endpoints?; authFetch?; publicClient?; pollMs?; provisioningRetryDelaysMs? }) => { phase; statusLoading; owner?; smartAccount?; scope?; expiresAt?; actions?; grant(); act(input?); revoke(); refetch(); error? }` | The whole session flow for a component |
| `grantKernelSession` | `(p: { authFetch; publicClient; owner; scope; endpoints? }) => Promise<PreparedSession>` | The grant outside React: prepare, owner signs, activate |
| `deriveSessionPhase` | `(p: { authenticated; hasWallet; validUntil?; nowSeconds; granting?; hasError? }) => SponsoredSessionPhase` | Pure phase logic |
| `DEFAULT_SESSION_ENDPOINTS` | `{ prepare, activate, status, act, revoke }` | Defaults match `app/api/session/<name>/route.ts` |
| Types | `SponsoredSessionPhase`, `PreparedSession`, `SponsoredSessionStatus`, `SponsoredSessionEndpoints`, `UseSponsoredSessionOptions`, `SponsoredActResult` | |

`phase` is `signed-out`, `provisioning`, `ready`, `granting`, `active`, `expired` or `error`. While `statusLoading` is true, `phase` is `ready` only because nothing is known yet: render a spinner, not the "start a session" card. `statusLoading` also stays true while the server cannot see a just-created wallet yet: the hook re-checks with backoff (0.5 s to 5 s, about 30 s) and shows no error for that state, and `grant()` retries `prepare` for about 6.5 s before surfacing `WALLET_NOT_PROVISIONED`. `useSponsoredSession` rebuilds the policies from the same `scope` the server uses, and the server rejects any difference with `SESSION_APPROVAL_MISMATCH`.

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

## Gas reserved per action

The paymaster policy service reserves worst-case cost per operation: about 20.5 PEPU for a session's first operation (it deploys the account and enables the permission) and about 6.9 PEPU after (`SESSION_GAS_RESERVATION_PEPU`). The real first-session cost measured was about 12.8 PEPU for two operations. Size per-user hourly and daily caps above the reservation or users hit a cap error after their first action.

## Errors

| Code | HTTP | When |
|---|---|---|
| `AUTH_INVALID_TOKEN` | 401 | Bad or missing Privy token |
| `WALLET_NOT_PROVISIONED` | 409 | The user has no embedded wallet yet, or Privy's server does not list it yet (retryable; the hook retries it for you) |
| `SESSION_NONE` | 409 | `activate` with nothing pending, `act` without a live session |
| `SESSION_EXPIRED` | 410 | An expired offer or session |
| `SESSION_APPROVAL_MISMATCH` | 400 | The approval is not for the issued key, scope and expiry |
| `POLICY_UNSCOPED` | 403 | A call outside the scope |
| `CONFIG_MISSING_ENV` | 500 | Unset call target or Privy variable (request time) |
| `CONFIG_SERVER_ONLY` | | `/combo` imported in a browser bundle |
| `BUNDLER_*`, `PAYMASTER_*` | varies | Sponsorship failures, mapped by `describeUserOpFailure`. See [SDK Error Catalog](errors.md) |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Sessions vanish after a deploy | `createMemoryStore` is lost on restart | Implement `SessionStore` on a database with the key encrypted at rest |
| 429 on `act` | Another action is in flight for the user | Wait; the store's `tryLock` serializes per user. A multi-instance deployment needs a distributed lock |
| `PAYMASTER_CAP` after the first action | Spend caps below the reservation | Raise caps above 20.5 PEPU |
| `PAYMASTER_DESTINATION_NOT_ALLOWED` | The contract is not on the paymaster allowlist | Add it to the project's targets |

## Related

- [Smart Account Paths: which one to use](../concepts/smart-account-paths.md)
- [Sponsored Session: No Popup, No Gas](../onboarding/sponsored-session.md)
- [Google Login, Session and Sponsorship End to End](../onboarding/google-session-sponsored.md)
- [Sponsored Session in One Flow](../recipes/sponsored-session.md)
- [Sponsored Session App template](../templates/sponsored-session-app.md)
