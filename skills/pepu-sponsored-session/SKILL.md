---
name: pepu-sponsored-session
description: The full combination on Pepe Unchained (PEPU) V2 mainnet (chain 97741) - Google login, an embedded wallet, ONE owner signature that grants an on-chain Kernel session key, then actions with no popup and no user gas because a paymaster pays. Built from @pepu-chain/sdk/combo (createSponsoredSessionRoutes, createMemoryStore) and /combo/react (useSponsoredSession), with /session/kernel (buildKernelSessionPolicies, approveKernelSession, loadKernelSessionAccount) underneath and the sponsored-session-app template. Scope is enforced on-chain. Needs a bundler and a paymaster. Includes the five routes, the component, Privy dashboard fields, the production SessionStore warning, and troubleshooting. Use when someone wants login plus no popups plus no gas, a game or app where users never see a wallet.
---

# Google login, one session signature, no popups, no user gas

Pillars 1 + 2 + 3 together. The user signs in with Google (Privy), signs **one** EIP-712 message that enables a session key on their Kernel smart account,
and from then on every action is a sponsored UserOperation signed by the server-held session key. The scope (which contract, which functions, value, expiry)
is enforced **on-chain** by the account's call policy and timestamp policy, not by a server.

## When to use

- Login plus "no wallet popup" plus "the user holds no PEPU". If the user pays gas and an off-chain scope is fine, use `pepu-session-keys`. If you only need gasless without sessions, use `pepu-sponsored-transactions`.
- Scaffold it: `npx create-pepu-app@latest my-app --template sponsored-session-app --yes --json`, or `pepu_scaffold_app` with `template: "sponsored-session-app"`.

Honesty rules: the hosted bundler (`https://bundler.pepeunchained.com`) is the default; the paymaster URL needs your project's server key (`PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<ppk_ server key>`, secret). The combined flow is proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster (and by script with `npm run prove-session`). The v2 paymaster is a canary, external audit pending. The route forwards the signed-in user's Privy token as ERC-7677 context (`forwardPrivyToken`); the free tier only honours a token from PEPU's own Privy app.
Run `pepu_sponsorship_status` first and report what it says. The session key is a hot key held by your server: it can act within the scope until it expires or you delete it.

This is Path 1 (ZeroDev-native): the SDK builds the Kernel account, so Privy Smart Wallets is not needed. How it differs from Privy Smart Wallets and when to use each: https://guide.pepeunchained.com/concepts/smart-account-paths.

## Chain facts

Chain 97741; EntryPoint v0.7; Kernel v3.1; call policy v0.0.4 and timestamp policy deployed (see the generated table in
[reference/chain-facts.md](reference/chain-facts.md)); rules in [reference/rules.md](reference/rules.md).
The paymaster reserves worst-case gas per operation: about **20.5 PEPU** for a session's first operation and **6.9 PEPU** for later ones (`SESSION_GAS_RESERVATION_PEPU`). Size caps above that.

## SDK functions to use

```ts
// server (five route handlers)
import { createSponsoredSessionRoutes, createMemoryStore } from "@pepu-chain/sdk/combo";
import type { SessionStore, SessionRecord } from "@pepu-chain/sdk/combo";
// browser
import { useSponsoredSession } from "@pepu-chain/sdk/combo/react";
// consent copy and the underlying primitives
import { SESSION_TRUST_NOTICE } from "@pepu-chain/sdk/session";
import {
  buildKernelSessionPolicies, describeKernelSessionScope, approveKernelSession, loadKernelSessionAccount,
  generateSessionKey, SESSION_GAS_RESERVATION_PEPU,
} from "@pepu-chain/sdk/session/kernel";
import { createPepuSponsoredClient, sendSponsored } from "@pepu-chain/sdk/aa/kernel";
// login and wallet (from pepu-onboarding-privy)
import { PepuPrivyProvider, WalletGate } from "@pepu-chain/sdk/privy/react";
import { createEnsureWalletRoute } from "@pepu-chain/sdk/privy/server";
```

Peers: `@privy-io/react-auth`, `@privy-io/node`, `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator`.

## MCP tools to call first

1. `pepu_sponsorship_status`, `pepu_bundler_health`, `pepu_paymaster_health`: is the stack up.
2. `pepu_session_policy` with `mode: "kernel"`, `contract`, `functions`, `minutes`, `valueLimitWei?`: the policies, a consent summary and a snippet.
3. `pepu_check_env` with `template: "sponsored-session-app"`; `pepu_check_privy_config` with `pillars: ["login", "sponsor"]`.
4. `pepu_sdk_snippet` with `task: "sponsored-session"` and `"sponsored-session-client"`; `pepu_explain_tx` on an action's hash.

## Steps

### 1. Login and wallet

Do `pepu-onboarding-privy` steps 1 to 3: `PepuPrivyProvider` with `WalletGate`, and `app/api/wallet/ensure/route.ts`. Smart Wallets in the Privy dashboard are **not** needed here: the SDK builds the Kernel account itself.

### 2. Environment

```
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=
PEPU_BUNDLER_URL=<PEPU_BUNDLER_URL>
PEPU_PAYMASTER_URL=<PEPU_PAYMASTER_URL>
SESSION_DURATION_MINUTES=15
# local development defaults used by the PEPU services: http://localhost:4337 and http://localhost:8788
```

`PEPU_PAYMASTER_URL` embeds a credential: server only. No Privy authorization key is needed in this mode (nothing is signed by Privy on the server).

### 3. The scope, shared by server and browser (`lib/scope.ts`)

```ts
import type { Abi, Address } from "viem";

export const tapScoreAbi = [
  { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const satisfies Abi;

export const TAP_SCORE = process.env.NEXT_PUBLIC_GAME_CONTRACT_ADDRESS as Address;

/** The one contract and function the session key may call, enforced on-chain. Optional per call: valueLimit (wei, default 0n). */
export const scope = {
  calls: [{ target: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }],
} as const;
```

### 4. The five routes (`lib/session-routes.ts` and `app/api/session/*`)

```ts
// lib/session-routes.ts
import { createSponsoredSessionRoutes, createMemoryStore } from "@pepu-chain/sdk/combo";
import { scope, TAP_SCORE, tapScoreAbi } from "./scope";

export const routes = createSponsoredSessionRoutes({
  scope,
  store: createMemoryStore(), // DEV ONLY: see "Production store" below
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }],
  },
});
```

```ts
// app/api/session/prepare/route.ts    creates the session key, returns its public address, expiry and scope
import { routes } from "@/lib/session-routes";
export const { POST } = routes.prepare;
```

```ts
// app/api/session/activate/route.ts   checks the owner's approval is for this key, scope and expiry, then stores it
import { routes } from "@/lib/session-routes";
export const { POST } = routes.activate;
```

```ts
// app/api/session/status/route.ts     { active: false } or { active: true, validUntil, ... } (never the key)
import { routes } from "@/lib/session-routes";
export const { GET } = routes.status;
```

```ts
// app/api/session/act/route.ts        signs ONE sponsored UserOperation with the session key
import { routes } from "@/lib/session-routes";
export const { POST } = routes.act;
```

```ts
// app/api/session/revoke/route.ts     deletes the key and approval from the server
import { routes } from "@/lib/session-routes";
export const { POST } = routes.revoke;
```

The factory authenticates with `requireUser` (the owner address comes from Privy, never from the request), re-checks every call against the scope before sponsoring, and returns
`409 SESSION_NONE`, `410 SESSION_EXPIRED`, `400 SESSION_APPROVAL_MISMATCH` and `429` while another action runs. Override `authenticate`, `endpoints`, `minutes`, `publicClient` if needed.

### 5. The component

```tsx
"use client";
import { SESSION_TRUST_NOTICE } from "@pepu-chain/sdk/session";
import { useSponsoredSession } from "@pepu-chain/sdk/combo/react";
import { scope } from "@/lib/scope";

export function SponsoredSession() {
  const { phase, grant, act, revoke, smartAccount, owner, scope: granted, expiresAt, actions, error } =
    useSponsoredSession<undefined, { transactionHash: string }>({ scope });

  if (phase === "signed-out" || phase === "provisioning") return <p>{phase === "signed-out" ? "Sign in first." : "Setting up your wallet..."}</p>;

  if (phase === "ready" || phase === "expired" || phase === "granting" || phase === "error") {
    return (
      <section>
        <p>You sign once. Then this app can call only the functions below, for a short time, with no popups and no gas from you.</p>
        <p>{SESSION_TRUST_NOTICE["kernel-onchain"]}</p>
        <button onClick={grant} disabled={phase === "granting"}>{phase === "expired" ? "Start a new session" : "Start session"}</button>
        {error && <p>{error.message} {error.hint}</p>}
      </section>
    );
  }

  return (
    <section>
      <p>Smart account {smartAccount} (owner {owner}), {actions ?? 0} actions, expires {expiresAt ? new Date(expiresAt * 1000).toLocaleTimeString() : "?"}</p>
      <ul>{granted?.calls.map((c) => <li key={c.selector}>{c.signature} on {c.target}, max value {c.maxValueWei} wei</li>)}</ul>
      <button onClick={() => void act().catch(() => undefined)}>Tap</button>
      <button onClick={() => void revoke()}>End session</button>
      {error && <p>{error.message} {error.hint}</p>}
    </section>
  );
}
```

`phase` is one of `signed-out`, `provisioning`, `ready`, `granting`, `active`, `expired`, `error`. `grant()` is: ask the server to prepare a key, ONE owner signature through the embedded wallet (no gas), activate. `smartAccount` is the Kernel address that sends and holds assets; `owner` is the embedded wallet that signs.

### 6. The primitives, for non-Next or custom flows

```ts
import { createPublicClient, http } from "viem";
import { pepuMainnet } from "@pepu-chain/sdk";
import { buildKernelSessionPolicies, approveKernelSession, loadKernelSessionAccount, generateSessionKey } from "@pepu-chain/sdk/session/kernel";
import { createPepuSponsoredClient, sendSponsored } from "@pepu-chain/sdk/aa/kernel";
import { scope, TAP_SCORE, tapScoreAbi } from "./scope";

const publicClient = createPublicClient({ chain: pepuMainnet, transport: http() });
const validUntil = Math.floor(Date.now() / 1000) + 15 * 60;

// server: a fresh session key (keep the private half server-side)
const key = generateSessionKey();
const policies = buildKernelSessionPolicies({ calls: scope.calls, validUntil });

// browser (the owner's walletClient): the ONE signature
declare const ownerWalletClient: import("viem").WalletClient;
const { approval } = await approveKernelSession({ publicClient, owner: ownerWalletClient, sessionKeyAddress: key.address, policies });

// server: act with the session key, sponsored
const account = await loadKernelSessionAccount({ publicClient, approval, sessionPrivateKey: key.privateKey });
const client = createPepuSponsoredClient({ account, publicClient });
const r = await sendSponsored({ client, calls: [{ to: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }] });
```

Use the routes and hook unless you are not on Next.js: they add the lifecycle checks (matching permission id, expiry, one action at a time, scope re-check).

## Production store (read before shipping)

`createMemoryStore()` is dev-grade: records vanish on restart (users simply start a new session), are not shared across serverless instances, and the **session private key is held in plaintext in memory**.
A production deployment implements `SessionStore` on a persistent database or KV **and encrypts `sessionPrivateKey` at rest** (KMS or an envelope key), with an atomic per-user lock (`tryLock`, for example Redis `SET NX PX` in a multi-instance setup). Nothing else changes:

```ts
import type { SessionRecord, SessionStore } from "@pepu-chain/sdk/combo";

declare const db: {
  get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void>;
  lock(k: string): Promise<boolean>; unlock(k: string): Promise<void>;
};
declare function encrypt(plain: string): Promise<string>; // your KMS
declare function decrypt(cipher: string): Promise<string>;

export const store: SessionStore = {
  async get(userId) {
    const raw = await db.get(`session:${userId}`);
    if (!raw) return undefined;
    const rec = JSON.parse(raw) as SessionRecord;
    return { ...rec, sessionPrivateKey: (await decrypt(rec.sessionPrivateKey)) as `0x${string}` };
  },
  async set(rec) {
    await db.set(`session:${rec.userId}`, JSON.stringify({ ...rec, sessionPrivateKey: await encrypt(rec.sessionPrivateKey) }));
  },
  delete: (userId) => db.del(`session:${userId}`),
  tryLock: (userId) => db.lock(`lock:${userId}`),
  unlock: (userId) => db.unlock(`lock:${userId}`),
};
```

## Privy dashboard settings

Same as `pepu-onboarding-privy` (field by field there): App ID and App secret, **Allowed origins** with the exact origin and port, **Google** and any other login methods enabled, **Embedded wallets** on for Ethereum.
Not needed here: Smart wallets (the SDK builds the Kernel account), authorization keys and key quorums (those are Privy mode, `pepu-session-keys`).
`pepu_check_privy_config` with `pillars: ["login"]`.

## Verify

1. `pepu_sponsorship_status` is `available: true` (or you tell the user precisely what `fixes` says).
2. `pepu_check_env` for `sponsored-session-app` has no `missing` or `placeholder`.
3. Run it, sign in, press Start session (one signature, no gas), press Tap several times: no popup, `r.paymaster` set, the smart account balance stays 0. `pepu_explain_tx` on a hash shows the paymaster paid.
4. End the session, tap again, get `SESSION_NONE`.
5. `npm run typecheck && npm run build`.

## Pitfalls

- **Revoke is server-side only.** `revoke` deletes the key and approval so the app cannot act. The on-chain permission stays valid until its expiry, but only the deleted key can use it and only within the scope. An on-chain uninstall is an owner-signed call to the user's own account, which the paymaster rightly does not sponsor. Say this in the UI.
- **`SESSION_APPROVAL_MISMATCH`:** the browser rebuilt different policies than the server issued. The `scope` passed to `useSponsoredSession` must equal the server's, and `prepare` must have been called for this grant. Start again.
- **`SESSION_EXPIRED` / phase `expired`:** start a new session. `prepare` replaces any pending or active one.
- **Spend caps:** the paymaster reserves about 20.5 PEPU for the first operation and 6.9 PEPU for later ones. A cap below that denies the operation (`PAYMASTER_CAP`).
- **`PAYMASTER_DESTINATION_NOT_ALLOWED`:** the target contract is not in the paymaster project's allowlist. Add it to the policy or project targets.
- **`BUNDLER_UNREACHABLE` / `CONFIG_MISSING_ENV`:** `PEPU_BUNDLER_URL` or `PEPU_PAYMASTER_URL` is unset or wrong. `checkSponsorship()` says which.
- **429 on act:** another action for that user is still running; wait. Multi-instance deployments need a distributed `tryLock`.
- **In-memory store resets in development:** a restart drops sessions; start a new one.
- Use `pepu_explain_error` (SDK `explainError`) on any message.

## Never hand-roll

Do not write session-key generation, the Kernel permission plumbing, the five lifecycle routes, the EIP-712 approval flow, the expiry and scope checks, or sponsored UserOperation sending.
Use `createSponsoredSessionRoutes`, `useSponsoredSession`, and for custom flows `buildKernelSessionPolicies`, `approveKernelSession`, `loadKernelSessionAccount`, `createPepuSponsoredClient`, `sendSponsored`. See [reference/rules.md](reference/rules.md).

Reference app: `templates/sponsored-session-app`.
