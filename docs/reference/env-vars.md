# Environment Variables

Every environment variable used by the templates, the SDK, the MCP server and the services: which component reads it, whether it is required, whether it is secret, and a placeholder. Never put real values in docs, commits or chat.

> Status: derived from `TEMPLATE_REQUIREMENTS`, `PRIVY_ENV`, `PEPU_ENV`, the templates' `.env.example` files and the services' `.env.example` files.

## Prerequisites

None. `npm run doctor` in a template checks its own variables.

## App and SDK variables

| Name | Read by | Required | Secret | Example placeholder |
|---|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` (alias `PRIVY_APP_ID`) | Provider, `/privy/server`, doctor | All templates | No (public) | `<privy-app-id>` |
| `PRIVY_APP_SECRET` | `/privy/server`, `/session/server`, `/combo` | All templates | **Yes** | `<privy-app-secret>` |
| `PRIVY_AUTHORIZATION_KEY` | `/session/server` | `game-app` | **Yes** | `<base64-pkcs8-private-key>` |
| `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` (alias `PRIVY_KEY_QUORUM_ID`) | `createSessionRoutes` | `game-app` | No | `<key-quorum-id>` |
| `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS` | `game-app` scope | `game-app` | No | `0x<contract>` |
| `NEXT_PUBLIC_GATE_ERC20_ADDRESS` | `token-gated-app` | One of the two gate addresses | No | `0x<erc20>` |
| `NEXT_PUBLIC_GATE_ERC721_ADDRESS` | `token-gated-app` | One of the two | No | `0x<erc721>` |
| `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` | `nft-mint` | `nft-mint` | No | `0x<nft>` |
| `NEXT_PUBLIC_PAYMASTER_CONTRACT_ADDRESS` | `sponsored-demo` (deposit proof) | Optional; defaults to the v2 canary `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | No | same |
| `PEPU_BUNDLER_URL` | `resolvePepuEndpoints`, `/combo`, `/aa`, MCP, doctor | `sponsored-session-app`; any sponsorship | **Yes** (treat as a credential) | Optional; defaults to `https://bundler.pepeunchained.com` (local: `http://localhost:4337`) |
| `PEPU_PAYMASTER_URL` | Same | Same | **Yes** (embeds a token) | `https://paymaster.pepeunchained.com/v2/paymaster/<project server key>` (local: `http://localhost:8788/paymaster/<your-app-key>`). The ERC-7677 URL always embeds a token, so there is no tokenless default; the hosted base `https://paymaster.pepeunchained.com` is the default for the REST client and probes |
| `PEPU_RPC_URL` | SDK server entries, doctor, MCP | Optional; default is the public RPC | Only if it embeds a key | `<authenticated-rpc-url>` |
| `SESSION_DURATION_MINUTES` | `/session/server`, `/combo` | Optional; default 15, clamped 1 to 1440 | No | `15` |
| `NEXT_PUBLIC_PEPU_BUNDLER_URL`, `NEXT_PUBLIC_PEPU_PAYMASTER_URL`, `NEXT_PUBLIC_PEPU_RPC_URL` | `resolvePepuEndpoints` (browser variants) | Optional | Visible to every visitor | Avoid for credentials |
| `NEXT_PUBLIC_PEPU_NETWORK` | Doctor shape check only | Optional | No | `mainnet` (the only valid value) |

Precedence in `resolvePepuEndpoints`: explicit option, then the server variable, then the `NEXT_PUBLIC_` variant, then the hosted default (`PEPU_HOSTED`: the bundler `https://bundler.pepeunchained.com` and the paymaster base `https://paymaster.pepeunchained.com`; the complete ERC-7677 URL is `null` until you supply a token). The names are exported as `PEPU_ENV`, `PEPU_PUBLIC_ENV` and `PRIVY_ENV`.

## Per-template matrix

| Template | Required | Optional |
|---|---|---|
| `consumer-app` | `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | none |
| `game-app` | the two above, `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`, `PRIVY_AUTHORIZATION_KEY`, `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS` | `SESSION_DURATION_MINUTES`, `PEPU_RPC_URL` |
| `token-gated-app` | the two Privy vars, plus at least one of the gate addresses | both gate addresses |
| `nft-mint` | the two Privy vars, `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` | none |
| `sponsored-demo` | the two Privy vars | `NEXT_PUBLIC_PAYMASTER_CONTRACT_ADDRESS` |
| `sponsored-session-app` | the two Privy vars, `PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL` | `SESSION_DURATION_MINUTES`, `PEPU_RPC_URL` |

## MCP server

No API key. Optional: `PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL` (sponsorship tools) and `PEPU_RPC_URL`. Everything else uses public PEPU RPC and pepuscan's public REST API.

## Services (operators)

| Name | Component | Secret | Purpose |
|---|---|---|---|
| `ALTO_RPC_URL` | Bundler | **Yes** (embeds the RPC key) | RPC for Alto |
| `ALTO_EXECUTOR_PRIVATE_KEYS` | Bundler | **Yes** | Funded submitter key or keys |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Paymaster policy service | secret: the second | Verify user tokens |
| `PAYMASTER_CONTRACT_ADDRESS`, `CHAIN_ID`, `ENTRY_POINT_ADDRESS`, `PORT`, `DB_PATH` | Policy service | No | Chain and paymaster config |
| `PAYMASTER_SIGNER_PRIVATE_KEY` | Policy service (loaded from a gitignored keys file) | **Yes** | Signs approvals |
| `USER_HOURLY_SPEND_CAP_WEI`, `USER_DAILY_SPEND_CAP_WEI`, `USER_LIFETIME_SPEND_CAP_WEI`, count caps, `GLOBAL_DAILY_SPEND_CEILING_WEI` | Policy service | No | Caps; size above the first-operation reservation |
| `ADMIN_TOKEN` | Policy service | **Yes** | Enables the circuit-breaker reset endpoint |
| `PAYMASTER_RPC_ALLOWED_ORIGINS`, `PAYMASTER_RPC_ALLOW_ACCOUNT_DEPLOYMENT` | Policy service | No | ERC-7677 endpoint controls |
| `SPONSORSHIP_V2_ENABLED` and the `SPONSORSHIP_V2_*`, `FREE_TIER_*`, `PROJECT_*`, `SPONSORSHIP_*` family | Policy service v2 (on in the hosted service; off by default in a fresh run) | `SPONSORSHIP_ADMIN_TOKEN` is secret | Tiered paymaster, deployed as a canary |

Full lists: [Operating the Bundler](../infra/bundler/operating.md), [Policy, Caps and the Circuit Breaker](../infra/paymaster/policy-and-caps.md), [Paymaster Overview](../infra/paymaster/overview.md).

## Public versus secret rules

- `NEXT_PUBLIC_` means bundled into client JavaScript. Use it only for the App ID, the quorum id and contract addresses.
- Server-only code never reads `NEXT_PUBLIC_` secrets.
- `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` are credentials in practice: keep them server-side.
- Restart the dev server after editing `.env.local`; Next.js reads it once.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `CONFIG_MISSING_ENV` | A required variable is empty | Set it, restart |
| `CONFIG_BAD_URL` | A URL variable is not http(s) | Fix the value (the message names the variable, not its value) |
| Doctor says `placeholder` | Value like `your-app-id` | Replace it |

## Related

- [Privy Env Vars and Verification](../privy/env-and-checks.md)
- [Template Gallery](../templates/index.md)
- [Error Reference](errors.md)
