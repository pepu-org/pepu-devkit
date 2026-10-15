# Changelog

Dated changes to the dev kit packages and docs, newest first. Each entry lists what a builder can now do, not the commit log. Versions are those in the repository on the date of each entry. Publishing to npm is a maintainer step (see `RELEASING.md` in the repository), so check the registry for what is published.

> Status: SDK 0.2.2, MCP 0.2.3, plugin 0.4.0 and create-pepu-app 0.1.2 are the versions on main. The three pillars and their combination are proven on mainnet (the combination live in a browser on 2026-10-14, against the hosted bundler and v2 paymaster). The hosted bundler and paymaster endpoints are live, and the v2 tiered paymaster is deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches.

## 2026-10-15: @pepu-chain/mcp 0.2.5, plugin 0.4.1

New guide: [Smart account paths](../concepts/smart-account-paths.md) explains ZeroDev-native accounts built by the SDK versus Privy Smart Wallets versus plain embedded wallets, with a decision table. The quickstart is now a 10-minute zero-to-sponsored-transaction guide, the paymaster project guide is step by step with SDK and MCP routes, and the skills link the new guide. The MCP server bundles the refreshed docs and skills.

## 2026-10-15: create-pepu-app 0.1.3, @pepu-chain/mcp 0.2.4

Every template's `.env.example` now carries the full Privy dashboard checklist (allowed origins, login methods, embedded wallets, Coinbase `eoaOnly`, Smart Wallets status, authorization keys for game-app, paymaster credentials). `docs/privy/dashboard-settings.md` gains per-template requirements and the Smart Wallets table (Kernel v3.1, chain 97741, hosted bundler, paymaster URL with a project client token). The MCP server bundles the refreshed docs.

## 2026-10-15

### Fresh-account fixes for the combination: `@pepu-chain/sdk` 0.2.2, `@pepu-chain/mcp` 0.2.3, `create-pepu-app` 0.1.2

A fresh Google account hit two failures on the live `sponsored-session-app` demo that an existing account never saw.

- **First sign-in showed a red error.** The embedded wallet exists in the browser a moment before Privy's server lists it, so `status` answered 409 `WALLET_NOT_PROVISIONED`. The combo routes now look the user up again a few times (`provisioningWait`, default 3 retries), and `status` answers `{ active: false, provisioning: true }` (a normal 200) if the wallet is still not visible. `useSponsoredSession` keeps `statusLoading` true and re-checks with backoff (0.5 s to 5 s, about 30 s), and `grantKernelSession` retries `prepare` for about 6.5 s. Neither shows an error for this state.
- **The first tap was denied.** The paymaster service only recognized Privy Smart Wallets as "the user's account", but the combo flow creates a ZeroDev Kernel v3.1 account that Privy has never seen, so the service denied the first operation with `sender_not_owned_by_token_user`, before it even chose between the project and the free tier. The service now also accepts the Kernel v3.1 account (ECDSA validator, index 0) derived from one of the token user's own Privy embedded wallets (derivation via the factory's `getAddress`, pinned by a test vector from the SDK), and still denies any other sender. This is a service-side change; no app change is needed. A new user's first operation (about 20 PEPU reserved, because it deploys the account) now falls back to the free tier when the project balance cannot cover it.
- **The error named the wrong thing.** viem reports the service's denial as the generic "Missing or invalid parameters." `describeUserOpFailure` now reads the real denial and says, for example, `Paymaster denied the operation (sender_not_owned_by_token_user): ...`, with the matching catalog code and a specific hint.

`create-pepu-app` 0.1.2 vendors the 0.2.2 SDK and scaffolds `@pepu-chain/sdk@^0.2.2`; the `sponsored-session-app` README and `.env.example` now describe the project-first, free-tier-fallback behaviour accurately. `@pepu-chain/mcp` 0.2.3 pins exactly SDK 0.2.2.

## 2026-10-14

### Combination proven live in a browser

The Google login, on-chain Kernel session key and gas sponsorship combination was run by a person in a browser on mainnet (`sponsored-session-app`, against the hosted bundler `https://bundler.pepeunchained.com` and the v2 paymaster `https://paymaster.pepeunchained.com`): Google sign-in to the embedded wallet, one Privy `eth_signTypedData_v4` signature on chain 97741, sponsored taps with no popup while the smart account stayed at 0 PEPU, and revoke. The "proven by script; browser flow not yet run" label is replaced across the docs, skills, MCP text and READMEs. The MCP server text changed (known gotcha and prompt), so it ships in `@pepu-chain/mcp@0.2.2`.

### `create-pepu-app` 0.1.1

Label fix only; the `features` vocabulary (`login`, `session`, `sponsor`) and `--list --json` shape are unchanged. The picker and `--list` showed every template's `login` feature as "Google login", but `consumer-app`, `token-gated-app`, `nft-mint` and `game-app` enable email, Google and wallet sign-in, and `sponsored-demo` and `sponsored-session-app` enable Google and email. The feature is now labelled "sign-in + embedded wallet", and the `consumer-app` and `sponsored-session-app` descriptions name the methods they enable. The vendored SDK is 0.2.1 and `--sdk npm` scaffolds `@pepu-chain/sdk@^0.2.1`.

### `@pepu-chain/sdk` 0.2.1 and `@pepu-chain/mcp` 0.2.1

Patch release from the first clean-room install of the public packages. `@pepu-chain/mcp` 0.2.1 depends on exactly `@pepu-chain/sdk` 0.2.1. `create-pepu-app` stays at 0.1.0, which is awaiting npm's staged-release approval; it ships the 0.2.0-era templates and scaffolds `@pepu-chain/sdk@^0.2.1`.

- **Windows clone fixed.** `git clone` of the repository failed on Windows with "Filename too long" under the vendored Solidity libraries, which also broke `/plugin marketplace add pepu-org/pepu-devkit`. Vendored test, docs, audit, certora, mock and sample files that the build never compiles were removed; the longest tracked path went from 150 to 126 characters, and CI fails above 130 (`scripts/check-path-length.mjs`). The compiled paymaster bytecode is unchanged: the pinned creation-code hashes for v1 and v2 are identical.
- **Clear errors for missing optional peers.** Importing a peer-dependent subpath (for example `@pepu-chain/sdk/privy/react` without `react` or `@privy-io/react-auth`) now throws `PEPU_MISSING_PEER` naming the subpath and the exact `npm i` command, instead of Node's "Cannot find package 'react' imported from dist/chunk-XXXX.js". Under Node the ESM entries load through a small guard (`node` export condition only; bundlers and browsers get the plain entry); CJS entries carry the guard inline. The SDK README and [SDK Reference](../sdk/reference.md#install-peers-per-subpath) gained an Install table (subpath, peers, one-line `npm i`) and a bundle command; `create-pepu-app` remains the recommended path because it scaffolds every peer.
- **Accurate health probes.** `probeBundler` and `pepu_bundler_health` reported `eth_sendUserOperation`, `eth_estimateUserOperationGas` and `eth_getUserOperationReceipt` as unsupported on the live Alto bundler, because Alto answers bad params of a known method with code `-32601` ("Validation error: ..."). Support is now judged from the message (only "method not found" and Alto's "Invalid discriminator value" mean unsupported), the calls still use deliberately invalid params so nothing is sent on-chain, and the verdict is only healthy when the chain, EntryPoint v0.7 and the three required methods are present (`missingRequiredMethods` lists any gap). `probePaymaster` and `pepu_paymaster_health` add `erc7677: "stub-ok" | "needs-credential" | "not-responding"`; without a client token the stub check is reported as not applicable (`erc7677StubOk` is `null`) instead of `false`, and a service that does not speak ERC-7677 JSON-RPC is no longer called healthy.
- **`getPepuAddresses()` shape.** The docs and TSDoc now say plainly that it returns an array of rows (`.find((r) => r.key === "paymaster")`). New `getPepuAddressMap()` returns the same rows keyed by contract name.
- **Docs.** The root README and the CLI page describe what is on npm today and the pending CLI approval.

### Hosted endpoints live, v2 canary deployed, v1 retired

- **Hosted endpoints are live.** Bundler `https://bundler.pepeunchained.com` (the SDK default for `PEPU_BUNDLER_URL`) and paymaster service `https://paymaster.pepeunchained.com` (the SDK default base for `createPaymasterApi`, the probes, `checkSponsorship` and `doctor`). The `/v2` routes are public (free-tier state, config, SIWE, projects, verify); `/v2/admin` is not exposed. The ERC-7677 URL always embeds a token, `https://paymaster.pepeunchained.com/v2/paymaster/<token>`, so there is no tokenless default: `PEPU_HOSTED` is `{ bundlerUrl, paymasterBaseUrl, paymasterUrl: null }` and `isHostedSponsorshipLive()` returns true.
- **v2 paymaster deployed as a canary.** `PepuSponsoredPaymasterV7` is on PEPU mainnet at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (about block 10537341): deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches. The registry keys `paymasterV2` and `paymaster` point at it. Owner `0x5966dFaB11c8AEe767e0739083417D02f4a634A1`, manager `0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0`, free pool seeded with 300 PEPU. Free tier per user: 100 PEPU a day and 50 PEPU an hour; free-tier targets are TapScore only for now.
- **v1 paymaster retired.** `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` was funded earlier and its EntryPoint deposit has been withdrawn (0), so it cannot sponsor anything. The registry entry `paymasterV1` has `retired: true`, and `getPepuAddresses` rows carry `retired`.
- **Proof.** A project-sponsored operation from a fresh Kernel account holding 0 PEPU went through the hosted bundler and `paymaster.pepeunchained.com/v2/paymaster/<server key>`: userOp `0x8150850431639387f95c14e2c1f7c857eb833b7b8e0826426dfcbb683d6b9907`, tx `0x6b803ad49091d6758b413065ac54d09774413b55a234d873f8e371243f4e3209`. The paymaster paid 5.00 PEPU of gas including account deployment; the project ledger went from 25 to 19.80 PEPU. History: tx `0x57cf2f5a332248476d775c096b4b8339d81867c14211ed3bc4fcb1895dff0f9f` went through the hosted URLs with the v1 paymaster.
- **New SDK helpers.** `PEPU_HOSTED.paymasterBaseUrl`; `resolvePepuEndpoints()` also returns `paymasterBaseUrl`; `paymasterBaseOf(url)`; `hostedErc7677Url(token)` (from `@pepu-chain/sdk/paymaster`); `hostedFreeTierUrl()` (from `@pepu-chain/sdk`); `createPepuPaymasterClient` and `createPepuSponsoredClient` accept `paymasterToken`; `requirePaymasterUrl(explicit?, token?)`; `createSponsoredSessionRoutes` accepts `endpoints.paymasterToken` and `forwardPrivyToken` (default true: forwards the request's Bearer Privy token as ERC-7677 `context.privyAccessToken`; set false for a paymaster you do not trust with it).
- **MCP.** `pepu_project_balance` and `pepu_prepare_project_tx` default to the registry's deployed v2 canary (an explicit `paymaster` overrides). `pepu_paymaster_health`, `pepu_sponsorship_status` and `pepu_health_check` probe the hosted bundler and the paymaster service base by default.
- **Token behaviour.** A project client token (`ppt_`) is publishable and works only from the project's allowed origins (otherwise `project_origin_not_allowed`); a server key (`ppk_`) is secret. The free tier needs a verified Privy token from PEPU's own Privy app; a third-party app's Privy token is ignored for billing, and the Privy Smart Wallets dashboard URL cannot attach one.
- **Docs.** The sponsorship pages, templates, recipes and style guide now describe the live endpoints; "Sponsorship Tiers (Upcoming)" is now "Sponsorship Tiers".

## 2026-10-03

### `@pepu-chain/sdk` 0.2.0

Additive release: every 0.1 export remains. See [Migration Notes](../sdk/migration.md).

**New subpaths**

| Subpath | What it gives you |
|---|---|
| `/privy`, `/privy/react`, `/privy/wagmi`, `/privy/server` | Google to wallet: typed Privy config for PEPU, `PepuPrivyProvider` and `PepuPrivyWagmiProvider`, `WalletGate`, `useEnsureWallet`, the active-wallet pin, `createEnsureWalletRoute`, `requireUser`, the Privy requirements table and dashboard checker |
| `/session`, `/session/server`, `/session/react` | Privy-mode session keys: `buildSessionPolicy`, `createSessionRoutes`, `createSessionActionRoute`, `privySessionSigner`, `signAndBroadcast`, `useSessionGrant`, `useSessionStatus`, `useSessionAct`, `useSessionRevoke` |
| `/session/kernel` | On-chain session keys with ZeroDev Kernel permissions (call policy v0.0.4 plus timestamp policy) |
| `/aa`, `/aa/kernel`, `/aa/react`, `/aa/react-direct` | Sponsored transactions: bundler and paymaster clients, the Alto-compatible fee estimator, `toPepuKernelAccount`, `createPepuSponsoredClient`, `sendSponsored`, `describeUserOpFailure`, probes, `useSponsoredSend`, `usePepuSponsorship`. `/aa/react` serves Privy Smart Wallets and never references `@zerodev/*`; the direct transport lives in `/aa/react-direct` (`useDirectSponsoredSend`, `useDirectSmartAccount`) |
| `/paymaster`, `/paymaster/server` | The policy service REST client (v1 and v2), v2 on-chain helpers (claim, configure, deposit, read), the Privy claim attestation, denial reason mapping |
| `/combo`, `/combo/react` | The combination: `createSponsoredSessionRoutes` (five routes) and `useSponsoredSession` |
| `/doctor` | `runDoctor`, `checkPepuEnv`, `TEMPLATE_REQUIREMENTS`, `generatePrivyAuthorizationKey` |
| `/server` | Kept as a stable server-only alias for the pure session policy helpers |

**New on the core entry:** the error model (`PepuError` and seven subclasses, a code catalog, `explainError`, `toPepuError`, `toErrorResponse`); endpoint resolution (`resolvePepuEndpoints`, `PEPU_ENV`, with `PEPU_HOSTED` as the single swap point for the hosted URLs); `checkSponsorship` (live bundler and paymaster probe); `pepuMulticall`, `getMulticall3` and `MULTICALL3_CANONICAL_ADDRESS` guard; `getPermit2` and Permit2 typed-data builders; `explorerLinks`; `getPepuAddresses`; `formatUnitsCompact`; `erc20Abi` and `erc721Abi`; the ERC-7677 request builders; registry entries for the Kernel implementation, signer module, call policy v0.0.4, timestamp policy, `tapScore`, `paymasterV1` and `paymasterV2` (pending at the time; deployed 2026-10-14).

**Deprecated:** `getSponsorshipStatus` and `useSponsorshipStatus`. They always report unavailable. Use `checkSponsorship` and `usePepuSponsorship`.

**Boundaries:** five server-only entries throw `CONFIG_SERVER_ONLY` in a browser bundle. `/privy/wagmi` is ESM only. Each optional peer is imported only from its own subpaths, enforced by test.

**Late additions (patch pass before this entry):** `WalletGate` `stalled` render prop, `useSessionStatus().loading`, `useSponsoredSession().statusLoading`, `SponsoredActResult`, route factories that answer `CONFIG_MISSING_ENV` at request time instead of throwing at load, the pure `session/scope` helpers that need no `@zerodev/*`, `encodeKernelExecute`, `userOpEventsFromReceipt`, and a `usePepuSmartAccount` fallback through Privy's `getClientForChain`.

**Proven live:** Google to wallet, Privy session signers, sponsored transactions (at the time, the v1 paymaster `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0`, since retired, with an Alto bundler) and the combination (on-chain Kernel session key plus sponsorship). **Not live at the time:** public bundler and paymaster URLs, and the v2 paymaster (both went live on 2026-10-14; see above).

### `@pepu-chain/mcp` 0.2.0

The MCP server was rebuilt on `@pepu-chain/sdk`. It now serves 32 tools, 6 prompts and resources, so an agent reads the same registry, error catalog and requirements table that apps import. New tools cover probing the bundler and paymaster, explaining errors and transactions, checking environment and Privy configuration, generating an authorization key, encoding calls, scaffolding, listing SDK exports and fetching docs. The health check uses the live `checkSponsorship` probe, not a hard-coded answer. See [MCP Server Overview](../mcp/index.md) and [Tool Reference](../mcp/tools.md).

### Claude Code plugin `pepu-devkit` 0.4.0

Rewritten around the SDK and the MCP server: 12 skills (including `pepu-sdk`, `pepu-session-keys`, `pepu-sponsored-session`, `pepu-sponsored-transactions`, `pepu-paymaster-projects`), 6 slash commands (`/pepu-new-app`, `/pepu-add-login`, `/pepu-add-session`, `/pepu-add-sponsorship`, `/pepu-add-sponsored-session`, `/pepu-doctor`) and a builder subagent. See [Claude Code Plugin](../agent-tooling/plugin.md) and [Skills Catalog](../agent-tooling/skills.md).

### `create-pepu-app` 0.1.0

An interactive arrow-key flow (template, project name, package manager, install, git), with a non-interactive mode for CI and agents: `--yes`, `--json` (one JSON document on stdout), `--list`, `--sdk <vendor|npm>`, `--skip-agent-files`. Six templates: `consumer-app`, `token-gated-app`, `nft-mint`, `game-app`, `sponsored-demo`, `sponsored-session-app`. Templates are built on the SDK subpaths, ship `.mcp.json`, `AGENTS.md` and `CLAUDE.md`, and pre-fill environment files. See [create-pepu-app CLI](../cli/create-pepu-app.md) and [Template Gallery](../templates/index.md).

### Docs

- A page per SDK subpath, a pillar-to-subpath decision table, a server and client boundary section, and a complete export index. See [SDK Overview and Reference](../sdk/reference.md).
- Type-checked sample code under `docs/snippets`, embedded in the recipes. Fifteen recipes now use SDK functions instead of hand-rolled code, including seven new ones: grant a session, sponsored send, sponsored session, v2 deposit and claim, Permit2 permit, multicall in React and explorer links.

## Earlier

Before 0.2.0 the SDK was 0.1: chain definitions, the contract and DEX registries, ABIs, gas helpers, explorer helpers, the token list, and the `/react`, `/privy` and `/server` entries, with `getSponsorshipStatus` as an always-unavailable placeholder. There is no dated history before 2026-10-02.

## Related

- [Migration Notes](../sdk/migration.md)
- [SDK Overview and Reference](../sdk/reference.md)
