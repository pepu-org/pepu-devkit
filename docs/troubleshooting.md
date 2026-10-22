# Troubleshooting

Symptoms you can hit while building on Pepe Unchained V2, grouped by the three pillars (Google to wallet, session keys, sponsored transactions), their combination, and the infrastructure underneath. Every entry names the cause and the fix, and links to the error code the SDK raises for it. Start with the section that matches what you were doing.

Error codes link to the generated [Error Reference](reference/errors.md), which is checked against the code in CI. Mainnet only (chain `97741`).

## Prerequisites

- Paste the error text into the MCP tool `pepu_explain_error` (or `explainError` from `@pepu-chain/sdk`) to get its catalog entry directly. `pepu_known_gotchas` lists the chain-level traps below.
- Run `npm run doctor` in a scaffolded app, or the MCP tools `pepu_check_env` and `pepu_check_privy_config`, before debugging by hand. They check the env, the RPC and the Privy dashboard settings without printing secrets.

## How to read an error code

A `PepuError` carries `code`, `hint` and `docsUrl`; the URL is `https://docs.pepeunchained.com/reference/errors#<CODE>`. The codes in this page link to the same entries.

| Area | Codes |
|---|---|
| Configuration | [`CONFIG_MISSING_ENV`](reference/errors.md#CONFIG_MISSING_ENV), [`CONFIG_BAD_URL`](reference/errors.md#CONFIG_BAD_URL), [`CONFIG_SERVER_ONLY`](reference/errors.md#CONFIG_SERVER_ONLY) |
| Pillar 1, Google to wallet | [`CONFIG_PRIVY_DASHBOARD`](reference/errors.md#CONFIG_PRIVY_DASHBOARD), [`CONFIG_ORIGIN_MISMATCH`](reference/errors.md#CONFIG_ORIGIN_MISMATCH), [`CONFIG_PRIVY_CREATE_ON_LOGIN`](reference/errors.md#CONFIG_PRIVY_CREATE_ON_LOGIN), [`WALLET_NOT_PROVISIONED`](reference/errors.md#WALLET_NOT_PROVISIONED), [`WALLET_INJECTED_ACTIVE`](reference/errors.md#WALLET_INJECTED_ACTIVE), [`WALLET_COINBASE_UNSUPPORTED_CHAIN`](reference/errors.md#WALLET_COINBASE_UNSUPPORTED_CHAIN), [`AUTH_INVALID_TOKEN`](reference/errors.md#AUTH_INVALID_TOKEN) |
| Pillar 2, session keys | [`POLICY_UNSCOPED`](reference/errors.md#POLICY_UNSCOPED), [`POLICY_NAME_TOO_LONG`](reference/errors.md#POLICY_NAME_TOO_LONG), [`SESSION_NONE`](reference/errors.md#SESSION_NONE), [`SESSION_EXPIRED`](reference/errors.md#SESSION_EXPIRED), [`SESSION_APPROVAL_MISMATCH`](reference/errors.md#SESSION_APPROVAL_MISMATCH), [`PRIVY_KEY_QUORUM_MISMATCH`](reference/errors.md#PRIVY_KEY_QUORUM_MISMATCH), [`PRIVY_CHAIN_REJECTED_97741`](reference/errors.md#PRIVY_CHAIN_REJECTED_97741) |
| Pillar 3, sponsored transactions | [`PAYMASTER_DENIED`](reference/errors.md#PAYMASTER_DENIED), [`PAYMASTER_CAP`](reference/errors.md#PAYMASTER_CAP), [`PAYMASTER_NO_BALANCE`](reference/errors.md#PAYMASTER_NO_BALANCE), [`PAYMASTER_DESTINATION_NOT_ALLOWED`](reference/errors.md#PAYMASTER_DESTINATION_NOT_ALLOWED), [`PAYMASTER_ORIGIN_NOT_ALLOWED`](reference/errors.md#PAYMASTER_ORIGIN_NOT_ALLOWED), [`PAYMASTER_IDENTITY_REQUIRED`](reference/errors.md#PAYMASTER_IDENTITY_REQUIRED), [`PAYMASTER_RATE_LIMITED`](reference/errors.md#PAYMASTER_RATE_LIMITED), [`PAYMASTER_API_ERROR`](reference/errors.md#PAYMASTER_API_ERROR) |
| v2 projects | [`PAYMASTER_PROJECT_NOT_CLAIMED`](reference/errors.md#PAYMASTER_PROJECT_NOT_CLAIMED), [`PAYMASTER_PROJECT_OWNER_CHANGED`](reference/errors.md#PAYMASTER_PROJECT_OWNER_CHANGED), [`PAYMASTER_PROJECT_PAUSED`](reference/errors.md#PAYMASTER_PROJECT_PAUSED), [`PAYMASTER_FREE_TIER_UNAVAILABLE`](reference/errors.md#PAYMASTER_FREE_TIER_UNAVAILABLE), [`PAYMASTER_SESSION_REQUIRED`](reference/errors.md#PAYMASTER_SESSION_REQUIRED) |
| Infrastructure | [`BUNDLER_UNREACHABLE`](reference/errors.md#BUNDLER_UNREACHABLE), [`PAYMASTER_UNREACHABLE`](reference/errors.md#PAYMASTER_UNREACHABLE), [`BUNDLER_AA_FAILED`](reference/errors.md#BUNDLER_AA_FAILED) |
| Transactions and chain | [`TX_REVERTED`](reference/errors.md#TX_REVERTED), [`TX_NONCE_RACE`](reference/errors.md#TX_NONCE_RACE), [`TX_GAS_UNDERSHOOT`](reference/errors.md#TX_GAS_UNDERSHOOT), [`MULTICALL3_CANONICAL_ADDRESS`](reference/errors.md#MULTICALL3_CANONICAL_ADDRESS), [`UNKNOWN`](reference/errors.md#UNKNOWN) |

## Chain, RPC and tooling

### "My batched reads are failing or returning nothing"

Code: [`MULTICALL3_CANONICAL_ADDRESS`](reference/errors.md#MULTICALL3_CANONICAL_ADDRESS).

**You are almost certainly hitting the Multicall3 trap.** PEPU has Multicall3 deployed, but not at the canonical address (`0xcA11bde05977b3631167028862bE2a173976CA11`) that viem, wagmi and most tooling assume by default. That address has no code on this chain; calls routed through it return empty data or a "no code" error that never mentions Multicall3.

Fix: use `@pepu-chain/sdk`'s `pepuMainnet`, which already points at PEPU's Multicall3 (`0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`), or set `contracts.multicall3.address` to that value. Full explanation: [The Multicall3 Trap](contracts/multicall3.md).

### "The gas price looks insane: thousands of gwei"

Code: [`TX_GAS_UNDERSHOOT`](reference/errors.md#TX_GAS_UNDERSHOOT) when you under-set it.

**Expected, not a bug.** PEPU's base fee normally sits around 12,500 gwei, versus roughly 0.01 to 0.1 gwei on Arbitrum One. PEPU's per-token USD price is very low, so the chain needs a much larger wei-per-gas number to recover the same real-dollar cost, including the L1 data-posting cost every Orbit chain pays.

Do not hardcode a lower gas price: your transactions will get stuck and look like a different, harder failure. Let automatic gas estimation work (Foundry and Hardhat both do), and add headroom with `withGasLimitBuffer()` from `@pepu-chain/sdk/session` when you submit your own transactions. A simple transfer still costs a fraction of a cent.

### "My RPC calls are rate-limited or rejected"

The public RPC (`https://rpc-pepu-v2-mainnet-0.t.conduit.xyz`) rate-limits (`-32017`) and gates `debug_*` and `trace_*` methods behind an authenticated Conduit API key (`-32401`). It also caps `eth_getLogs` to a **2,000-block range**; a wider range throws `-32602`, so paginate.

For `debug_traceCall`, `eth_simulateV1` or higher limits, use an authenticated Conduit RPC URL (`https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/<API_KEY>`). See [Network Reference](get-started/network-reference.md#authenticated-rpc). There is no WebSocket RPC, even on the authenticated tier, so do not build an `eth_subscribe` flow.

### "`forge` behaves strangely or compiles differently than expected"

**Check whether your `forge` is upstream Foundry.** [`foundry-zksync`](https://github.com/matter-labs/foundry-zksync) installs to the same `~/.foundry` location and overwrites the `forge` and `cast` binaries on `PATH`. If a machine has ever run `foundryup-zksync`, `forge` may be the zkSync fork, which produces wrong results against an Arbitrum Orbit chain.

```bash
forge --version
```

If the output mentions zksync anywhere, reinstall upstream Foundry (`foundryup`) or point your scripts at an upstream binary. See [Deploy and Verify a Contract](contracts/deployment.md).

### "I cannot find or fund a wallet on testnet"

**Testnet (chain `97740`) is out of scope.** There is no public faucet, no indexed explorer and none of PEPU's deployed infrastructure there. Build against mainnet; a transaction costs a fraction of a cent. See [Network Reference](get-started/network-reference.md#testnet-out-of-scope-today).

### "Am I looking at the right chain?"

Two unrelated chains share the "Pepe Unchained" name. **V1** (chain ID `3409`, OP Stack) is dead; its legacy claims portal closed 2026-01-31. **V2** (chain ID `97741` mainnet, Arbitrum Orbit) is the current chain and the only one these docs cover. If you found chain ID `3409` or an OP Stack reference, you are reading V1 history. See [V1 vs V2](get-started/v1-vs-v2.md).

### "The explorer does not have the data I expect"

`pepuscan.com` is a fully indexed Blockscout instance: use it for address history, token analytics, contract verification and its API. The Conduit-bundled `explorer-pepu-v2-*.t.conduit.xyz` explorer self-reports no indexer and shows only single blocks and transactions by hash. Point explorer-API tooling at `pepuscan.com`. See [Endpoints](reference/endpoints.md).

### "npx create-pepu-app or npm install says the package was not found"

Check the spelling. The scope is `@pepu-chain` (not `@pepu`), the CLI is the unscoped `create-pepu-app`, and the MCP server is `@pepu-chain/mcp`. Use `npx create-pepu-app@latest` to bypass a stale npx cache, confirm `npm config get registry` is the public npm registry, and use Node.js 18.17 or newer. See [Quickstart](get-started/quickstart-app.md).

### "Missing environment variable" or "Invalid endpoint URL"

Codes: [`CONFIG_MISSING_ENV`](reference/errors.md#CONFIG_MISSING_ENV), [`CONFIG_BAD_URL`](reference/errors.md#CONFIG_BAD_URL), [`CONFIG_SERVER_ONLY`](reference/errors.md#CONFIG_SERVER_ONLY).

Set the variables the message names (it names them, never their values) in `.env.local` and restart the dev server, since Next.js reads the file once at startup. A bundler, paymaster or RPC URL must be a full http(s) URL. `CONFIG_SERVER_ONLY` means a server entry (for example `/privy/server`) was imported into client code; import it only from route handlers and scripts. See [Environment Variables](reference/env-vars.md).

## Pillar 1: Google to wallet

Full explanations are on [Privy Setup Walkthrough](onboarding/privy-setup.md) and [Dashboard Settings, Field by Field](privy/dashboard-settings.md).

### "Login fails: the login iframe is blocked, OAuth returns 403"

Codes: [`CONFIG_ORIGIN_MISMATCH`](reference/errors.md#CONFIG_ORIGIN_MISMATCH), [`CONFIG_PRIVY_DASHBOARD`](reference/errors.md#CONFIG_PRIVY_DASHBOARD).

**Almost always the allowed origin, and specifically the port.** Privy's **Allowed origins** list matches the full origin including the port. `http://localhost:3000` matches; `http://localhost` does not. If port 3000 is busy, Next.js silently starts on 3001 and login fails with errors that never mention the port. Free port 3000, or add the exact origin you run on. The doctor checks this when you pass an origin: `npm run doctor` uses `http://localhost:3000` (set `PEPU_APP_ORIGIN` for another port), and `runDoctor({ origin })` does the same in code.

### "Creating your wallet..." never finishes, or the user has no wallet

Codes: [`CONFIG_PRIVY_CREATE_ON_LOGIN`](reference/errors.md#CONFIG_PRIVY_CREATE_ON_LOGIN), [`WALLET_NOT_PROVISIONED`](reference/errors.md#WALLET_NOT_PROVISIONED).

Turn on **Automatically create embedded wallets on login** in the Privy Dashboard; the `createOnLogin` value in your code does not override it. Check that `PRIVY_APP_SECRET` is set (the templates create the wallet server-side as a fallback) and restart after any `.env.local` change. See [Privy Setup Walkthrough](onboarding/privy-setup.md#automatically-create-embedded-wallets-on-login). If Privy's own modal hangs, set `createOnLogin: "off"` and provision the wallet yourself: [Provision the Wallet and Pin the Active Account](recipes/provision-and-pin-the-wallet.md).

### "The configured chains are not supported by Coinbase Smart Wallet: 97741"

Code: [`WALLET_COINBASE_UNSUPPORTED_CHAIN`](reference/errors.md#WALLET_COINBASE_UNSUPPORTED_CHAIN).

Coinbase's smart wallet does not support chain 97741. Pin the connector to `eoaOnly` with `createPepuPrivyConfig()` from `@pepu-chain/sdk/privy`, or set `externalWallets: { coinbaseWallet: { config: { preference: { options: "eoaOnly" } } } }`.

### "A browser extension wallet is the active account"

Code: [`WALLET_INJECTED_ACTIVE`](reference/errors.md#WALLET_INJECTED_ACTIVE).

wagmi picked an injected wallet instead of the Privy embedded wallet. Pin the embedded wallet with `useActiveWalletPin()` from `@pepu-chain/sdk/privy/wagmi`. See [Provision the Wallet and Pin the Active Account](recipes/provision-and-pin-the-wallet.md).

### "401 from my API route after login"

Code: [`AUTH_INVALID_TOKEN`](reference/errors.md#AUTH_INVALID_TOKEN).

The request carried no bearer token, or Privy could not verify it. Send `Authorization: Bearer <getAccessToken()>` and verify the token server-side with the app secret.

### "Unable to fetch token price" in the browser console

Harmless. Privy cannot fetch a fiat price for PEPU. It does not affect login, wallets or transactions.

### "Privy refuses a transfer my wallet can afford"

Privy's pre-flight gas estimate in its confirmation modal is conservative, and PEPU's base fee makes it large enough to block a transfer the wallet could pay for. You cannot change that check from your app. The `consumer-app` template has no "Max" button for this reason. If your app submits transactions itself, `maxSendableAmount` in [`@pepu-chain/sdk`](sdk/core.md#gas-and-fees) sizes a transfer correctly.

### "Unsupported chain with id 97741" from Privy's server-side API

Code: [`PRIVY_CHAIN_REJECTED_97741`](reference/errors.md#PRIVY_CHAIN_REJECTED_97741).

Privy's server-side `eth_sendTransaction` does not support PEPU. This is a platform limitation, not a mistake in your request. Sign with `eth_signTransaction` and broadcast through PEPU's RPC (`signAndBroadcast` from `@pepu-chain/sdk/session`). See [Sign with Privy, Broadcast Yourself](recipes/sign-with-privy-broadcast-yourself.md).

### "The address I see in Privy is not the address on pepuscan"

With sponsorship, the account that transacts is a Kernel smart account at a different address from the embedded wallet. See [The Two-Address Model](onboarding/two-address-model.md).

## Pillar 2: Session keys

See [Session Keys: No Popup Per Transaction](onboarding/session-keys.md) and [Authorization Keys and Key Quorums](privy/authorization-keys.md).

### "My session signer's transactions are all denied"

Codes: [`POLICY_UNSCOPED`](reference/errors.md#POLICY_UNSCOPED), [`POLICY_NAME_TOO_LONG`](reference/errors.md#POLICY_NAME_TOO_LONG), [`SESSION_EXPIRED`](reference/errors.md#SESSION_EXPIRED), [`PRIVY_KEY_QUORUM_MISMATCH`](reference/errors.md#PRIVY_KEY_QUORUM_MISMATCH).

A denial comes back as an error from your signing route, not a popup, and it is a failed transaction, not proof the session is gone. Work through these in order.

1. **Policy mismatch.** The rule's `method` must be `eth_signTransaction` (a rule written for `eth_sendTransaction` never matches), and the `to` address, function and `value` must equal what you are signing. A call to any other contract or function, or with a nonzero value, is denied by design. `buildSessionPolicy()` refuses an unscoped policy with `POLICY_UNSCOPED`.
2. **Expiry.** The policy's `current_unix_timestamp` condition denies every request after the expiry (`SESSION_EXPIRED`). Grant a new session.
3. **Policy name length.** Policy and rule names must be at most 49 characters. Privy's published spec says 50, but the live validator rejects 50 or more. This fails when the policy is created (a 400 from your grant route), so the signer is never attached.
4. **Key quorum mismatch.** The signer belongs to a key quorum, and your server must sign each Privy request with that quorum's authorization key. Check that `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` is the quorum you registered and that `PRIVY_AUTHORIZATION_KEY` is the private half of that same key pair. The symptom is `401 "No valid authorization keys or user signing keys available"`.

See [Session Keys](onboarding/session-keys.md#common-failures).

### "No active session" or "session approval does not match" (Kernel session)

Codes: [`SESSION_NONE`](reference/errors.md#SESSION_NONE), [`SESSION_APPROVAL_MISMATCH`](reference/errors.md#SESSION_APPROVAL_MISMATCH).

The user has not granted a session, or it was revoked (`SESSION_NONE`): ask them to grant one. If the approval was made for another account, permission id or mode (`SESSION_APPROVAL_MISMATCH`), run prepare again, have the owner sign again, then activate. The scope on the server and the client must match. See [Session Keys](onboarding/session-keys.md) and the [Grant a Session](recipes/grant-a-session.md) recipe.

## Pillar 3: Sponsored transactions

### "Is gas sponsorship available?"

**Yes, through the hosted endpoints.** A Kernel smart account holding 0 PEPU can send a project-sponsored operation through `https://bundler.pepeunchained.com` and `https://paymaster.pepeunchained.com/v2/paymaster/<server key>`. The SDK uses the hosted bundler and paymaster base by default; `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` override them. The ERC-7677 URL always embeds a token, so you need a project of your own (claim, set targets and limits, deposit, token); the free tier needs a verified Privy token from PEPU's own Privy app and is not available to third-party apps. The v1 paymaster is retired. See [Endpoints](reference/endpoints.md), [Sponsored Transactions](onboarding/sponsored-transactions.md) and [Infrastructure Map](infra/overview.md). The tiered v2 model is documented on [Sponsorship Tiers](onboarding/sponsorship-tiers.md). If you want no popup and no sponsorship at all, [Session Keys](onboarding/session-keys.md) need none of this.

### "The paymaster denied my UserOperation"

Codes: [`PAYMASTER_DENIED`](reference/errors.md#PAYMASTER_DENIED), [`PAYMASTER_DESTINATION_NOT_ALLOWED`](reference/errors.md#PAYMASTER_DESTINATION_NOT_ALLOWED), [`PAYMASTER_ORIGIN_NOT_ALLOWED`](reference/errors.md#PAYMASTER_ORIGIN_NOT_ALLOWED), [`PAYMASTER_IDENTITY_REQUIRED`](reference/errors.md#PAYMASTER_IDENTITY_REQUIRED).

The reason is in the JSON-RPC error's `data.reason`, not in the HTTP status and not always in the headline message. Read `error.data.reason` first, then look it up in [Paymaster denial reasons](reference/errors.md#paymaster-denial-reasons), which maps every reason to a code. `pm_getPaymasterStubData` succeeding proves nothing: it is unauthenticated by spec, and only `pm_getPaymasterData` enforces the policy. See [Policy, Caps and the Circuit Breaker](infra/paymaster/policy-and-caps.md).

### "Sponsorship stopped: cap reached, no balance or rate limited"

Codes: [`PAYMASTER_CAP`](reference/errors.md#PAYMASTER_CAP), [`PAYMASTER_NO_BALANCE`](reference/errors.md#PAYMASTER_NO_BALANCE), [`PAYMASTER_RATE_LIMITED`](reference/errors.md#PAYMASTER_RATE_LIMITED), [`PAYMASTER_FREE_TIER_UNAVAILABLE`](reference/errors.md#PAYMASTER_FREE_TIER_UNAVAILABLE).

All four are retryable. A cap resets with its window; no balance means the project's paymaster deposit cannot cover the operation (deposit more; v2 deposits are one-way); rate limiting wants a back-off for `Retry-After`. The v2 free tier is 100 PEPU per Privy user per day and 50 PEPU per hour, for PEPU's own Privy app only.

### "My v2 project is not claimed, paused or owned by someone else"

Codes: [`PAYMASTER_PROJECT_NOT_CLAIMED`](reference/errors.md#PAYMASTER_PROJECT_NOT_CLAIMED), [`PAYMASTER_PROJECT_PAUSED`](reference/errors.md#PAYMASTER_PROJECT_PAUSED), [`PAYMASTER_PROJECT_OWNER_CHANGED`](reference/errors.md#PAYMASTER_PROJECT_OWNER_CHANGED), [`PAYMASTER_SESSION_REQUIRED`](reference/errors.md#PAYMASTER_SESSION_REQUIRED).

These apply to the deployed v2 paymaster. A claim sets the owner only; after it the owner must call `setTargets`, `setDailyLimit` and `setSenderDailyLimit` before anything is sponsored. See [Register, Deposit and Claim a v2 Project](infra/paymaster/v2-register-deposit-claim.md) and [Credential Matrix](infra/paymaster/auth.md).

### "The sponsored transaction reverted or the EntryPoint rejected it"

Codes: [`BUNDLER_AA_FAILED`](reference/errors.md#BUNDLER_AA_FAILED), [`TX_REVERTED`](reference/errors.md#TX_REVERTED), [`TX_NONCE_RACE`](reference/errors.md#TX_NONCE_RACE).

Read the `AAxx` code in the message: `AA21` prefund missing, `AA23` signature or validation reverted, `AA25` invalid nonce, `AA31`, `AA33`, `AA34` paymaster problems. For a plain revert, `explainError(<revert data>)` decodes the reason. Serialize sends per account to avoid nonce races. See [Bundler JSON-RPC API](infra/bundler/api.md).

## The combination: Google, session and sponsorship together

See [Google Login, Session and Sponsorship End to End](onboarding/google-session-sponsored.md) and the `sponsored-session-app` template.

- **Set up screen instead of the app.** No Privy app id: run `npm run doctor` and fill `.env.local`. See [Sponsored Session App](templates/sponsored-session-app.md).
- **Session works, sponsorship does not.** The session is enforced on-chain by the Kernel; sponsorship is the paymaster. Check them separately: `pepu_sponsorship_status` for the paymaster side, and the session scope for the other.
- **Spend caps reject the first operation.** Size caps above the gas reservation (the first operation deploys the account and reserves more than later ones). See [Sponsored Session in One Flow](recipes/sponsored-session.md).
- **State is lost on restart.** `createMemoryStore()` is for development only; use a durable store in production. See [Trust and Security Model](concepts/trust-and-security.md).

## Infrastructure: bundler and paymaster services

### "Bundler or paymaster is unreachable"

Codes: [`BUNDLER_UNREACHABLE`](reference/errors.md#BUNDLER_UNREACHABLE) (bundler) and [`PAYMASTER_UNREACHABLE`](reference/errors.md#PAYMASTER_UNREACHABLE) (paymaster).

The request failed before any response. Check `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL`; the SDK defaults to `https://bundler.pepeunchained.com` and `https://paymaster.pepeunchained.com`, so an unreachable error with neither set points at the network or the hosted service. `checkSponsorship()` and the MCP tools `pepu_bundler_health` and `pepu_paymaster_health` tell you which side is down. A service bound to `localhost` is unreachable from a teammate's machine or a deployed app. See [Endpoints](reference/endpoints.md).

### "The bundler returns HTTP 500 on eth_sendUserOperation"

If you run your own Alto bundler on `@pimlico/alto` 0.0.21, this is almost certainly `safe-mode: true`, which cannot complete `eth_sendUserOperation`. Set `safe-mode` to `false` and restart. Gas estimation succeeding while sending fails is the tell. See [Operating the Bundler](infra/bundler/operating.md).

### "Failed to fetch" or a CORS error calling the bundler from the browser

Privy's smart-wallet client calls the bundler directly from the browser, and a missing CORS preflight response shows up as a bare `Failed to fetch`. Set `enable-cors` to `true` on the bundler. Because that exposes the bundler to any web page, put it behind a filtering proxy in production. See [Operating the Bundler](infra/bundler/operating.md).

### "Setting up your smart wallet..." never clears

Smart Wallets is off, or is not configured for chain 97741 in the Privy Dashboard (provider Kernel, plus your bundler and paymaster URLs). Use the hosted URLs `https://bundler.pepeunchained.com` and `https://paymaster.pepeunchained.com/v2/paymaster/<project token>`. See [Dashboard Settings, Field by Field](privy/dashboard-settings.md) and [Sponsored Transactions](onboarding/sponsored-transactions.md).

### "A pasted bundler or paymaster URL stopped working"

The URL pasted into the Privy Dashboard points at a host that changed address, or the token in it was rotated. Use a stable hostname for any service the Dashboard calls, and update the Dashboard when you rotate. See [Credential Matrix](infra/paymaster/auth.md).

## What to expect

- Every entry here either resolves the issue or points to the page that explains it.
- If a code is not listed above, search the [Error Reference](reference/errors.md); it lists all of them.

## Related

- [Error Reference](reference/errors.md)
- [SDK Error Catalog](sdk/errors.md)
- [MCP Tool Reference](mcp/tools.md) (`pepu_explain_error`, `pepu_known_gotchas`, `pepu_check_privy_config`)
- [FAQ](reference/faq.md)
