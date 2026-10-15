---
name: pepu-paymaster-projects
description: v2 project sponsorship on Pepe Unchained (PEPU) V2 (chain 97741), where a developer claims a project keyed by their Privy app id, deposits PEPU one-way, sets targets and daily limits, and the paymaster pays their users' gas. Uses @pepu-chain/sdk/paymaster (computeProjectId, createPaymasterApi, readProject, configureProject, depositFor, encode* helpers, mapPaymasterReason) and /paymaster/server (requestClaimAttestation). v2 is deployed on mainnet as a canary (0xdb28528C9399C33c9A0297E8A62F39145acbC30D): internally reviewed 3 times, external audit pending, funded in small tranches. v1 is retired. Use to claim, configure, fund and use a project, to answer sponsorship-tier questions honestly, or to read a project's state.
---

# v2 paymaster projects (deployed canary, external audit pending)

**Status, say it exactly:** deployed on PEPU mainnet as a **canary** at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (`getPepuAddresses()` lists `paymasterV2`, and `paymaster` is its alias): internally reviewed 3 times, **external audit pending**, funded in small tranches. The v1 paymaster (`0x2B6F...`) is **retired** (deposit withdrawn); never deposit to it.
Never call v2 audited or production-hardened, never invent an address or URL, and advise small deposits. Proof: a project-sponsored operation from a fresh 0-PEPU Kernel account went through the hosted URLs (tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`, 5.00 PEPU of gas including account deployment).
The chain-facing SDK functions below default to the registry address (`resolvePaymasterV2Address()`); pass `paymaster` only to override.

## When to use

- A developer asks how the free tier or project deposits work, how to claim a project, set limits, or fund it.
- You are scripting or reviewing the claim, configure, deposit and register workflow.
- You must answer "can my app use sponsorship?": call `pepu_sponsorship_status` and answer from it, then explain the project path below.

## Chain facts

Chain 97741; EntryPoint v0.7; the v2 canary is deployed, v1 is retired. Generated table: [reference/chain-facts.md](reference/chain-facts.md). Rules: [reference/rules.md](reference/rules.md).
The model in four facts:

1. **Free tier funded by the chain:** 100 PEPU per user per day and 50 PEPU per user per hour (enforced by the policy service), for Privy users only. It needs a verified Privy access token from PEPU's own Privy app in the ERC-7677 `context.privyAccessToken`, and today the only free-tier target is TapScore (the manager can add more). It does not cover a third-party app: a token from your own Privy app is ignored for billing. Beyond the free tier a dApp deposits into its own project.
2. **Projects are keyed by Privy app id:** `projectId = keccak256(bytes(appId))`. The app id is **case-sensitive**.
3. **Anyone can deposit into any project** (permissionless).
4. **Deposits are one-way. Nobody can withdraw them.** Never tell a developer they can get a deposit back.

## SDK functions to use

```ts
import {
  computeProjectId, readProject, configureProject, depositFor, sendPaymasterCalls,
  encodeDeposit, encodeClaimFromVerification, encodeSetPaused, encodeProposeProjectOwner,
  createPaymasterApi, mapPaymasterReason, resolvePaymasterV2Address,
} from "@pepu-chain/sdk/paymaster";
import { requestClaimAttestation } from "@pepu-chain/sdk/paymaster/server"; // server or CLI only: it sends your Privy app secret
```

Peers: `viem`. No React is involved.

## MCP tools to call first

1. `pepu_project_balance` with `appId` (or `projectId`): owner, claimed, balance, limits, spent today, paused, allowlist. It reads the registry's deployed v2 canary; pass `paymaster` only to override.
2. `pepu_prepare_project_tx` with `action` (`deposit`, `claim`, `reclaim`, `executeReclaim`, `cancelReclaim`, `configure`, `setPaused`): an **unsigned** `{ to, data, value }` plus a plain-English warning. It never signs.
3. `pepu_sponsorship_status`, `pepu_explain_error` for denials (`mapPaymasterReason` codes).

## Steps (the developer flow)

SIWE login, `POST /v2/projects/verify` with your Privy app id and secret, `claimProject` (immediate if the project is empty, pending 48 hours if already funded), `setTargets` / `setDailyLimit` / `setSenderDailyLimit`, `depositFor`, register, then set the project's allowed origins for the client token.
The snippets use `const paymaster = "0x..."` for clarity; omit it to use the registry's canary (`resolvePaymasterV2Address(explicit?)` never guesses).

### 1. Compute the project id and read its state

```ts
import { createPublicClient, http } from "viem";
import { pepuMainnet } from "@pepu-chain/sdk";
import { computeProjectId, readProject } from "@pepu-chain/sdk/paymaster";

const appId = "your-privy-app-id"; // exactly as in the Privy dashboard, case-sensitive
const projectId = computeProjectId(appId);
const publicClient = createPublicClient({ chain: pepuMainnet, transport: http() });
const state = await readProject(publicClient, projectId, { paymaster: "0x1111111111111111111111111111111111111111" });
console.log(state.claimed, state.balance, state.limitsConfigured);
```

### 2. Claim: prove control of the Privy app, then submit the attestation

```ts
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPaymasterApi, encodeClaimFromVerification, sendPaymasterCalls } from "@pepu-chain/sdk/paymaster";
import { requestClaimAttestation } from "@pepu-chain/sdk/paymaster/server";
import { createWalletClient, http } from "viem";
import { pepuMainnet, getPublicClient } from "@pepu-chain/sdk";

const paymaster = "0x1111111111111111111111111111111111111111";
const owner = privateKeyToAccount(process.env.OWNER_KEY as Hex); // the wallet that will own the project
const api = createPaymasterApi();                                  // base URL from PEPU_PAYMASTER_URL
await api.v2.loginWithWallet((m) => owner.signMessage({ message: m }), { address: owner.address, domain: "app.example.com" });

// SECURITY: this sends your Privy APP SECRET to PEPU's policy service once. Use a dedicated Privy app for
// sponsorship if you can, and rotate the secret afterwards. Server or CLI only, never a browser.
const verified = await requestClaimAttestation(api, {
  appId: process.env.PRIVY_APP_ID as string,
  newOwner: owner.address,
  privyAppSecret: process.env.PRIVY_APP_SECRET as string,
});

const wallet = createWalletClient({ account: owner, chain: pepuMainnet, transport: http() });
await sendPaymasterCalls(wallet, [encodeClaimFromVerification(verified, { paymaster })], { publicClient: getPublicClient(pepuMainnet) });
```

`verified.action` is `claimProject` for an unclaimed project, or a timelocked, cancelable `reclaimProject` for an owned one. A `claimProject` takes effect at once only if the project holds no funds; if anyone has deposited into it already, the claim is PENDING for the 48-hour admin delay (`verified.takesEffect` is `after_admin_change_delay`): wait for `readProject(...).pendingReclaim.executableAt`, then send `encodeExecuteReclaim(projectId)`. The contract owner or manager can cancel a pending first claim. Claim before anyone funds the project.
The app secret handling warning applies every time: never log it, never put it in a browser, rotate it after.

### 3. Configure: nothing is sponsored until this is done

A claimed project spends nothing until all three calls have run: targets (the on-chain allowlist, 1 to 50 contracts), a total daily limit and a per-wallet daily limit. The per-wallet limit is mandatory: the contract rejects a project that has none.

```ts
import { parseEther } from "viem";
import { configureProject, sendPaymasterCalls } from "@pepu-chain/sdk/paymaster";
// wallet, publicClient, appId and paymaster are the ones defined in steps 1 and 2.

const { projectId, calls } = configureProject({
  appId,
  paymaster,
  targets: ["0x261eA5971B93237a56990206A46Bc80318e4d078"],
  dailyLimitWei: parseEther("50"),
  senderDailyLimitWei: parseEther("1"),
});
await sendPaymasterCalls(wallet, calls, { publicClient }); // an EOA sends them one after another
```

### 4. Fund it (ONE-WAY)

```ts
import { parseEther } from "viem";
import { depositFor } from "@pepu-chain/sdk/paymaster";
// wallet, publicClient, appId and paymaster are the ones defined in steps 1 and 2.

// Refuses an unclaimed project by default (catches a mistyped, case-sensitive app id before funds go to a project nobody controls).
const hash = await depositFor({ walletClient: wallet, publicClient, appId, amountWei: parseEther("10"), paymaster });
```

Before any deposit, state the one-way rule to the user and get an explicit yes. `depositFor` is real money; do not run it on a guess.

### 5. Register and use credentials

`api.v2.projects.register({ appId, allowedOrigins, requireIdentity })` returns a publishable client token (`ppt_`, bound to allowed origins) and a secret server key (`ppk_`), each shown once.
The ERC-7677 URL is `https://paymaster.pepeunchained.com/v2/paymaster/<token>`: build it with `buildErc7677Url({ baseUrl, token })` or `hostedErc7677Url(token)`. A client token works only from the project's allowed origins; with none set it is refused with `project_origin_not_allowed`. Backends use the server key in that URL.
Keep the server key on the backend. Rotate with `api.v2.projects.rotateClientToken(projectId)` and `rotateServerKey(projectId)`; `updateSettings` changes `allowedOrigins`, `perUserDailyCapWei`, `requireIdentity`.
After an ownership change, the new owner must sign in again, register again and rotate (`PAYMASTER_PROJECT_OWNER_CHANGED`).

## Verify

1. `pepu_project_balance` shows the project as claimed with limits configured and a balance.
2. A sponsored send from `pepu-sponsored-transactions` using the project's URL succeeds, `result.paymaster` is the v2 paymaster.
3. `pepu_explain_error` on any denial; `mapPaymasterReason(reason)` maps the service's reason code to a typed error.

## Pitfalls

- **Claimed but still not owned:** the project already held funds, so the claim is pending (`readProject` shows `claimed: false` and a `pendingReclaim`). Wait out the delay and run `encodeExecuteReclaim`; do not claim again (a newer claim restarts the delay).
- **Mistyped app id:** project ids are `keccak256` of the exact string. A wrong case funds a project nobody can claim. `depositFor` refuses unclaimed projects unless `requireClaimed: false`.
- **Deposited but nothing is sponsored:** targets or limits are not set (`limitsConfigured` is false). Run step 3. `PAYMASTER_NO_BALANCE`, `PAYMASTER_CAP`, `PAYMASTER_PROJECT_PAUSED` (`encodeSetPaused(projectId, false)`), `PAYMASTER_PROJECT_NOT_CLAIMED`, `PAYMASTER_DESTINATION_NOT_ALLOWED` each say which.
- **`PAYMASTER_SESSION_REQUIRED`:** the owner SIWE session (1 hour) expired; call `loginWithWallet` again.
- The paymaster **reserves worst-case gas** per operation, so a daily limit smaller than one reservation (about 20.5 PEPU for a Kernel session's first operation) denies it.
- The v2 contract is a canary awaiting an external audit. Do not present it to a user as production-ready, and advise small deposits.

## Never hand-roll

Do not compute project ids with your own hashing, hand-encode paymaster calldata, hand-write the SIWE login, build claim attestations, or parse paymaster denial strings.
Use `computeProjectId`, `encode*`, `configureProject`, `depositFor`, `createPaymasterApi().v2.loginWithWallet`, `requestClaimAttestation`, `mapPaymasterReason`. See [reference/rules.md](reference/rules.md).
