---
name: pepu-sponsored-transactions
description: Gas-sponsored (gasless) transactions on Pepe Unchained (PEPU) V2 mainnet (chain 97741) with a Kernel v3.1 smart account, an ERC-4337 EntryPoint v0.7 bundler and an ERC-7677 paymaster, built from @pepu-chain/sdk: useSponsoredSend, usePepuSmartAccount, usePepuSponsorship (/aa/react), createPepuSponsoredClient, sendSponsored, toPepuKernelAccount (/aa/kernel), checkSponsorship, probeBundler, probePaymaster, describeUserOpFailure (/aa). Covers both transports (Privy Smart Wallets vs direct bundler and paymaster URLs), Privy dashboard fields, the two-address model, and troubleshooting. Sponsorship status is live-checked, never assumed. Use for gasless, paymaster, bundler, UserOperation, smart-account sends. For popup-free sessions on top, see pepu-sponsored-session.
---

# Sponsored transactions on PEPU

Pillar 3: a user with a zero PEPU balance sends a transaction and a paymaster pays the gas. Sponsorship runs through the hosted URLs: `https://bundler.pepeunchained.com` and `https://paymaster.pepeunchained.com/v2/paymaster/<token>` on the v2 paymaster. Deposits to the v2 paymaster are one-way.

## When to use

- The user asks for gasless, "no gas for my users", paymaster, bundler, smart account, UserOperation.
- You need the SDK path to send a sponsored call from a component, a route or a script.

**Do not assume a given app is sponsored.** Call `pepu_sponsorship_status` first and report the answer. The bundler defaults to `https://bundler.pepeunchained.com` (SDK `PEPU_HOSTED`). The paymaster URL always embeds a token, so the app sets `PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<token>` (or `paymasterToken` to `createPepuPaymasterClient`), or enters that URL in the Privy dashboard (transport 1). What token:

- **Your project's client token (`ppt_`)** works only from the project's allowed origins; with none set the paymaster refuses it with `project_origin_not_allowed`.
- **Your project's server key (`ppk_`)** for server-side callers (session routes, scripts). Secret.
- **Free tier:** PEPU funds 100 PEPU/day and 50 PEPU/hour per user, but it needs a verified Privy access token from PEPU's own Privy app in the ERC-7677 `context.privyAccessToken` (the SDK's direct transport and the combo routes already forward the signed-in user's token), and today the only free-tier target is TapScore. A third-party app's own Privy token does not qualify, and Privy's dashboard URL cannot attach a token at all.
- **Your own project:** claim, deposit, set limits, register (see `pepu-paymaster-projects`).

Never write "free" for a send the status check does not confirm.

Two smart-account paths exist: `useSponsoredSend` with `privy-smart-wallets` (Path 2, Privy builds the Kernel account, needs the Smart Wallets dashboard setting, no free tier, no sessions) and `useDirectSponsoredSend` / `/aa/kernel` (Path 1, ZeroDev-native, SDK-built). Choose with the guide: https://docs.pepeunchained.com/concepts/smart-account-paths.

## Chain facts

Chain 97741, EntryPoint v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, Kernel v3.1 stack and the v2 paymaster are deployed; the v1 paymaster is retired.
The generated table is in [reference/chain-facts.md](reference/chain-facts.md); rules in [reference/rules.md](reference/rules.md); the two sponsorship tiers in [reference/sponsorship-tiers.md](reference/sponsorship-tiers.md); running your own bundler and paymaster: [reference/self-hosting.md](reference/self-hosting.md).

## SDK functions to use

```ts
// browser
import { useSponsoredSend, usePepuSmartAccount, usePepuSponsorship } from "@pepu-chain/sdk/aa/react";
// server or script
import { toPepuKernelAccount, createPepuSponsoredClient, sendSponsored, getKernelAddress } from "@pepu-chain/sdk/aa/kernel";
import { checkSponsorship, probeBundler, probePaymaster, describeUserOpFailure, getPaymasterDeposit } from "@pepu-chain/sdk/aa";
// core
import { getPublicClient, pepuMainnet, resolvePepuEndpoints, buildPaymasterContext, explorerLinks } from "@pepu-chain/sdk";
// Privy Smart Wallets transport only
import { composeProviders } from "@pepu-chain/sdk/privy/react";
```

Peers: `@zerodev/sdk`, `@zerodev/ecdsa-validator`, `@privy-io/react-auth`, `viem`. A `Call` is `{ to, abi, functionName, args? }` or `{ to, data, value? }`; the SDK encodes it.

## MCP tools to call first

1. `pepu_sponsorship_status` (optional `bundlerUrl`, `paymasterUrl`, `include_deposit`): `available`, reason, fixes, paymaster deposit.
2. `pepu_bundler_health` and `pepu_paymaster_health`: chain id, entry points, methods, latency, the ERC-7677 route check (a structured JSON-RPC error without a client token still means the route is up).
3. `pepu_check_env` with `template: "sponsored-demo"` or `pillars: ["sponsorship"]`; `pepu_check_privy_config` with `pillars: ["sponsor"]`.
4. `pepu_sdk_snippet` with `task: "sponsored-send"`, `"sponsored-send-server"` or `"check-sponsorship"`. After a send: `pepu_explain_tx`.

## Steps

### 1. Choose a transport

| | `"privy-smart-wallets"` (`/aa/react`, default) | direct (`/aa/react-direct`) |
|---|---|---|
| Who builds the Kernel account | Privy's smart-wallet client | the SDK (`toPepuKernelAccount`) |
| Where the URLs live | Privy dashboard, Smart wallets | env (`PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL`) or options |
| Free tier | handled by your paymaster policy | the SDK passes the user's Privy access token as paymaster context |
| Best for | the quickest browser path, URLs stay out of your bundle | server routes, scripts, your own policy |

### 2a. Privy Smart Wallets transport

Dashboard (the user does this): **Wallets, Smart wallets**:

| Field | Value |
|---|---|
| Enable smart wallets | on |
| Smart wallet implementation | Kernel (ZeroDev) |
| Chain | add PEPU, chain id `97741` |
| Bundler URL | `https://bundler.pepeunchained.com` (chain 97741, EntryPoint v0.7) |
| Paymaster URL | `https://paymaster.pepeunchained.com/v2/paymaster/<token>` with your project's token (it embeds a credential, treat it as a secret; try the client token with allowed origins set first, use the server key if the paymaster answers `project_origin_not_allowed`) |

Do NOT use Privy's `sponsor: true` flag: that is Privy's managed-chain infrastructure and PEPU is not in it.
If the Smart wallets section is off, the smart wallet never resolves. `pepu_check_privy_config` reports the row `smart-wallets`.

```tsx
// app/providers.tsx
"use client";
import type { ReactNode } from "react";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { PepuPrivyProvider, WalletGate, composeProviders } from "@pepu-chain/sdk/privy/react";

// Build once at module level so the wrapper keeps one component identity across renders.
const WithSmartWallets = composeProviders([[SmartWalletsProvider, {}]]);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PepuPrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{ loginMethods: ["google", "email"] }}
      wrapper={WithSmartWallets}
    >
      <WalletGate>{children}</WalletGate>
    </PepuPrivyProvider>
  );
}
```

Also add `app/api/wallet/ensure/route.ts` from `pepu-onboarding-privy`. Install `@zerodev/sdk` and `@zerodev/ecdsa-validator`.

### 2b. Direct transport

```
PEPU_BUNDLER_URL=<PEPU_BUNDLER_URL>
PEPU_PAYMASTER_URL=<PEPU_PAYMASTER_URL>
# local development defaults used by the PEPU services: http://localhost:4337 and http://localhost:8788
```

Server-side code reads these from `process.env` itself. In the **browser** frameworks only inline literal `process.env.NEXT_PUBLIC_*`, so pass the URLs as options, and state the exposure:
a paymaster URL embeds a credential, so putting it in a client bundle reveals it. Prefer transport 1, or run the send from a server route.

### 3. Send from a component

```tsx
"use client";
import { useSponsoredSend, usePepuSmartAccount, usePepuSponsorship } from "@pepu-chain/sdk/aa/react";
import type { Abi, Address } from "viem";

const tapScoreAbi = [{ type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const satisfies Abi;
const TAP_SCORE = process.env.NEXT_PUBLIC_GAME_CONTRACT_ADDRESS as Address;

export function SponsoredTap() {
  const { owner, smartAccount } = usePepuSmartAccount();                 // two addresses: owner signs, smartAccount sends
  const sponsorship = usePepuSponsorship({ pollMs: 15_000 });            // live probe; never assume
  const { send, status, result, error } = useSponsoredSend({ transport: "privy-smart-wallets" });

  if (!sponsorship.loading && !sponsorship.available && !smartAccount) return <p>{sponsorship.reason}</p>;
  return (
    <>
      <p>Smart account {smartAccount} (owner {owner})</p>
      <button
        disabled={status === "signing" || status === "submitting"}
        onClick={() => void send([{ to: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }]).catch(() => undefined)}
      >
        Tap
      </button>
      {result && <a href={result.explorerUrl}>done, paid by {result.paymaster ?? "the account itself"}</a>}
      {error && <p>{error.message} {error.hint}</p>}
    </>
  );
}
```

`usePepuSponsorship` probes the direct URLs (`checkSponsorship`); with transport 1 the URLs live in Privy, so treat its result as advisory and decide by the send.
`useSponsoredSend` allows one send at a time, waits for the receipt and maps every failure to a typed `PepuError` through `describeUserOpFailure`
(secrets redacted). For the direct transport (needs `@zerodev/sdk` and `@zerodev/ecdsa-validator`):
`useDirectSponsoredSend({ bundlerUrl, paymasterUrl })` from `@pepu-chain/sdk/aa/react-direct`.

### 4. Send from a server route or script

```ts
import { privateKeyToAccount } from "viem/accounts";
import { getPublicClient, pepuMainnet, buildPaymasterContext } from "@pepu-chain/sdk";
import { toPepuKernelAccount, createPepuSponsoredClient, sendSponsored } from "@pepu-chain/sdk/aa/kernel";
import type { Abi } from "viem";

const tapScoreAbi = [{ type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const satisfies Abi;

const publicClient = getPublicClient(pepuMainnet);
const account = await toPepuKernelAccount({
  publicClient,
  owner: privateKeyToAccount(process.env.OWNER_KEY as `0x${string}`), // a dev key; in an app the owner is the user's embedded wallet
});
const client = createPepuSponsoredClient({
  account,
  publicClient,
  // bundler and paymaster URLs come from PEPU_BUNDLER_URL / PEPU_PAYMASTER_URL
  paymasterContext: buildPaymasterContext({ privyAccessToken: process.env.PRIVY_ACCESS_TOKEN }), // free tier needs the user's token
});

const r = await sendSponsored({
  client,
  calls: [{ to: "0x261eA5971B93237a56990206A46Bc80318e4d078", abi: tapScoreAbi, functionName: "tap" }],
});
console.log(r.success, r.paymaster, r.actualGasCostWei, r.explorerUrl);
```

`sendSponsored` encodes the calls (batch several), sends one UserOperation, waits for the receipt and reports who paid. `r.paymaster !== null` is the proof the gas was sponsored.

### 5. Availability check you can run anywhere

```ts
import { checkSponsorship, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";

const s = await checkSponsorship({ publicClient: getPublicClient(pepuMainnet) });
if (!s.available) console.log(s.reason, s.fixes); // concrete next steps, no secrets
```

`checkSponsorship` is also exported from `@pepu-chain/sdk/aa`. It never throws for an unreachable service: it returns `available: false` with `fixes`. An empty paymaster deposit also makes it unavailable.

## Who pays and the two-address model

- A user has an **owner** (the Privy embedded EOA that signs) and a **smart account** (a Kernel account at a different address that sends, holds assets and appears on pepuscan).
  Show the smart account address. Never tell a user to send funds to the owner expecting them at the smart account, or the reverse.
- Tiers (see [reference/sponsorship-tiers.md](reference/sponsorship-tiers.md)): the v2 paymaster (chain-funded free tier plus project deposits) is deployed; v1 is retired. Read `pepu-paymaster-projects` for projects.

## Verify

1. `pepu_sponsorship_status` returns `available: true`, or tell the user precisely what `fixes` says.
2. `pepu_bundler_health` and `pepu_paymaster_health` are healthy.
3. Send once. `result.paymaster` is set, the smart account's balance did not move, and `pepu_explain_tx` with `result.transactionHash` shows the paymaster paid.
4. `npm run typecheck && npm run build`.

## Pitfalls

- **`PAYMASTER_DESTINATION_NOT_ALLOWED`:** the paymaster policy does not sponsor that target. Add the contract to the project's targets (v2: `setTargets`; v1: the service's policy config). Owner-signed calls to the user's own account (for example uninstalling a session) are not sponsored.
- **`PAYMASTER_DENIED`:** check the app credential or token and that the smart account belongs to the user whose access token was sent.
- **`PAYMASTER_IDENTITY_REQUIRED`:** the free tier needs the user's Privy access token. Use `useSponsoredSend` (it passes it) or `buildPaymasterContext({ privyAccessToken })`.
- **`PAYMASTER_NO_BALANCE`, `PAYMASTER_CAP`:** no balance or a cap was reached (v2 projects). **`BUNDLER_AA_FAILED`:** read the AAxx code: AA21 prefund missing, AA23 signature or validation reverted, AA25 invalid nonce, AA31/AA33/AA34 paymaster problems. `getPaymasterDeposit(publicClient)` reads the v1 paymaster's EntryPoint deposit.
- **`BUNDLER_UNREACHABLE` / `PAYMASTER_UNREACHABLE`:** a URL is wrong or the service is not running; `checkSponsorship()` says which.
- **`CONFIG_MISSING_ENV`:** no bundler or paymaster URL. Set `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` (or the Privy dashboard fields).
- **Smart wallet never resolves (transport 1):** Smart wallets is off in the dashboard, chain 97741 is missing, or a URL is empty.
- **Fees:** the SDK takes fees from the chain with 20% headroom (`estimatePepuUserOpFees`); do not hard-code gas values. The base fee is about 12,500 gwei, which is normal on PEPU.
- Use `pepu_explain_error` (SDK `explainError`) on the exact message, and `describeUserOpFailure(e)` to turn a raw bundler error into a typed one.

## Never hand-roll

Do not write JSON-RPC calls to a bundler or paymaster, UserOperation packing or gas estimation, Kernel account construction, `pm_getPaymasterData` plumbing, AAxx error parsing, or "is the paymaster up" probes.
Use `useSponsoredSend`, `sendSponsored`, `createPepuSponsoredClient`, `toPepuKernelAccount`, `checkSponsorship`, `describeUserOpFailure`. See [reference/rules.md](reference/rules.md).

Reference app: `templates/sponsored-demo`. To add popup-free sessions on top of sponsorship, go to `pepu-sponsored-session`.
