# Privy Configuration Overview

Everything about configuring Privy for a PEPU app: which feature needs which setting, how the SDK and tools verify settings, and where each detail page lives. Start here when login, wallets, sessions or Smart Wallets misbehave.

Menu labels in the dashboard can change; the SDK table `PEPU_PRIVY_REQUIREMENTS` is the checklist of record.

## Prerequisites

- A Privy app. Env: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`.

## Feature to setting matrix

| Feature | Settings it needs | Page |
|---|---|---|
| Google or email login | App ID, secret, Allowed origins (with port), Login methods, Google | [Dashboard Settings](dashboard-settings.md) |
| Embedded wallet | Embedded wallets on for Ethereum; server route with the secret; Coinbase `eoaOnly` (code) | [Embedded Wallets](../onboarding/privy-embedded-wallets.md) |
| Privy session signers | Authorization key, key quorum, `PRIVY_AUTHORIZATION_KEY`, `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` | [Authorization Keys](authorization-keys.md) |
| Smart Wallets (Privy sponsorship transport) | Smart Wallets: chain 97741, Kernel, bundler URL, paymaster URL | [Dashboard Settings](dashboard-settings.md) |
| Kernel session plus sponsorship (the combination) | Login settings only. No Smart Wallets, no authorization key | [End to End](../onboarding/google-session-sponsored.md) |

## How settings are verified

- `PEPU_PRIVY_REQUIREMENTS` is one data table: id, where (`dashboard`, `env` or `code`), label, required, pillars, fix and docs URL. It feeds the docs, the MCP tool, the doctor and in-app notices.
- `checkPrivyDashboardConfig` reads the public app-config endpoint and reports pass, fail or unknown for the dashboard rows.
- `pepu_check_privy_config` is that function as an MCP tool.
- `npm run doctor` checks env presence and shape.

Details: [Privy Env Vars and Verification](env-and-checks.md).

## Pages in this section

- [Privy Setup Walkthrough](../onboarding/privy-setup.md): the short first-time procedure.
- [Dashboard Settings, Field by Field](dashboard-settings.md)
- [Authorization Keys and Key Quorums](authorization-keys.md)
- [Privy Env Vars and Verification](env-and-checks.md)

## Common failures

| Symptom | Go to |
|---|---|
| Login fails or the iframe is blocked | Allowed origins in [Dashboard Settings](dashboard-settings.md) |
| "Creating your wallet..." hangs | [Embedded Wallets](../onboarding/privy-embedded-wallets.md) |
| 401 "No valid authorization keys" | [Authorization Keys](authorization-keys.md) |
| "Setting up your smart wallet..." hangs | Smart Wallets in [Dashboard Settings](dashboard-settings.md) |

## Related

- [The Three Pillars](../get-started/pillars.md)
- [/privy](../sdk/privy.md)
