# Quickstart: Zero to a Sponsored Transaction in 10 Minutes

Copy-paste path from nothing to a running Next.js app on Pepe Unchained V2 that sends a real transaction whose gas someone else pays. You choose a template, scaffold it, fill two Privy values, click through the Privy dashboard once, get a paymaster project (for the sponsored templates), run `npm run doctor`, run the app and send. If you only want login and a wallet, the first six steps are the whole job and take about five minutes. To let an AI agent do it, see [Build with an AI Coding Agent](ai-assisted.md). To deploy only a Solidity contract, see [Deploy and Verify a Contract](../contracts/deployment.md).

> Status: proven. The CLI (`create-pepu-app` 0.1.3), the templates and the SDK (`@pepu-chain/sdk` 0.2.2) are on npm. The two sponsored templates use the hosted [bundler](../reference/glossary.md) (`https://bundler.pepeunchained.com`) and [paymaster](../reference/glossary.md) (`https://paymaster.pepeunchained.com`); they need a [project](../reference/glossary.md) of yours (claim, deposit, token), because the [free tier](../reference/glossary.md) is only for PEPU's own Privy app. The v2 paymaster is deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches, so keep deposits small.

## Prerequisites

- Node.js 18.17 or newer and npm. You do not clone this repository.
- A Privy account (free): [dashboard.privy.io](https://dashboard.privy.io).
- For a sponsored template only: a wallet holding a little PEPU (for the one-time project setup and the deposit). Buy PEPU on an exchange or bridge via [pepubridge.com](https://pepubridge.com). A transaction costs a fraction of a cent.

## 1. Pick a template

Answer one question: **who pays gas, and does the user approve each action?**

| You want | Template | Smart account path | Extra setup |
|---|---|---|---|
| Login, a wallet, a real PEPU send. Users pay gas | `consumer-app` (default) | none (plain wallet) | none |
| Unlock content by holding a token or NFT | `token-gated-app` | none | a gate token address |
| An NFT mint page | `nft-mint` | none | deploy the contract |
| Popup-free play, user pays gas, limits enforced by Privy | `game-app` | none (Privy session signers) | authorization key, key quorum, a deployed contract |
| One gasless button, client only | `sponsored-demo` | Privy Smart Wallets | Smart Wallets in the dashboard, a project **client** token |
| One signature, then no popups and no user gas, limits enforced on-chain | `sponsored-session-app` | ZeroDev-native | a project **server** key |

Not sure? Take `consumer-app` to see login work, or `sponsored-session-app` for the full experience. The difference between the two smart-account paths is explained in [Smart Account Paths](../concepts/smart-account-paths.md); the template list with more detail is the [Template Gallery](../templates/index.md).

## 2. Scaffold

```bash
npx create-pepu-app@latest my-app --template sponsored-session-app
cd my-app
```

Swap the template name for the one you picked. With no `--template` it asks. The CLI copies the template, creates `.env.local` from `.env.example`, adds `.mcp.json` and agent files, installs dependencies and prints the next steps. If it did not install, run `npm install`. Flags (`--yes`, `--pm`, `--no-install`, `--json`) are in [create-pepu-app CLI](../cli/create-pepu-app.md).

## 3. Get your Privy values

1. Open [dashboard.privy.io](https://dashboard.privy.io), create an app, and open Settings, Basics.
2. Copy the **App ID** and create an **App Secret**.
3. Put them in `.env.local`:

```
NEXT_PUBLIC_PRIVY_APP_ID=<your App ID>
PRIVY_APP_SECRET=<your App Secret>
```

The App ID is public. The secret is server only: never prefix it `NEXT_PUBLIC_`, never commit it.

## 4. Click through the Privy dashboard

Four settings decide whether login works. Do them now; the exact menu paths and failure symptoms are in [Dashboard Settings, Field by Field](../privy/dashboard-settings.md).

| # | Setting | Value |
|---|---|---|
| 1 | Allowed origins (Configuration, App settings) | `http://localhost:3000`, with the port. Add your production origin later |
| 2 | Login methods (User management, Authentication) | Enable Google and email |
| 3 | Embedded wallets (Wallets) | On for Ethereum, create wallets on login |
| 4 | Smart Wallets (Wallets, Smart wallets) | **Only for `sponsored-demo`**: provider Kernel v3.1, chain 97741, bundler `https://bundler.pepeunchained.com`, paymaster URL from step 5. Every other template: leave it alone |

Port 3000 must be free. If it is taken, Next.js silently starts on 3001 and login fails with errors that never mention the port. Free 3000 rather than working around it.

## 5. Get a paymaster project (sponsored templates only)

Skip this step for `consumer-app`, `token-gated-app`, `nft-mint` and `game-app`.

A sponsored transaction is paid from a project budget that you own. Getting one is claim, configure, deposit, register; it takes a script about two minutes. Follow [Register, Deposit and Claim a v2 Project](../infra/paymaster/v2-register-deposit-claim.md): it has the SDK code, the runnable recipe ([Deposit and Claim a Paymaster Project](../recipes/v2-deposit-and-claim.md)), and an MCP and agent route for the parts a tool can encode. At the end you hold two credentials, shown once:

| Credential | Looks like | Use it in |
|---|---|---|
| Server key | `ppk_...` (secret) | `sponsored-session-app`: `PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<server key>` in `.env.local` |
| Client token | `ppt_...` (publishable, works only from your allowed origins) | `sponsored-demo`: the paymaster URL in the Privy dashboard (step 4, row 4) |

Make sure your project's targets include the contract the template calls: both sponsored templates call `TapScore` (`0x261eA5971B93237a56990206A46Bc80318e4d078`), and the per-wallet daily limit must be above about 21 PEPU, with a project balance of at least about 25 PEPU, or a new user's first action (which deploys their account) is denied.

For `sponsored-session-app` your `.env.local` now also has:

```
PEPU_BUNDLER_URL=https://bundler.pepeunchained.com
PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<server key>
```

Never commit it. Template-specific variables are in [Environment Variables](../reference/env-vars.md).

## 6. Run the doctor

```bash
npm run doctor
```

It checks `.env.local` against your template, the chain RPC, the bundler and paymaster, and your Privy dashboard settings (including that `http://localhost:3000` is an allowed origin). It never prints values. **Success looks like** lines starting `ok` and a final `ok   no failing checks`:

```text
ok   privy.app-id: Privy app id format looks right.
ok   chain.rpc: RPC reachable, chainId 97741.
ok   sponsorship.bundler: Bundler reachable and reports supported entry points.
ok   sponsorship.paymaster: Paymaster endpoint reachable.
ok   privy.allowed-origins: The page origin (including the port) is in Allowed origins: http://localhost:3000 is allowed.
ok   privy.embedded-wallets: Embedded wallets are enabled for Ethereum ...
ok   no failing checks
```

| Line | Meaning |
|---|---|
| `FAIL` | Fix it before you run the app; the message names the variable or setting |
| `WARN ... could not be verified` | Privy's public config did not report that setting. Not a failure: check the dashboard row by hand |
| `skip` | The check does not apply to this template, or you passed `--offline` |

Running on another port: `PEPU_APP_ORIGIN=http://localhost:3001 npm run doctor`, after adding that origin in the dashboard.

## 7. Run the app and send your first sponsored transaction

```bash
npm run dev
```

Open `http://localhost:3000` and check the terminal says port 3000. Then:

| Template | Click | You should see |
|---|---|---|
| `consumer-app` | Sign in, send a small PEPU amount (the wallet needs PEPU) | Your address and balance, then a transaction link. Gas is not sponsored; a permanent notice says so |
| `sponsored-session-app` | Sign in with Google, **Start session**, **Approve**, sign once in Privy, then **Tap** | No popup on Tap. After a few seconds an evidence panel shows a pepuscan link, the sender (your smart account, not your wallet), "Gas paid by paymaster" and a cost. The smart account holds 0 PEPU |
| `sponsored-demo` | Sign in, **Sponsor a tap** | The Kernel smart account (0 PEPU), a transaction link, and the paymaster's EntryPoint deposit dropping. That drop, not the hash, is the proof |

Wallet creation shows "Setting up your wallet..." for a moment on first login. A brand-new account's first sponsored operation also deploys the account, so it takes longer and costs more than the next one.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Login fails, iframe blocked, OAuth 403 | Origin or port missing from Allowed origins | Step 4, row 1 |
| Setup screen on load | A required env key is missing | Run `npm run doctor`, set the key, restart `npm run dev` |
| `/api/wallet/ensure` returns 500 | `PRIVY_APP_SECRET` unset, or the dev server was not restarted | Set it and restart |
| No "Continue with Google" button | Google is off in the dashboard | Step 4, row 2 |
| Page spins on "Setting up your smart wallet..." | `sponsored-demo` without Smart Wallets for chain 97741 | Step 4, row 4 |
| `project_origin_not_allowed` | A client token with no allowed origins, or a client token used from a server | Set allowed origins on the project, or use the server key from the server |
| `PAYMASTER_DESTINATION_NOT_ALLOWED` | The project's targets do not include `TapScore` | Run the `configure` step again with the contract |
| `trailing-hour spend ... would exceed cap` after the first tap | The per-wallet limit is below the first-operation reservation | Raise the per-wallet limit above about 21 PEPU |
| Privy refuses a send you can afford | Its conservative gas estimate at PEPU's roughly 12,500 gwei base fee | See [Troubleshooting](../troubleshooting.md) |

## Next steps

- [Smart Account Paths](../concepts/smart-account-paths.md): why the two sponsored templates differ and which to ship
- [The Three Pillars](pillars.md)
- [Session Keys](../onboarding/session-keys.md) and [Sponsored Transactions](../onboarding/sponsored-transactions.md)
- [Template Gallery](../templates/index.md)
- [Recipes](../recipes/read-a-contract.md)
- [SDK Overview and Reference](../sdk/reference.md)
- [Build with an AI Coding Agent](ai-assisted.md)
