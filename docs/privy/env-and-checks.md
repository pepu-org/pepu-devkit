# Privy Env Vars and Verification

The Privy environment variables, and the three ways to verify a Privy setup: `checkPrivyDashboardConfig`, the `pepu_check_privy_config` MCP tool and `npm run doctor`. Use it when login, wallets or sessions fail with a config error.

The dashboard check calls Privy's public app-config endpoint. Every field is treated as optional and reports `unknown` when absent, never a false failure.

## Prerequisites

- `.env.local` in the project, and the Privy App ID (public).

## Env vars

| Variable | Scope | Read by | Needed for |
|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` (alias `PRIVY_APP_ID`) | Public | Provider, `createPrivyServer`, doctor | Everything |
| `PRIVY_APP_SECRET` | Server, secret | `/privy/server`, `/session/server`, `/combo` | Everything with a server route |
| `PRIVY_AUTHORIZATION_KEY` | Server, secret | `/session/server` | Privy sessions |
| `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` (alias `PRIVY_KEY_QUORUM_ID`) | Public | `createSessionRoutes` | Privy sessions |

The canonical names are `PRIVY_ENV`; aliases are read only when the canonical name is empty. The full cross-component list is [Environment Variables](../reference/env-vars.md).

## Run the checks

### `npm run doctor`

Every template has a `doctor` script that runs the SDK's `checkPepuEnv` against `.env.local` for that template's requirements. It prints `ok` or `FAIL` per key with a fix, never a value, and exits non-zero on failure. It checks env only, not the dashboard.

```
FAIL PRIVY_APP_SECRET - Set PRIVY_APP_SECRET in .env.local to the app secret from the Privy dashboard (server only).
```

Statuses per key: `ok`, `missing`, `placeholder` (for example `your-app-id`) and `malformed` (the Privy id must look like `c` plus 20 to 29 lowercase alphanumerics; addresses must be 20-byte hex; URLs must be http or https; `SESSION_DURATION_MINUTES` must be positive).

### The full doctor

`runDoctor` from `@pepu-chain/sdk/doctor` adds the Privy app id format, the RPC chain id (97741), bundler and paymaster reachability, and, when you inject the checker, the dashboard rows:

```ts
import { runDoctor } from "@pepu-chain/sdk/doctor";
import { privyDashboardChecker } from "@pepu-chain/sdk/privy";

const report = await runDoctor({
  env: process.env,
  template: "sponsored-session-app",
  checkPrivyDashboard: privyDashboardChecker,
});
for (const c of report.checks.filter((c) => c.status !== "pass")) console.log(c.id, c.status, c.fix);
```

Check ids: `env.<NAME>`, `privy.app-id`, `chain.rpc`, `sponsorship.bundler`, `sponsorship.paymaster`, `privy.<requirement key>`. Statuses are `pass`, `fail`, `warn` and `skip`. A bundler or paymaster URL that is unset is a skip; set but unreachable is a fail. `runDoctor` does not pass an origin, so `privy.allowed-origins` comes back a warning. Use the next two for the origin.

### `checkPrivyDashboardConfig`

```ts
import { checkPrivyDashboardConfig } from "@pepu-chain/sdk/privy";
const r = await checkPrivyDashboardConfig({ appId, origin: "http://localhost:3000" });
// r.ok is false only if a REQUIRED row definitely failed
for (const i of r.items) console.log(i.id, i.ok, i.detail, i.fix);
```

It never throws and needs no secret. Each item is `true`, `false` or `"unknown"`. Rows: `allowed-origins`, `login-methods`, `login-methods.google`, `embedded-wallets`, `smart-wallets`. Env and code rows (`app-id`, `app-secret`, `coinbase-eoa-only`, `authorization-key-quorum`) are in `PEPU_PRIVY_REQUIREMENTS` but cannot be checked remotely.

### `pepu_check_privy_config`

The MCP tool wraps the same function: inputs `appId`, optional `origin` (with port) and optional `pillars` (`login`, `session`, `sponsor`). It returns `dashboard` rows with `pass`, `fail` or `unknown` and a fix, plus `notRemotelyCheckable` rows. Needs network access to `auth.privy.io`. Pair it with `pepu_check_env`, and use `/pepu-doctor` to run both.

## Reading the output

| Result | Meaning |
|---|---|
| pass | Verified from Privy's public config |
| fail | Definitely wrong; apply the `fix` |
| unknown or warn | Privy did not report it, or the origin was not given. Not a failure; verify by hand |
| skip | Not applicable (env or code rows, or no URL configured) |

## Common failures mapped to dashboard fields

| Check failing | Dashboard field | Fix |
|---|---|---|
| `allowed-origins` | Allowed origins | Add the exact origin with port |
| `login-methods` | Login methods | Enable the methods in `loginMethods` |
| `login-methods.google` | Socials, Google | Turn Google on |
| `embedded-wallets` | Embedded wallets | Turn on for Ethereum |
| `smart-wallets` | Smart Wallets | Chain 97741, Kernel, both URLs (Privy transport only) |
| `env.PRIVY_AUTHORIZATION_KEY`, quorum | Authorization keys | [Authorization Keys](authorization-keys.md) |
| `privy.app-id` format | Settings, Basics | Use the App ID, not the secret or client id |

## Related

- [Dashboard Settings, Field by Field](dashboard-settings.md)
- [Environment Variables](../reference/env-vars.md)
- [/doctor](../sdk/doctor.md), [/privy](../sdk/privy.md)
- [MCP Tool Reference](../mcp/tools.md)
