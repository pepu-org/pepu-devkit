# /privy

`@pepu-chain/sdk/privy` is the client-safe Privy layer: the typed `<PrivyProvider>` config for PEPU, the Privy requirements table, and the dashboard checker. It has no dependency on any Privy package, so it runs in the browser, in Node scripts and in the doctor.

The dashboard checker reads Privy's public app-config endpoint, which is undocumented, so anything it cannot read is reported as `unknown`, never as a failure.

## Import, peers and boundary

| Item | Value |
|---|---|
| Import | `@pepu-chain/sdk/privy` |
| Server or client | Client-safe. No secrets, no Node APIs |
| Peer dependencies | None (the config is structurally assignable to `PrivyClientConfig`) |
| Pillar | Google to wallet |

## Exports

| Export | Signature | What it abstracts |
|---|---|---|
| `createPepuPrivyConfig` | `(options?: CreatePepuPrivyConfigOptions) => PepuPrivyClientConfig` | The `config` prop for `<PrivyProvider>`: `defaultChain` and `supportedChains` are PEPU mainnet only, `embeddedWallets.ethereum.createOnLogin` defaults to `"off"`, Coinbase Wallet is pinned to `eoaOnly` |
| `CreatePepuPrivyConfigOptions` | `{ loginMethods?, appearance?, createOnLogin?, chain? }` | `createOnLogin` is `"off" \| "users-without-wallets" \| "all-users"` |
| `PrivyLoginMethod` | `"email" \| "google" \| "wallet" \| "sms" \| "apple" \| "twitter" \| "discord" \| "github"` | |
| `PEPU_PRIVY_REQUIREMENTS` | `readonly PrivyRequirement[]` | Everything a PEPU app needs from Privy as one data table. It feeds these docs, the MCP tool `pepu_check_privy_config`, the CLI doctor and in-app notices |
| `PRIVY_ENV`, `PRIVY_ENV_ALIASES` | name maps | `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`. Aliases `PRIVY_APP_ID` and `PRIVY_KEY_QUORUM_ID` are read only when the canonical name is empty |
| `checkPrivyDashboardConfig` | `(o: { appId: string; origin?: string; fetch? }) => Promise<{ ok: boolean; items: PrivyDashboardCheckItem[] }>` | Reads the public app config and checks dashboard rows. Never throws; anything unverifiable is `"unknown"` |
| `privyDashboardChecker` | `(input: { appId; requirementKeys: string[]; appSecret?; fetch; origin? }) => Promise<PrivyDoctorCheck[]>` | Adapter that plugs the dashboard check into [/doctor](doctor.md). `appSecret` is accepted and never used or logged |
| Types | `PepuPrivyClientConfig`, `PrivyRequirement`, `PrivyRequirementResult`, `PrivyPublicAppConfig`, `PrivyDashboardCheckItem`, `PrivyDoctorCheck`, `EmbeddedWalletCreateOnLogin` | |

### The requirements table

Each row has `id`, `where` (`dashboard`, `env` or `code`), `label`, `required`, `pillars` (`login`, `session`, `sponsor`), an optional `check` and a `fix`. The rows today:

| id | where | What it asserts |
|---|---|---|
| `app-id` | env | `NEXT_PUBLIC_PRIVY_APP_ID` is set |
| `app-secret` | env | `PRIVY_APP_SECRET` is set (server only) |
| `allowed-origins` | dashboard | The page origin, including the port, is in Allowed origins |
| `login-methods` | dashboard | At least one login method is enabled |
| `login-methods.google` | dashboard | Google login is enabled |
| `embedded-wallets` | dashboard | Embedded wallets are enabled for Ethereum |
| `coinbase-eoa-only` | code | Coinbase Wallet is pinned to `eoaOnly` |
| `authorization-key-quorum` | env | `PRIVY_AUTHORIZATION_KEY` is set and `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` is its quorum id |
| `smart-wallets` | dashboard | Smart wallets are enabled with the bundler and paymaster URLs (Privy transport only) |

The dashboard settings themselves are explained field by field in [Dashboard Settings, Field by Field](../privy/dashboard-settings.md).

## Example

```tsx
import { createPepuPrivyConfig, checkPrivyDashboardConfig } from "@pepu-chain/sdk/privy";

export const privyConfig = createPepuPrivyConfig({ loginMethods: ["email", "google", "wallet"] });

const r = await checkPrivyDashboardConfig({ appId, origin: "http://localhost:3001" });
for (const item of r.items.filter((i) => i.ok === false)) console.log(item.id, item.fix);
```

Most apps never call `createPepuPrivyConfig` directly: [/privy/react](privy-react.md)'s `PepuPrivyProvider` and [/privy/wagmi](privy-wagmi.md)'s `PepuPrivyWagmiProvider` call it for you.

## Errors

This entry throws nothing for the Privy dashboard. Its codes appear when you map failures:

| Code | When |
|---|---|
| `CONFIG_PRIVY_DASHBOARD` | A dashboard setting is wrong (surfaced by the doctor and MCP check) |
| `CONFIG_PRIVY_CREATE_ON_LOGIN` | The dashboard's wallet-creation setting conflicts with the code value |
| `CONFIG_ORIGIN_MISMATCH` | The page origin is not an allowed origin |
| `WALLET_COINBASE_UNSUPPORTED_CHAIN` | Coinbase Smart Wallet is not pinned to `eoaOnly` |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| The login modal hangs on "Creating your wallet" | The dashboard creates wallets on login and the code value is ignored, because **the dashboard setting wins** | Turn automatic creation off in the dashboard and provision server-side with `createEnsureWalletRoute` |
| Console floods with "configured chains are not supported by Coinbase Smart Wallet" | Coinbase is not `eoaOnly` | Use `createPepuPrivyConfig`, which pins it |
| Origin errors on a new port | The origin with its port is not in Allowed origins | Add `http://localhost:<port>` |

## Related

- [/privy/react](privy-react.md), [/privy/wagmi](privy-wagmi.md), [/privy/server](privy-server.md)
- [Privy Configuration Overview](../privy/index.md)
- [Dashboard Settings, Field by Field](../privy/dashboard-settings.md)
