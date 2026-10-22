# Template: Consumer App

The `consumer-app` template shows that onchain onboarding can feel like a normal app: sign in with email or Google, get an embedded wallet, see a live PEPU balance and send native PEPU, with no seed phrase and no browser extension. It is the best first template and the base the other starters build on.

No sponsorship: the user pays gas in PEPU.

## What it demonstrates

| Pillar | Covered |
|---|---|
| Google to wallet | Yes: login (email, Google, or an existing wallet), server-side wallet provisioning, embedded wallet as the active account |
| Session keys | No |
| Sponsored transactions | No. A permanent notice says sponsorship is not usable by this app, and there is no "gasless" badge |

- Signed out: a landing page with one sign-in button.
- Signed in: provisions the wallet if the user has none, shows its address (copy button and a pepuscan link), its live PEPU balance and a form to send native PEPU with a pending state and a transaction link.
- Gas notice: every send costs the user real PEPU, a fraction of a cent.

## Scaffold

```bash
npx create-pepu-app@latest my-app --template consumer-app
```

See [create-pepu-app CLI](../cli/create-pepu-app.md) for every flag.

## SDK functions it uses

| Job | SDK function (subpath) | Where |
|---|---|---|
| Privy, react-query and wagmi providers, mainnet-only Privy config, active-wallet pin | `PepuPrivyWagmiProvider` (`/privy/wagmi`), which uses `createPepuPrivyConfig`, `pepuWagmiConfig` and `useActiveWalletPin` | `app/providers.tsx` |
| Wallet provisioning (request, timeouts, `refreshUser`, retry) | `useEnsureWallet` (`/privy/react`) | `WalletGate` in `components/signed-in-view.tsx` |
| Server-side wallet creation | `createEnsureWalletRoute` (`/privy/server`) | `app/api/wallet/ensure/route.ts` |
| Embedded versus external wallet | `useEmbeddedWallet` (`/privy/react`) | `components/wallet-card.tsx` |
| Chain facts, explorer links, amount formatting | `pepuMainnet`, `explorerLinks`, `formatPepu` (core) | wallet card, send form, network badge |
| Env check | `checkPepuEnv` (`/doctor`) | `scripts/doctor.mjs` |

## Environment and Privy settings

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Public by design. |
| `PRIVY_APP_SECRET` | Yes | Server only. Used by `app/api/wallet/ensure/route.ts`. |

No optional variables.

Privy dashboard checklist (the same list sits in the template's `.env.example`). Doctor requirements `login-methods`, `allowed-origins`, `embedded-wallets`:

- Env: `NEXT_PUBLIC_PRIVY_APP_ID` (public) and `PRIVY_APP_SECRET` (secret, server only), both under Settings, Basics.
- Allowed origins: the exact origin with the port, `http://localhost:3000`, plus your production domain.
- Login methods: email, Google and external wallet, matching `loginMethods` in `app/providers.tsx` (enable what you list).
- Embedded wallets: enable for Ethereum, create on login. `WalletGate` calls `/api/wallet/ensure` after login and creates the wallet server-side with the app secret if the dashboard setting is off, so both together is fine. TEE (user-controlled) mode is what the live tests used.
- Smart Wallets: leave off. Not used here; enabling it is harmless.
- Coinbase Wallet is pinned to `eoaOnly` in code because it does not support chain `97741`.

Field by field: [Dashboard Settings, Field by Field](../privy/dashboard-settings.md).

## Run and check

```bash
cd my-app
npm install
npm run doctor      # ok or FAIL per key, no values printed
npm run dev         # http://localhost:3000, the port must be free
```

Fund the wallet with a small amount of PEPU to send something. Mainnet gas costs a fraction of a cent.

## Project structure

```text
app/            layout, providers (PepuPrivyWagmiProvider), page, api/wallet/ensure
components/     signed-out-view, signed-in-view, wallet-card, send-pepu-form, gas-notice, missing-config-notice
lib/format.ts   address truncation
scripts/doctor.mjs
contracts/      foundry and hardhat projects with a trivial example contract
```

## Limitations

- Sending PEPU is a standard wagmi send. Privy's pre-flight gas check is conservative at PEPU's base fee of about 12,500 gwei.
- No sponsorship: the user pays gas in PEPU.

Privy runs two wallet architectures, and which one your Privy app uses changes what happens on login. The template README spells it out.

## Customizing it

- Add your own panels to `components/signed-in-view.tsx`; keep `WalletGate` so a signed-in user always has a wallet.
- To let an external wallet be the active account, pass `pinEmbeddedWallet={false}` to `PepuPrivyWagmiProvider`. The default is deliberate: the template's story depends on the embedded wallet being the sender.
- Do not add a "Max" button: Privy's pre-flight balance check is over-conservative at PEPU's base fee. If you build one, size it with `maxSendableAmount()` from the SDK.
- Do not add a gasless badge unless you wire real sponsorship ([Sponsored Transactions](../onboarding/sponsored-transactions.md)).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Login hangs or returns 403 | The app is on port 3001, or the origin is not in Allowed origins | Free port 3000, or add the exact origin to Privy. |
| Wallet never appears | Automatic creation is off and the fallback route lacks the secret | Set `PRIVY_APP_SECRET` and check the `app/api/wallet/ensure` route. |
| A different address sends the transaction | A browser extension became the active wagmi account | Keep `PepuPrivyWagmiProvider` (it pins the embedded wallet). |
| Privy refuses a transfer the wallet can afford | Its pre-flight gas check is conservative at the PEPU base fee | Send a slightly smaller amount. |
| "Unable to fetch token price" in the console | Harmless Privy noise | Ignore it. |

## Related

- [Template Gallery](index.md)
- [Social Login and Embedded Wallets (Privy)](../onboarding/privy-embedded-wallets.md)
- [Provision the Wallet and Pin the Active Account](../recipes/provision-and-pin-the-wallet.md)
- [create-pepu-app CLI](../cli/create-pepu-app.md)
