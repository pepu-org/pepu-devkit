# Register, Deposit and Claim a v2 Project

Step-by-step procedure for a developer to fund and take ownership of a tiered-paymaster [project](../../reference/glossary.md): derive the project id, deposit, claim with a Privy-verified attestation, configure the allowlist and limits, issue credentials, plug them into your app, and know the rotation and re-claim rules. It uses the SDK (`@pepu-chain/sdk/paymaster` and `/paymaster/server`) and has an agent and MCP route for the parts a tool can do. You need a project for any sponsored template that is not PEPU's own app: this is where the "paymaster token" in the quickstart comes from.

> Status: **proven on mainnet (canary, external audit pending).** The v2 contract is deployed at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` and the policy service is hosted at `https://paymaster.pepeunchained.com`. A project-sponsored operation from a fresh Kernel account holding 0 PEPU has run end to end (project ledger 25 to 19.80 PEPU for one 5.00 PEPU operation). The contract has had three internal AI-assisted reviews and **no external audit**: fund it in small tranches and keep deposits small. Deposits are **one-way**: nobody can withdraw them.

## The whole procedure at a glance

| # | Step | Who does it | SDK | MCP or agent |
|---|---|---|---|---|
| 1 | Derive the project id from your Privy app id | Anyone | `computeProjectId` | `pepu_project_balance` computes it |
| 2 | Sign in to the policy service with the owner wallet (SIWE) | Owner wallet, in a script | `api.v2.loginWithWallet` | Not possible: needs the wallet's signature |
| 3 | Prove you control the Privy app (attestation) | Your script, with the Privy secret | `requestClaimAttestation` | Not possible: the secret must not pass through a tool |
| 4 | Claim the project on-chain | Owner wallet | `encodeClaimFromVerification`, `sendPaymasterCalls` | `pepu_prepare_project_tx` with `claim` returns the calldata |
| 5 | Set targets and both daily limits | Owner wallet | `configureProject` | `pepu_prepare_project_tx` with `configure` |
| 6 | Deposit PEPU (one-way) and register the project | Any wallet deposits; the owner session registers | `depositFor`, `api.v2.projects.register` | `pepu_prepare_project_tx` with `deposit`; registering needs the SIWE session |
| 7 | Put the right credential in your app and check | You | `checkSponsorship`, `readProject` | `pepu_project_balance`, `pepu_sponsorship_status` |

Do the steps in this order. Claim before anyone deposits, or the claim waits 48 hours. (The numbered sections below split the same work into finer steps.)

## Prerequisites

- The deployed v2 paymaster address, `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (the SDK registry has it as `paymasterV2`; `resolvePaymasterV2Address` throws rather than guess on a chain without one).
- The hosted service, `https://paymaster.pepeunchained.com` (the SDK default base). The ERC-7677 URL you end up with is `https://paymaster.pepeunchained.com/v2/paymaster/<token>`, with `PEPU_PAYMASTER_URL` holding the complete URL.
- Your **Privy app id** and app secret (server only; dedicated app recommended).
- An owner wallet that will control the project's settings (an EOA, or a Safe, which can sign SIWE via ERC-1271). Use a fresh wallet used only for this; its private key goes in an environment variable, never in code or a commit.
- Native PEPU in that wallet for deposits and for the configuration transactions' gas (a transaction costs a fraction of a cent; the deposit is whatever budget you want, start small).
- A scratch Node project to run the steps: `npm init -y && npm i @pepu-chain/sdk viem && npm i -D tsx`, then `npx tsx project.ts` with the variables below exported. The complete runnable version is the [Deposit and Claim a Paymaster Project](../../recipes/v2-deposit-and-claim.md) recipe.
- The SIWE domain the hosted service accepts: `paymaster.pepeunchained.com` (the `siweDomains` entry of `GET https://paymaster.pepeunchained.com/v2/config`). Export it as `PEPU_SIWE_DOMAIN`.

| Variable | Value | Secret? |
|---|---|---|
| `PRIVY_APP_ID` | Your Privy App ID, exactly as the dashboard shows it | No |
| `PRIVY_APP_SECRET` | Your Privy App Secret | Yes, server or CLI only |
| `PROJECT_OWNER_PRIVATE_KEY` | The owner wallet's key (the recipe's variable name) | Yes |
| `PEPU_SIWE_DOMAIN` | `paymaster.pepeunchained.com` | No |

## 1. Derive the project id

```ts
import { computeProjectId } from "@pepu-chain/sdk/paymaster";

const projectId = computeProjectId(process.env.PRIVY_APP_ID!); // keccak256(bytes(appId))
```

Use the app id **exactly** as the Privy dashboard shows it. It is case-sensitive: a different case is a different project.

## 2. Check who owns the project, then deposit (anyone can)

Depositing needs no approval and works before anyone claims the project. Funds in an unclaimed project are not spendable until it is claimed. Read the owner first: `address(0)` means unclaimed.

```ts
import { depositFor, readProject } from "@pepu-chain/sdk/paymaster";

const state = await readProject(publicClient, projectId, { paymaster });
// state.claimed is false for an unclaimed project

const hash = await depositFor({
  walletClient,
  publicClient,
  appId: process.env.PRIVY_APP_ID!,
  amountWei: 10n ** 18n,
  paymaster,
  // requireClaimed defaults to true: refuses an unclaimed project, which catches a mistyped app id.
  // Pass requireClaimed: false to fund a project before its owner claims it.
});
```

**One-way.** Nothing, not the owner, the contract owner nor the manager, can take a deposit back. It can only pay gas. A stranger funding your project cannot hurt you; they only add budget under your settings. Funds in a project that is never claimed stay locked.

## 3. Sign in and request an attestation (server or CLI only)

The attestation proves you control the Privy app. The service checks your secret against Privy once and never stores, logs or echoes it.

```ts
import { createPaymasterApi } from "@pepu-chain/sdk/paymaster";
import { requestClaimAttestation } from "@pepu-chain/sdk/paymaster/server"; // server only

const api = createPaymasterApi({ baseUrl: process.env.PEPU_PAYMASTER_URL! });

await api.v2.loginWithWallet((message) => account.signMessage({ message }), {
  address: account.address,
  domain: "paymaster.pepeunchained.com", // must be in the service's SIWE domains; see GET /v2/config
});

const verified = await requestClaimAttestation(api, {
  appId: process.env.PRIVY_APP_ID!,
  newOwner: account.address, // must equal the signed-in address
  privyAppSecret: process.env.PRIVY_APP_SECRET!,
});
// verified.action is "claimProject" (unclaimed) or "reclaimProject" (already owned)
```

Never call this from a browser; never use a `NEXT_PUBLIC_` variable for the secret. Rotate the secret in the Privy dashboard afterwards if you want to. The attestation expires within an hour and can be used once.

## 4. Claim on chain

```ts
import { encodeClaimFromVerification, sendPaymasterCalls } from "@pepu-chain/sdk/paymaster";

const claim = encodeClaimFromVerification(verified, { paymaster });
await sendPaymasterCalls(walletClient, [claim], { publicClient });
```

Anyone may submit the claim transaction; the attestation fixes the owner. **A project that holds no funds is claimed immediately. A project that already holds deposited funds is pending for the admin change delay (at least 48 hours):** the claim emits `ProjectClaimProposed`, the contract owner or manager can cancel it, and you (or anyone) finish it with `encodeExecuteReclaim(projectId)` after the delay (and within 30 days). To avoid the wait, claim before anyone funds the project. **The claim sets only the owner.** The project starts with an empty allowlist and a zero daily limit, so nothing is sponsorable yet. The MCP tool `pepu_prepare_project_tx` encodes the same transactions without sending anything.

## 5. Configure the allowlist and limits

```ts
import { configureProject, sendPaymasterCalls } from "@pepu-chain/sdk/paymaster";

const { calls } = configureProject({
  appId: process.env.PRIVY_APP_ID!,
  paymaster,
  targets: [tapScore],                 // 1 to 50 contracts to sponsor calls to
  dailyLimitWei: 100n * 10n ** 18n,     // project daily budget
  senderDailyLimitWei: 25n * 10n ** 18n, // per-wallet daily budget (above the ~21 PEPU first-operation reservation)
});
await sendPaymasterCalls(walletClient, calls, { publicClient });
```

That is `setTargets(allowed = true)`, `setDailyLimit` and `setSenderDailyLimit`, in order. All three must run before anything is sponsored: **a project with no per-wallet limit is rejected by the contract** (`ZeroDailyLimit`) however it is otherwise configured. A smart account can batch them into one operation. Size the per-wallet limit above the worst-case reservation of a user's first operation, which also deploys their account: about 12 PEPU for a plain sponsored send and about 21 PEPU (20.5) for the first operation of a Kernel session, or new users are denied on their first action. The project balance must also cover at least one reservation, so deposit at least about 25 PEPU before the first test; unused gas is refunded to the project. You can also set a gas-price cap (`setMaxFeePerGas`), pin the account codehash (`setRequiredAccountCodehash`) and pause (`setPaused`, instant; pausing is a project's exit). See [PepuSponsoredPaymasterV7 Contract](contracts.md).

## 6. Index the project and get credentials

```ts
const created = await api.v2.projects.register({
  appId: process.env.PRIVY_APP_ID!,
  allowedOrigins: ["https://app.example.com"],
});
// created.token (ppt_, publishable), created.paymasterUrl, created.serverKey (ppk_, secret): each shown once
```

**Save all three values immediately: each is shown once** (`rotateClientToken` and `rotateServerKey` issue new ones if you lose them). Paste `paymasterUrl` into Privy's "Paymaster URL" field if you use Privy Smart Wallets. Put the server key only in your backend. Without `allowedOrigins`, the client token cannot spend the project at all (`project_origin_not_allowed`). If Privy calls the URL from its own servers and that error appears, use the server key in the dashboard URL and keep it secret. Check state any time with `api.v2.projects.get(projectId)` and `readProject`.

## 7. Plug the credential into your app and check it

| Template | Credential | Where it goes |
|---|---|---|
| `sponsored-session-app` (and any server or bot using `/combo` or `createPepuSponsoredClient`) | The server key (`ppk_`) | `PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<server key>` in `.env.local`, server only. Leave `PEPU_BUNDLER_URL` as `https://bundler.pepeunchained.com` |
| `sponsored-demo` (Privy Smart Wallets) | The client token (`ppt_`) | The `paymasterUrl` from step 6 in the Privy dashboard, Smart Wallets, chain 97741. Allowed origins must include your app's origin |
| A browser using `useDirectSponsoredSend` | The client token (`ppt_`) | `NEXT_PUBLIC_PEPU_PAYMASTER_URL`, with allowed origins set |

Restart the dev server, then check:

```ts
// Check that a paymaster project is ready to sponsor: reachable services, claimed, limits set, funded.
// Read-only: sends nothing and needs no secrets. See docs/infra/paymaster/v2-register-deposit-claim.md
import { checkSponsorship, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { computeProjectId, readProject } from "@pepu-chain/sdk/paymaster";

export async function verifyProject(appId: string) {
  const publicClient = getPublicClient(pepuMainnet);
  const report = await checkSponsorship({ publicClient });
  if (!report.available) console.log(report.reason, report.fixes);

  const state = await readProject(publicClient, computeProjectId(appId));
  console.log(state.claimed, state.limitsConfigured, state.balance); // true, true, a positive balance
  return { available: report.available, ready: state.claimed && state.limitsConfigured && state.balance > 0n };
}
```

Success looks like `claimed: true`, `limitsConfigured: true` and a positive `balance`. Then a first sponsored transaction from a fresh account holding 0 PEPU goes through: the result's `paymaster` field is the v2 contract, and your project's balance drops by the gas it paid.

## Do it with an AI agent (MCP)

The MCP server (`@pepu-chain/mcp`) never signs and never sees your Privy secret. It does the parts that are pure encoding or reading, and tells you which steps still need your wallet or your script.

1. Ask: "Using the pepu MCP tools, walk me through claiming and funding a paymaster project for Privy app `<app id>`." The agent follows the `pepu-paymaster-projects` skill.
2. `pepu_project_balance` with your `appId` shows whether the project exists, who owns it and its balance. A zero-address owner means unclaimed.
3. Run the SIWE login and the attestation (steps 2 and 3) with the recipe script: they need your wallet and your Privy secret. The agent can write and set up the script from `pepu_sdk_snippet` (`v2-deposit-and-claim`), but you export the secrets.
4. `pepu_prepare_project_tx` with `action: "claim"` and the attestation, then `"configure"` (targets, `dailyLimitPepu`, `senderDailyLimitPepu`), then `"deposit"` (`amountPepu`) returns an unsigned `{ to, data, value }` for each. You send them from the owner wallet. The tool sends nothing.
5. Register (step 6) with the script, save the keys, then ask the agent to run `pepu_sponsorship_status` and `pepu_project_balance` for the final check.

## Rotation and the re-claim timelock

| Action | How | Effect |
|---|---|---|
| Rotate the client token | `api.v2.projects.rotateClientToken(projectId)` | Old token stops immediately; update the Dashboard URL |
| Rotate the server key | `api.v2.projects.rotateServerKey(projectId)` | Old key stops immediately |
| Change origins, per-user cap, `requireIdentity` | `api.v2.projects.updateSettings(projectId, ...)` | Off-chain settings |
| Lost the owner wallet | Repeat steps 3 and 4 from a new wallet: the result is `reclaimProject` | **Timelocked at least 48 hours**, announced by `ProjectReclaimProposed`, cancellable by the current owner (`encodeCancelReclaim`) **once per new owner** (a second attested re-claim by the same wallet cannot be cancelled), finished by anyone with `encodeExecuteReclaim`; lapses 30 days after it becomes executable |
| Hand over to a multisig | `encodeProposeProjectOwner`, then the new owner calls `encodeAcceptProjectOwnership` | Voluntary two-step transfer; clears any pending re-claim that the owner has not already vetoed once. A nomination can be withdrawn by proposing the zero address (prepare API) |
| Owner changed | Automatic | The previous owner's credentials are revoked (`project_owner_changed`); the new owner rotates |

Watch `ProjectReclaimProposed` (and the contract's `AdminChangeProposed`) and pause if something looks wrong. A re-claim proposed before a signer was removed never executes, even if that signer is re-added. Because ownership follows the Privy secret, rotate the secret after any recovery.

## What to expect

- Nothing is sponsored until step 5 is complete and the project has balance.
- Money leaves only as gas paid for sponsored operations.
- The policy signer is the ownership gatekeeper. A compromised signer could claim an **empty** unclaimed project immediately, and a funded one after the admin delay unless the contract owner or manager cancels it, so claim before anyone funds the project. It can never withdraw funds, because none can be withdrawn.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `CONFIG_MISSING_ENV` about the v2 paymaster address | A chain with no deployed v2 entry (testnet) | On mainnet use the registry address; elsewhere pass one explicitly |
| `PAYMASTER_PROJECT_NOT_CLAIMED` from `depositFor` | Project unclaimed, or the app id is mistyped (case-sensitive) | Check spelling; pass `requireClaimed: false` only on purpose |
| `403` from `verify` | Wrong secret, or `newOwner` is not the signed-in address | Fix and retry |
| Claim reverts with an expired or used claim | Attestation older than an hour, or already used | Request a new one |
| All denials after a claim | Allowlist and limits not set | Run step 5 |
| `409` from `register` | Not claimed on chain yet, or already indexed | Claim first; list with `api.v2.projects.list()` |
| `401 login_failed` at sign-in | The SIWE domain is not one the service accepts | Use `paymaster.pepeunchained.com`, or read `siweDomains` from `GET /v2/config` |
| `project_origin_not_allowed` in the app | A client token (`ppt_`) with no allowed origins, or used from a server | Pass `allowedOrigins` at register or `updateSettings`, or use the server key from a backend |
| Lost the keys shown at register | They are shown once | `rotateClientToken` or `rotateServerKey`, then update the app |

## Related

- [Paymaster Overview](overview.md)
- [REST API v2](rest-api-v2.md)
- [Credential Matrix](auth.md)
- [Deposit and Claim a Paymaster Project](../../recipes/v2-deposit-and-claim.md)
- [Sponsorship Tiers](../../onboarding/sponsorship-tiers.md)
- [Quickstart: Zero to a Sponsored Transaction in 10 Minutes](../../get-started/quickstart-app.md)
- [Smart Account Paths](../../concepts/smart-account-paths.md)
- [Paymaster v2 Spec Summary](../../contracts/paymaster-v2-spec.md)
