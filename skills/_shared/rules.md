# PEPU rules for agents: use the SDK, call the MCP tools, never hand-roll

The PEPU dev kit is `@pepu-chain/sdk` (functions), `@pepu-chain/mcp` (tools, server name `pepu`) and these skills.
Your job is to wire the SDK and call the tools, not to write infrastructure the SDK already ships. The user should
only be asked for things only they can provide: the Privy App ID and App Secret, registering a public key in the
Privy dashboard, funds, and the bundler and paymaster URLs.

## Order of work

1. **Scaffold first.** For a new app run `npx create-pepu-app@latest <name> --template <t> --yes --no-install --no-git --json`
   (one JSON document on stdout; only key names, never values) or call the MCP tool `pepu_list_templates` then
   `pepu_scaffold_app`. Templates already use the SDK and ship `AGENTS.md`, `CLAUDE.md` and editor MCP configs (Claude Code gets the MCP server from the pepu-devkit plugin).
2. **Ask the tools, not your memory.** `pepu_chain_info` for facts and addresses, `pepu_sponsorship_status` before
   claiming anything about gas sponsorship, `pepu_check_env` and `pepu_check_privy_config` before debugging code,
   `pepu_sdk_snippet` for canonical code, `pepu_sdk_exports` to find the right function.
3. **Import from the right subpath.** Server entries (`/privy/server`, `/session/server`, `/combo`,
   `/paymaster/server`) only run on a server; `/privy/wagmi` is ESM only. The map is in the `pepu-sdk` skill.
4. **Verify** with `pepu_check_env`, `pepu_check_privy_config`, `npm run doctor` (templates that define it), then
   `npm run typecheck` and `npm run build`.
5. **When something fails**, call `pepu_explain_error` (SDK `explainError`) with the exact text, then `pepu_known_gotchas`.

## Never hand-roll these. Use the SDK function.

| Do not write | Use instead |
|---|---|
| a viem `defineChain` for PEPU, an RPC URL, an explorer URL | `pepuMainnet`, `resolvePepuEndpoints()`, `explorerLinks()` from `@pepu-chain/sdk` |
| a wagmi config or connector setup | `pepuWagmiConfig()` / `PepuPrivyWagmiProvider` from `@pepu-chain/sdk/privy/wagmi` |
| a contract address (Multicall3, Permit2, EntryPoint, Kernel, paymaster) | `getPepuAddresses()` / `getContract()` from `@pepu-chain/sdk`, or `pepu_chain_info` |
| the Multicall3 address `0xcA11...CA11` | `pepuMulticall(client, calls)`. That address has no code on PEPU |
| a Permit2 domain or typed data | `getPermit2()`, `permit2Domain()`, `buildPermitSingleTypedData()` |
| a `<PrivyProvider>` config | `PepuPrivyProvider` (`/privy/react`) or `createPepuPrivyConfig()` (`/privy`) |
| wallet creation after login, "wait for the wallet" logic | `createEnsureWalletRoute()` + `WalletGate` / `useEnsureWallet` |
| access-token verification, finding the user's wallet | `requireUser()` / `verifyRequestUser()` from `/privy/server` |
| a fetch that adds the Privy bearer token | `usePepuAuthFetch()` |
| a Privy session policy, key quorum plumbing, grant/status/revoke routes | `createSessionRoutes()` (`/session/server`) and the `useSession*` hooks |
| the sign-and-broadcast route for a session | `createSessionActionRoute()` / `privySessionSigner()` |
| an authorization key pair | `generatePrivyAuthorizationKey()` (`/doctor`) or MCP `pepu_generate_authorization_key` |
| Kernel account, bundler or paymaster clients | `toPepuKernelAccount`, `createPepuSponsoredClient`, `createPepuBundlerClient`, `createPepuPaymasterClient` (`/aa/kernel`, `/aa`) |
| a gasless send | `useSponsoredSend()` (`/aa/react`) or `sendSponsored()` (`/aa/kernel`) |
| "is sponsorship up" probing | `checkSponsorship()`, `probeBundler()`, `probePaymaster()` or MCP `pepu_sponsorship_status` |
| UserOperation or paymaster error parsing | `describeUserOpFailure()`, `explainError()`, `mapPaymasterReason()` |
| an on-chain session (Kernel permission) | `buildKernelSessionPolicies()`, `approveKernelSession()`, `loadKernelSessionAccount()` (`/session/kernel`) |
| the Google + session + sponsored flow | `createSponsoredSessionRoutes()` (`/combo`) + `useSponsoredSession()` (`/combo/react`) |
| v2 project ids and paymaster calls | `computeProjectId()`, `configureProject()`, `depositFor()`, `encode*()` (`/paymaster`) |
| env and readiness checks | `checkPepuEnv()`, `runDoctor()` (`/doctor`) or MCP `pepu_check_env` |
| gas or "max send" maths | `estimateTransactionCost()`, `maxSendableAmount()`, `formatPepu()` |
| error messages for users | `explainError()`, `toErrorResponse()`, `PepuError` |

If the SDK lacks something, say so in your answer, write the smallest local code, and mark it `// TODO(sdk): ...`.

## Hard rules

- **Never print, log or commit secrets**: `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, paymaster URLs (they embed a
  credential), session private keys. Report key names, presence and length only. Never read a user's `.env*` for its values.
- **Mainnet only (97741).** The testnet is out of scope; do not add it to chain lists.
- **Sponsorship wording follows the live answer.** Call `pepu_sponsorship_status` (or `checkSponsorship()`) and say what it
  returned. Do not write "sponsorship is hosted" or "sponsorship does not work" from memory. The hosted bundler
  (bundler.pepeunchained.com) and paymaster service (paymaster.pepeunchained.com) are the defaults; the ERC-7677 URL needs a project token (`PEPU_PAYMASTER_URL`).
- **Privy session mode is enforced off-chain and the user pays gas.** Kernel session mode is enforced on-chain. Say which one you built.
- **Paymaster v2 facts.** v1 is retired. The free tier is 100 PEPU/day and 50 PEPU/hour per Privy user, TapScore only for now; other apps claim a project, deposit and use its token. Deposits are one-way, so advise depositing only what the project needs.
- **Never call a transaction "free" or "gasless"** unless a paymaster actually paid it.
- **A session signer is always created with a scoped policy.** Never an empty `policyIds`.
- **Never use Privy's server-side `eth_sendTransaction` on 97741.** It is rejected; sign with `eth_signTransaction` and broadcast (the SDK does this).

## MCP tool contract

Read-only lookups: `pepu_chain_info`, `pepu_known_gotchas`, `pepu_health_check`, `pepu_search`, `pepu_get_address_overview`,
`pepu_get_transaction`, `pepu_get_token_info`, `pepu_read_contract`, `pepu_check_contract_deployed`,
`pepu_verify_contract_status`, `pepu_verify_contract_guide`, `pepu_estimate_gas_cost`, `pepu_gas_price`,
`pepu_smart_account_info`, `pepu_decode_error`.

SDK-backed probes and explainers: `pepu_bundler_health`, `pepu_paymaster_health`, `pepu_sponsorship_status`,
`pepu_project_balance`, `pepu_explain_error`, `pepu_explain_tx`, `pepu_decode_tx_logs`.

Generate, scaffold, docs: `pepu_list_templates`, `pepu_scaffold_app` (write), `pepu_check_env`, `pepu_check_privy_config`,
`pepu_generate_authorization_key` (write, never returns the private key), `pepu_session_policy`, `pepu_encode_calls`,
`pepu_prepare_project_tx` (unsigned only), `pepu_get_docs`, `pepu_sdk_snippet`, `pepu_sdk_exports`.

The server also serves resources (`pepu://chain-facts`, `pepu://addresses`, `pepu://docs/{slug}`, `pepu://skills/{name}`,
`pepu://sdk/exports`) and prompts (`new-pepu-app`, `add-google-login`, `add-session`, `add-sponsorship`,
`add-sponsored-session`, `debug-tx`).
