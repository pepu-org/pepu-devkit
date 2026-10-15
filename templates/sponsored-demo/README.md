# PEPU sponsored tap demo

The smallest honest browser proof that gas sponsorship works end to end on
Pepe Unchained V2 (chain 97741): sign in with Privy, get a Kernel smart
wallet holding **zero PEPU**, click one button to submit a real sponsored
`TapScore.tap()` UserOperation, and watch the paymaster's own EntryPoint
deposit actually drop. That drop, not the transaction alone, is the
evidence: a transaction succeeding proves nothing about who paid for it,
but a measured decrease in the paymaster's specific on-chain deposit can
only come from the EntryPoint deducting gas cost from it during that exact
UserOperation.

This is a demo, not a production starter. It intentionally does less than
`consumer-app` (no wagmi, no external-wallet connect, one screen) so the
sponsorship path is the only thing to look at.

## Status: hosted, proven, and what you must configure

- **Proven on the hosted URLs:** a project-sponsored UserOperation from a
  fresh Kernel account holding 0 PEPU went through
  `https://bundler.pepeunchained.com` and
  `https://paymaster.pepeunchained.com/v2/paymaster/<token>` on the v2
  paymaster (tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`,
  5.00 PEPU of gas including account deployment, paid by the paymaster). An
  earlier run on the v1 paymaster (tx
  `0x57cf2f5a332248476d775c096b4b8339d81867c14211ed3bc4fcb1895dff0f9f`) is
  history: v1 is retired.
- **The v2 paymaster is a canary:** internally reviewed 3 times, external audit
  pending, funded in small tranches. Do not describe it as audited.
- **Not yet run by a person in a browser:** this exact Privy Smart Wallets
  page against the hosted URLs has not been clicked through by a human.
- **You must bring a project.** The free tier (100 PEPU/day and 50 PEPU/hour
  per user, TapScore as the only free-tier target for now) needs a verified
  Privy access token from PEPU's own Privy app in the ERC-7677 context. The
  Privy Dashboard paymaster URL is static and cannot attach one, and a token
  from your own Privy app does not qualify, so this demo runs on **your
  project's** budget: claim, deposit, client token (below).

## Two different addresses

Signing in gives you **two** addresses, and the demo shows the second one:

- Your **embedded wallet** is an EOA that Privy creates for you. It only
  acts as the *signer* (owner) of your smart account.
- Your **Kernel smart account** is a separate contract account, controlled by
  that EOA, with its own address. This is the account that holds `0 PEPU`,
  sends the UserOperation, and shows up as the sender on pepuscan.

They are different addresses. Do not expect the smart account address to match
the embedded wallet address, and do not send funds to one expecting them at
the other.

## What this app needs from outside

The app itself only talks to Privy and to the PEPU RPC. Sponsored
transactions need two more services, configured in the Privy Dashboard:

1. **An ERC-4337 bundler** for chain 97741 (EntryPoint v0.7):
   `https://bundler.pepeunchained.com`.
2. **An ERC-7677 paymaster URL** for chain 97741, which decides which
   UserOperations to sponsor:
   `https://paymaster.pepeunchained.com/v2/paymaster/<token>`.

| Setting | Value |
| --- | --- |
| Chain ID | `97741` |
| Bundler URL | `https://bundler.pepeunchained.com` |
| Paymaster URL | `https://paymaster.pepeunchained.com/v2/paymaster/<token>`, with your project's token (it is a credential; treat the full URL as a secret) |
| Paymaster contract | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (v2 canary, public, on-chain; also the default for `NEXT_PUBLIC_PAYMASTER_CONTRACT_ADDRESS`) |

### Getting your project's token

1. Sign in to the paymaster service with SIWE (`/v2/auth/nonce`, `/v2/auth/login`).
2. `POST /v2/projects/verify` with your Privy app id and secret (used for one
   outbound request, never stored) to get a claim attestation.
3. `claimProject` on the v2 paymaster: immediate if the project is empty,
   pending 48 hours if it already holds funds.
4. `setTargets` (include TapScore), `setDailyLimit`, `setSenderDailyLimit`.
5. `depositFor` your project. Deposits are one-way (nobody can withdraw them)
   and the contract is a canary, so deposit small amounts.
6. Register the project with the service and copy its **client token**
   (`ppt_...`, browser-safe) and **server key** (`ppk_...`, secret). Set the
   project's **allowed origins**: a client token is refused with
   `project_origin_not_allowed` from any origin not on that list (and with no
   origins set).

The MCP tool `pepu_prepare_project_tx` encodes steps 3 to 5 without signing,
and the docs page "Register, deposit, claim" walks through them.

Which token goes into the Privy URL: Privy's smart-wallet client calls the
paymaster URL for you. Start with the client token and your origins set. If the
paymaster answers `project_origin_not_allowed` because Privy calls it from its
servers (no browser origin), use the server key and keep the URL secret. The
free tier cannot be used here, because it needs a Privy token from PEPU's own
Privy app in the ERC-7677 context and the Dashboard URL cannot attach one.

You can also run your own bundler and paymaster instead, as long as they
speak the two protocols above for chain 97741.

### Privy Dashboard setup

There is no smart-wallet config in this app's code. It is entirely
Dashboard-driven, and `SmartWalletsProvider` reads it from Privy at runtime.
In your own Privy app:

1. Go to **Settings -> Wallet infrastructure -> Smart wallets** and enable it.
2. Add chain **97741** (Pepe Unchained V2) and choose provider **Kernel**.
3. Set the **bundler URL** (`https://bundler.pepeunchained.com`) and the
   **paymaster URL** (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`)
   for that chain.

If this is off, the page spins forever on "Setting up your smart wallet..."
and the app cannot work around it.

Two more Dashboard settings from the Privy setup guide apply here too:
**Allowed origins** must contain the exact origin you run on (see "Port 3000
only" below), and **Automatically create embedded wallets on login** should be
on. This app also provisions the embedded wallet server-side as a fallback, in
case that setting is off (see `<WalletGate>` in `components/signed-in-view.tsx`).

### Allowlisted target

The paymaster only sponsors calls to allowed targets. This demo calls
`TapScore` (`0x261eA5971B93237a56990206A46Bc80318e4d078`, see
`lib/tapscore.ts`), which must be among your project's targets
(`setTargets`). TapScore is also the only free-tier target for now.

## Running it

```bash
npm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET
npm run dev                  # http://localhost:3000
```

### Port 3000 only

Run this app on **port 3000**. Privy's allowed origins match the exact
origin, including the port: `http://localhost:3000` is allowed, while
`http://localhost` (no port) is a different origin. Next.js silently falls
back to 3001 when 3000 is taken, and sign-in then fails. Free port 3000
before starting. If you must use another port, add that exact origin (for
example `http://localhost:3001`) to **Allowed origins** in your own Privy app
first.

## What you will see

1. **Sign in** with Google or email.
2. Wait for **"Setting up your wallet..."** to clear. This is
   `<WalletGate>` in `components/signed-in-view.tsx` provisioning your embedded wallet server-side
   (see its doc comment for why it skips Privy's client-side wallet-creation
   UI).
3. Wait for **"Setting up your smart wallet..."** to clear. This is
   `usePepuSmartAccount()` resolving your Kernel account from Privy's smart
   wallet client, which is configured by the Dashboard's bundler and paymaster
   settings for chain 97741. If it never clears, check the Dashboard setup
   above first.
4. You see your **Kernel smart account address** (not your embedded wallet
   address) and its **PEPU balance**. Expect exactly `0 PEPU`. That is
   deliberate, since this account has never held gas money.
5. Click **"Sponsor a tap"**. The app reads the paymaster's EntryPoint
   deposit (`getPaymasterDeposit`), submits `TapScore.tap()` as a sponsored
   UserOperation with `useSponsoredSend({ transport: "privy-smart-wallets" })`
   (Privy's smart-wallet client handles the paymaster and bundler calls against
   your Dashboard-configured URLs, and nothing in this app calls either service
   directly), waits for the receipt, then reads the deposit again.
6. Once it settles you see the **transaction hash** (linked to pepuscan) and a
   **before / after / drop** panel for the paymaster's deposit. A nonzero
   drop, from a wallet that paid zero, is the proof.

## Built on the SDK

| Job | `@pepu-chain/sdk` function |
|---|---|
| Privy provider (mainnet only, wallet creation off) with Smart Wallets nested inside | `PepuPrivyProvider`, `composeProviders` (`/privy/react`) |
| Provision the owner embedded wallet | `createEnsureWalletRoute` (`/privy/server`), `useEnsureWallet` (`/privy/react`) |
| The sponsored send (Privy Smart Wallets transport, no ZeroDev packages) | `useSponsoredSend({ transport: "privy-smart-wallets" })` (`/aa/react`) |
| The Kernel smart account address (distinct from the owner) | `usePepuSmartAccount` (`/aa/react`) |
| The proof: paymaster deposit before and after | `getPaymasterDeposit` (`/aa`) |
| Readable failures | `describeUserOpFailure` (`/aa`, applied inside `useSponsoredSend`) |
| "Is a bundler and paymaster configured and answering?" | `usePepuSponsorship` (`/aa/react`), which wraps `checkSponsorship` |
| Explorer links | `explorerLinks` |

Trust model: PEPU's paymaster (an ERC-7677 policy service plus an on-chain
deposit) pays the gas, and its allowlist decides which calls it sponsors. The
user's own wallet pays nothing. The service is hosted at
paymaster.pepeunchained.com and proven on mainnet; the v2 contract behind it is
a canary (internally reviewed 3 times, external audit pending, funded in small
tranches).

## Troubleshooting a paymaster denial

When a tap fails, the red box shows the error's `message` (the real reason from
the paymaster or bundler, with any token or key redacted), a `fix:` line, and a
stable `code`. The failure goes through `describeUserOpFailure`, so a denial
arrives as a typed error rather than Privy's own `[object Error]` log. Common
ones:

| `code` | Meaning | Fix |
|---|---|---|
| `PAYMASTER_DESTINATION_NOT_ALLOWED` | The call targets a contract not on the allowlist | Add `TapScore` (`lib/tapscore.ts`) to your project's targets with `setTargets` |
| `PAYMASTER_ORIGIN_NOT_ALLOWED` | The page's origin is not allowed | Allow the exact origin, port included (`http://localhost:3000`) |
| `PAYMASTER_DENIED` (also `AA32`-`AA34`) | The credential or sender was rejected, or the policy signer does not match the paymaster contract | Check the paymaster URL's app key in the Dashboard and that the smart account belongs to the signed-in user |
| `PAYMASTER_NO_BALANCE` (also `AA31`) | The paymaster's EntryPoint deposit cannot cover the op | Deposit PEPU to the paymaster contract; the deposit panel's "before" value shows the balance |
| `PAYMASTER_CAP` | A daily, per-sender or per-op cap was hit | Wait for the window to reset, or raise the limits |
| `BUNDLER_AA_FAILED` (`AA25`) | Invalid nonce: another UserOperation from this account is pending | Wait for it to confirm, then retry |
| `BUNDLER_UNREACHABLE` or the Dashboard spinner never clears | The bundler or paymaster URL is unset or wrong | Set both for chain 97741 in the Privy Dashboard (see "Privy Dashboard setup") |

The red box also reports, when the check does not pass, a direct probe of
`PEPU_BUNDLER_URL` / `PEPU_PAYMASTER_URL` (`checkSponsorship`). Treat that line
as a hint, not a verdict: with the Privy Smart Wallets transport the working URLs
live in the Dashboard, so it will say "not configured" on a correctly
configured Dashboard unless you also export those variables.

## Idempotency

- **One tap, one UserOperation.** `useSponsoredSend` allows one send at a time
  (a second call while one is in flight is rejected), and this component
  also guards the click synchronously, so a double click cannot submit twice.
- **A retry never replays.** "Try again" builds a fresh UserOperation with the
  account's next nonce; a failed or denied operation is never re-sent. If an
  earlier operation is still pending the bundler answers `AA25` (invalid
  nonce): wait for it, then retry.
- **Wallet provisioning is idempotent too.** `createEnsureWalletRoute` looks
  for an existing wallet first and re-checks after a failed create, so a double
  submit never makes a second wallet.
- **The proof is not idempotent by design.** Each tap spends real paymaster
  deposit; the before/after panel reflects that one run only.

## What this does NOT do

- No wagmi and no external-wallet connect (MetaMask etc.). One login surface,
  kept narrow on purpose.
- No retry or backoff. A failed tap shows the typed error and lets you press the
  button again.
- No separate "waiting for confirmation" step: `useSponsoredSend` returns once
  the UserOperation is included, so the button shows "Submitting sponsored
  UserOperation…" through both.

## Design

Dark theme, PEPU green for actions, one lime accent, Grandstander for
headings, derived from pepeunchained.com's own stylesheet. All tokens and
component classes (`btn`, `card`, `notice`, `input`, `chip`, `spinner`,
`skeleton`...) live in one file, `app/pepu-design.css`, which is identical in
every PEPU template. Motion respects `prefers-reduced-motion`. The PEPU mark
is in `public/pepu-logo.svg`.
