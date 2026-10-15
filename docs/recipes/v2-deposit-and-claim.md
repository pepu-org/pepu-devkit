# Recipe: Deposit and Claim a Paymaster Project

Register an app with the v2 tiered paymaster, claim its project on-chain, configure its limits and fund it. All with SDK helpers.

> Status: **proven on mainnet (canary, external audit pending).** The v2 paymaster is deployed at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`: deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches. The registry entry `paymasterV2` points at it, so the helpers default to it. Keep deposits small. The code below type-checks against the SDK and is covered by the SDK tests.

## Prerequisites

- The v2 paymaster address: the registry default, or read it from the policy service (`api.v2.contract()`).
- A Privy app. The project id is `keccak256(bytes(appId))`, case-sensitive.
- A wallet that will own the project, with PEPU for gas.
- The policy service, hosted at `https://paymaster.pepeunchained.com` (the SDK default; `PEPU_PAYMASTER_URL` overrides), and a SIWE domain it allows.
- A server or CLI. The claim call sends your Privy app secret to the service. Use a dedicated Privy app for sponsorship if you can, and rotate the secret afterwards.

## What to know first

- **Deposits are one-way.** There are no withdrawals. Pausing a project is the exit.
- **The claim sets the owner only.** Nothing is sponsored until the owner also calls `setTargets`, `setDailyLimit` and `setSenderDailyLimit`; the contract rejects a project with no per-wallet limit.
- **Claim before anyone funds the project.** An empty project is claimed at once; a project that already holds deposits is pending for the 48-hour admin delay and finished with `executeReclaim`.
- **A typo is expensive.** A mistyped app id makes a different project nobody can claim. `depositFor` refuses an unclaimed project unless you pass `requireClaimed: false`.
- **Free tier:** 100 PEPU per user per day and 50 PEPU per hour, only for users of PEPU's own Privy app, not available to third-party apps (their Privy token is ignored for billing). Your app uses a project.
- **Re-claims** of an owned project are timelocked 48 hours and can be cancelled by the owner once per new owner.

## Steps

1. Sign in to the policy service with the owner wallet (`api.v2.loginWithWallet`).
2. Prove control of the Privy app and get an attestation (`requestClaimAttestation`), then submit the claim (`encodeClaimFromVerification`, `sendPaymasterCalls`).
3. Configure the project with `configureProject`: targets, total daily limit and per-sender daily limit.
4. Fund it with `depositFor`.
5. Register the project with the service to get credentials (`api.v2.projects.register`). The client token (`ppt_`) is browser-safe and works only from the allowed origins you set (otherwise `project_origin_not_allowed`). The server key (`ppk_`) is secret and shown once.
6. Read the state back with `readProject` and build the ERC-7677 URL with `buildErc7677Url`.

```ts
// Register, claim, configure and fund a v2 paymaster project.
// PROVEN ON MAINNET AS A CANARY: internally reviewed 3x, external audit pending, funded in small tranches. Keep deposits small.
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

// The registry's paymasterV2 entry is the deployed canary; the helpers default to it. It is passed explicitly here
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

## What to expect

- After step 3, `readProject` reports `claimed: true` and `limitsConfigured: true`.
- Sponsorship then draws on the project's balance first, within the daily limits you set.
- A denied request returns a mapped `PepuPaymasterError` (`PAYMASTER_PROJECT_NOT_CLAIMED`, `PAYMASTER_CAP`, `PAYMASTER_DESTINATION_NOT_ALLOWED`, and so on).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `CONFIG_MISSING_ENV` "No v2 paymaster address" | An old SDK without the deployed registry entry, and no address was passed | Update the SDK, or pass `paymaster` |
| `PAYMASTER_PROJECT_NOT_CLAIMED` on deposit | Not claimed, or the app id is mistyped | Check the id's case; claim first |
| Claimed, but sponsorship is denied | `setTargets` or a limit was never set | Run `configureProject` |
| `PAYMASTER_SESSION_REQUIRED` | The SIWE session expired (one hour) | Call `loginWithWallet` again |
| `PAYMASTER_PROJECT_OWNER_CHANGED` | A re-claim completed | Check `readProject().owner` |

## Related

- [/paymaster](../sdk/paymaster.md)
- [Register, Deposit and Claim a v2 Project](../infra/paymaster/v2-register-deposit-claim.md)
- [Paymaster v2 Spec Summary](../contracts/paymaster-v2-spec.md)
- [Sponsorship Tiers](../onboarding/sponsorship-tiers.md)
