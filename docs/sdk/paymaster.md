# /paymaster

`@pepu-chain/sdk/paymaster` is the typed client for the PEPU paymaster policy service (v1 and v2 REST), the on-chain helpers for v2 projects (claim, configure, deposit, read), and the mapping from denial reasons to `PepuError` codes. `@pepu-chain/sdk/paymaster/server` adds the one call that carries a Privy app secret.

The v2 tiered paymaster `PepuSponsoredPaymasterV7` is at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (registry keys `paymasterV2` and `paymaster`). The hosted policy service at `https://paymaster.pepeunchained.com` serves it through `https://paymaster.pepeunchained.com/v2/paymaster/<server key>`. The v1 paymaster is retired (EntryPoint deposit withdrawn); the v1 REST routes remain in the client for reference only. Deposits are one-way, so deposit only what your project needs.

## Import, peers and boundary

| Entry | Server or client | Peer dependencies |
|---|---|---|
| `@pepu-chain/sdk/paymaster` | Isomorphic (plain `fetch` plus viem). Never put a server key (`ppk_`) in a browser | `viem` |
| `@pepu-chain/sdk/paymaster/server` | **Server or CLI only**. `CONFIG_SERVER_ONLY` in a browser | `viem` |

Credentials: a **client token** (`ppt_`, publishable, bound to allowed origins) and a **server key** (`ppk_`, secret, any wallet). `credentialKind` tells them apart by prefix only.

## v2 facts the helpers encode

- `projectId = keccak256(bytes(appId))`, case-sensitive. A typo deposits into a project nobody can claim.
- **Deposits only.** There are no withdrawals, for owners or anyone. Pausing is the exit. Anyone may `depositFor` any project.
- Ownership is Privy-verified: prove the app secret, get an EIP-712 attestation, call `claimProject`. **The claim sets the owner only.** Then the owner must call `setTargets`, `setDailyLimit` and `setSenderDailyLimit`. Nothing is sponsored until all three have run (a project with no per-wallet limit is rejected on chain). An empty project is claimed at once; a project that already holds deposits is **pending** for the admin delay (at least 48 hours) and finished with `encodeExecuteReclaim`.
- A re-claim of an owned project is timelocked 48 hours and the owner can cancel it once per new owner. Ownership transfer is two-step (propose, accept).
- Free tier: 100 PEPU per user per day and 50 PEPU per user per hour (enforced by the service), for Privy users only, no chain-wide ceiling. The free-tier targets are TapScore only for now (`0x261eA5971B93237a56990206A46Bc80318e4d078`); the manager can add more. Beyond the free tier a dApp deposits into its own project. The free tier needs a verified Privy access token from PEPU's own Privy app, sent as `context.privyAccessToken` in the ERC-7677 request (REST: `Authorization: Bearer`). A third-party app's own Privy token is ignored for billing, so third-party apps use a project.

## Tokens and origins

- **Client token** (`ppt_`): publishable, works only from the project's allowed origins. With no origins set, or from another origin, it is refused with `project_origin_not_allowed`.
- **Server key** (`ppk_`): secret. Backend callers put it in the ERC-7677 URL: `https://paymaster.pepeunchained.com/v2/paymaster/<token>`.
- Developer flow: SIWE login (`/v2/auth/nonce`, `/v2/auth/login`), `POST /v2/projects/verify` with the Privy app id and secret (used for one request, never stored), `claimProject` (immediate if the project is empty; pending 48 hours if already funded), `setTargets`, `setDailyLimit`, `setSenderDailyLimit`, `depositFor` (one-way, nobody can withdraw), register the project to get the `ppt_` client token and `ppk_` server key, then set allowed origins for the client token.
- Build the URL with `hostedErc7677Url(token)` (from `/paymaster`) or `buildErc7677Url({ baseUrl, token, version })`. `createPepuPaymasterClient` and `createPepuSponsoredClient` accept `paymasterToken` and build the URL for you; `requirePaymasterUrl(explicit?, token?)` is the resolver they share.

## REST client

```ts
createPaymasterApi(options?: { baseUrl?; fetch?; env?; timeoutMs?; sessionToken? }): PaymasterApi
// PaymasterApi: { baseUrl: string; v1: PaymasterApiV1; v2: PaymasterApiV2 }
```

`baseUrl` defaults to `resolvePepuEndpoints().paymasterBaseUrl`: `PEPU_PAYMASTER_URL` (or the `NEXT_PUBLIC_` name) with any `/v2/paymaster/<token>` tail stripped, then the hosted base `https://paymaster.pepeunchained.com`. It throws `CONFIG_MISSING_ENV` only if the hosted base was cleared. Default timeout 15000 ms.

| Method | Calls | Notes |
|---|---|---|
| `v1.sponsor(userOp, auth)` | `POST /sponsor` | Needs `auth.privyAccessToken` (`PAYMASTER_IDENTITY_REQUIRED` if missing) |
| `v1.health()` | `GET /health` | |
| `v1.erc7677Url(token)`, `v2.erc7677Url(token)` | URL builder | `<base>/paymaster/<token>` and `<base>/v2/paymaster/<token>` |
| `v2.sponsor(userOp, auth)` | `POST /v2/sponsor` | Returns approvals and denials; use `assertApproved` to throw |
| `v2.config()`, `v2.contract()`, `v2.freeTier()` | `GET /v2/config`, `/v2/contract`, `/v2/free-tier` | `contract()` gives the deployed address and ABI |
| `v2.auth.nonce()`, `login(message, signature)`, `logout()`, `v2.me()` | SIWE session | |
| `v2.loginWithWallet(sign, { address, domain, uri?, chainId?, statement?, lifetimeSeconds? })` | nonce, EIP-4361 message, login | One-hour session stored on the client. `domain` must be one of the service's `SIWE_DOMAINS` |
| `v2.projects.prepare(request)` | `POST /v2/projects/prepare` | Calldata for the owner's wallet. Sends nothing |
| `v2.projects.register`, `list`, `get`, `updateSettings`, `usage`, `events`, `allowlist` | `/v2/projects/*` | `register` returns the client token, the ERC-7677 URL and the secret server key, each shown once |
| `v2.projects.rotateClientToken`, `rotateServerKey` | | |
| `v2.request(method, path, options?)` | any `/v2` path | Escape hatch with the same error mapping |

`SponsorAuth` is `{ apiKey; privyAccessToken?; origin? }` and `apiKey` is sent as `X-Api-Key`. Full endpoint behavior is in [REST API v1](../infra/paymaster/rest-api-v1.md), [REST API v2](../infra/paymaster/rest-api-v2.md) and [Credential Matrix](../infra/paymaster/auth.md).

Helpers: `buildErc7677Url({ baseUrl, token, version? = 2 })` refuses a `ppk_` key in a browser (`CONFIG_SERVER_ONLY`); `assertApproved(result)` returns the approval or throws the mapped error; `serializeAttestation(a)` converts to the wire format.

## On-chain helpers (v2)

Every helper takes an optional `paymaster` address and defaults to the registry's `paymasterV2` entry (the deployed paymaster). Pass one explicitly to target another deployment; with no registry entry and no address it throws `CONFIG_MISSING_ENV`. No transaction is sent without the caller's wallet client.

| Export | Signature | What it does |
|---|---|---|
| `resolvePaymasterV2Address` | `(explicit?: Address) => Address` | Explicit, then registry, else `CONFIG_MISSING_ENV` |
| `computeProjectId`, `getProjectId` | `(appId: string) => Hex` | `keccak256(bytes(appId))`, 1 to 128 characters |
| `readProject` | `(client, projectId, { paymaster?, checkTargets?, now? }) => Promise<ProjectState>` | owner, `claimed`, `paused`, `balance`, limits, `spentToday`, `limitsConfigured`, `pendingReclaim` (a re-claim, or the first claim of a funded project while `claimed` is false), `pendingOwner`, optional per-target allowance |
| `encodeDeposit` | `(projectId, amountWei, options?) => PaymasterCall` | One-way `depositFor` |
| `encodeClaimProject`, `encodeReclaimProject`, `encodeClaimFromVerification` | `(attestation or verified, options?) => PaymasterCall` | `encodeClaimFromVerification` picks claim or reclaim from the verify result's `action` |
| `encodeExecuteReclaim`, `encodeCancelReclaim` | `(projectId, options?)` | Finish or cancel a pending claim or re-claim. `cancelReclaim` is the owner's (once per new owner); for a pending first claim of an unowned project the contract owner or manager cancels |
| `encodeSetTargets` | `(projectId, targets, allowed, options?)` | At most 50 per call. Owner only |
| `encodeSetDailyLimit`, `encodeSetSenderDailyLimit` | `(projectId, limitWei, options?)` | Owner only |
| `encodeSetPaused` | `(projectId, paused, options?)` | Pausing is the exit |
| `encodeProposeProjectOwner`, `encodeAcceptProjectOwnership` | | Two-step transfer |
| `configureProject` | `(params: { appId? \| projectId?; targets; dailyLimitWei; senderDailyLimitWei; paymaster? }) => { projectId; calls: PaymasterCall[] }` | The three post-claim calls, in order |
| `sendPaymasterCalls` | `(walletClient, calls, { publicClient? }) => Promise<Hash[]>` | Sends one after another; with `publicClient` waits for each receipt and throws `TX_REVERTED` on failure |
| `depositFor` | `(params: { walletClient; appId? \| projectId?; amountWei; requireClaimed? = true; publicClient?; paymaster? }) => Promise<Hash>` | Refuses an unclaimed project by default (`PAYMASTER_PROJECT_NOT_CLAIMED`) |
| `pepuSponsoredPaymasterV2Abi` | ABI | |

`PaymasterCall` is `{ to; data; value; function }`: a transaction a wallet or smart-account batch can send.

## Server: claim attestation

```ts
requestClaimAttestation(api: PaymasterApi, params: { appId: string; newOwner: Address; privyAppSecret: string }): Promise<ClaimAttestationResult>
```

`POST /v2/projects/verify`. The `api` client must already be signed in as `newOwner`. **This sends your Privy app secret to the PEPU policy service**, which documents it as never stored, logged or echoed. This SDK never logs, returns or puts the secret in an error. Use a dedicated Privy app for sponsorship if you can and rotate the secret afterwards. The result has `projectId`, `action` (`claimProject` for an unclaimed project, `reclaimProject` for an owned one), `attestation` and `expiresAt` (at most one hour).

## Denial reasons

| Export | Signature |
|---|---|
| `mapPaymasterReason` | `(reason: string \| undefined) => PepuErrorCode` |
| `paymasterReasonToError` | `(reason, message?, details?) => PepuPaymasterError` |
| `decodePaymasterRevert` | `(data: Hex) => { errorName; args } \| null` |
| `PAYMASTER_DENIAL_REASONS`, `PAYMASTER_REASON_CODES` | The full reason list and its exhaustive mapping to codes |

## Errors

| Code | When |
|---|---|
| `CONFIG_MISSING_ENV` | No `baseUrl`, no v2 paymaster address, no wallet account |
| `CONFIG_BAD_URL`, `CONFIG_SERVER_ONLY` | Bad `baseUrl`; a server key in a browser |
| `PAYMASTER_DENIED` | Generic refusal; bad argument to an encoder |
| `PAYMASTER_NO_BALANCE`, `PAYMASTER_CAP` | Balance exhausted; a project, user, sender or free-tier limit reached |
| `PAYMASTER_ORIGIN_NOT_ALLOWED`, `PAYMASTER_DESTINATION_NOT_ALLOWED` | Origin or target not on the project's allowlist |
| `PAYMASTER_PROJECT_NOT_CLAIMED`, `PAYMASTER_PROJECT_OWNER_CHANGED`, `PAYMASTER_PROJECT_PAUSED` | Project state |
| `PAYMASTER_IDENTITY_REQUIRED`, `PAYMASTER_FREE_TIER_UNAVAILABLE`, `PAYMASTER_RATE_LIMITED`, `PAYMASTER_SESSION_REQUIRED`, `PAYMASTER_API_ERROR` | Credential, tier, rate and session problems |
| `PAYMASTER_UNREACHABLE` | The service did not answer; the message omits the credential |
| `TX_REVERTED` | A prepared call reverted in `sendPaymasterCalls` |

## Example

```ts
// Register, claim, configure and fund a v2 paymaster project.
// Deposits are one-way; deposit only what your project needs.
// SERVER OR CLI ONLY: requestClaimAttestation sends your Privy app secret to the policy service.
// See docs/sdk/paymaster.md and docs/recipes/v2-deposit-and-claim.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import {
  buildErc7677Url,
  computeProjectId,
  configureProject,
  createPaymasterApi,
  depositFor,
  encodeClaimFromVerification,
  readProject,
  sendPaymasterCalls,
} from "@pepu-chain/sdk/paymaster";
import { requestClaimAttestation } from "@pepu-chain/sdk/paymaster/server";
import { createWalletClient, getAddress, http, parseEther } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TAPSCORE_ADDRESS } from "./tapscore";

const publicClient = getPublicClient(pepuMainnet);
const account = privateKeyToAccount(process.env["PROJECT_OWNER_PRIVATE_KEY"] as Hex);
const walletClient = createWalletClient({ account, chain: pepuMainnet, transport: http() });

// The registry's paymasterV2 entry is the deployed paymaster; the helpers default to it. It is passed explicitly here
// (GET /v2/contract on the service returns it too). Override with PEPU_PAYMASTER_V2_ADDRESS.
const paymaster = getAddress(process.env["PEPU_PAYMASTER_V2_ADDRESS"] ?? "0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
const appId = process.env["PRIVY_APP_ID"] as string;
const projectId = computeProjectId(appId); // keccak256(bytes(appId)), case-sensitive

export async function registerClaimConfigureFund() {
  // The paymaster service defaults to https://paymaster.pepeunchained.com (override with PEPU_PAYMASTER_URL).
  const api = createPaymasterApi();

  // 1. Sign in with the wallet that should own the project (SIWE, 1 hour session).
  await api.v2.loginWithWallet((message) => account.signMessage({ message }), {
    address: account.address,
    domain: process.env["PEPU_SIWE_DOMAIN"] as string,
  });

  // 2. Prove control of the Privy app, then submit the claim on-chain. The claim sets the owner ONLY.
  const verified = await requestClaimAttestation(api, {
    appId,
    newOwner: account.address,
    privyAppSecret: process.env["PRIVY_APP_SECRET"] as string,
  });
  const claim = encodeClaimFromVerification(verified, { paymaster });
  await sendPaymasterCalls(walletClient, [claim], { publicClient });

  // 3. Nothing is sponsored until the owner sets targets and both daily limits.
  const { calls } = configureProject({
    appId,
    paymaster,
    targets: [TAPSCORE_ADDRESS],
    dailyLimitWei: parseEther("100"), // project budget per day
    senderDailyLimitWei: parseEther("25"), // per wallet; must exceed one first-operation reservation (about 21 PEPU)
  });
  await sendPaymasterCalls(walletClient, calls, { publicClient });

  // 4. Deposits are ONE-WAY. depositFor refuses an unclaimed project by default (catches a mistyped app id).
  await depositFor({ walletClient, publicClient, appId, amountWei: parseEther("25"), paymaster });

  // 5. Index the project to get credentials (client token is browser-safe, the server key is not).
  const registered = await api.v2.projects.register({ appId, allowedOrigins: ["https://app.example.com"] });

  const state = await readProject(publicClient, projectId, { paymaster, checkTargets: [TAPSCORE_ADDRESS] });
  return {
    claimed: state.claimed,
    limitsConfigured: state.limitsConfigured,
    balance: state.balance,
    // Paste into the Privy "Paymaster URL" field, or pass to a viem paymaster client.
    erc7677Url: buildErc7677Url({ baseUrl: api.baseUrl, token: registered.token }),
  };
}
```

Source: `docs/snippets/v2-deposit-and-claim.ts`, type-checked against the SDK.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `CONFIG_MISSING_ENV` on every v2 helper | The registry has no `paymasterV2` address on the chain you passed (for example testnet) | Pass `paymaster` explicitly; on mainnet the registry holds the deployed v2 paymaster |
| Project claimed but nothing sponsored | `setTargets` and both limits not set | Run `configureProject` |
| `PAYMASTER_PROJECT_NOT_CLAIMED` on deposit | Mistyped app id, or not yet claimed | Check the case-sensitive id; claim first |
| `PAYMASTER_ORIGIN_NOT_ALLOWED` from a browser | The page origin is not in the project's allowed origins | Add the exact scheme, host and port |

## Related

- [Deposit and Claim a Paymaster Project](../recipes/v2-deposit-and-claim.md)
- [Register, Deposit and Claim a v2 Project](../infra/paymaster/v2-register-deposit-claim.md)
- [Paymaster v2 Spec Summary](../contracts/paymaster-v2-spec.md)
- [/aa](aa.md)
