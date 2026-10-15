# Template: Token-Gated App

The `token-gated-app` template signs a user in, then unlocks content when their wallet holds a positive balance of an ERC-20 or an NFT. The balance checks are batched into one RPC round trip through PEPU's own Multicall3. Use it for holder-only content, communities and perks.

> Status: Google to wallet is Proven on mainnet (the wallet provisioning pattern here was proven against a live Privy app, per the template README). The gate check is a free read. The README notes the template's own provisioning is not independently re-verified against a live Privy app yet.

## What it demonstrates

| Pillar | Covered |
|---|---|
| Google to wallet | Yes: login, server-side wallet provisioning, embedded wallet as the active account |
| Session keys | No |
| Sponsored transactions | No. The balance check is a read and costs no gas |

- Signed in: shows the embedded wallet's address and PEPU balance, then one batched read checks the configured token balance or balances. Any positive balance of at least one configured token unlocks the gated panel.
- The rule is deliberately the simplest possible (`balance > 0`): no minimum, allowlist or tiers. The batched-read pattern is the part worth reusing.

## Scaffold

```bash
npx create-pepu-app@latest my-app --template token-gated-app
```

## SDK functions it uses

| Job | SDK function (subpath) | Where |
|---|---|---|
| Providers, mainnet-only Privy config, active-wallet pin | `PepuPrivyWagmiProvider` (`/privy/wagmi`) | `app/providers.tsx` |
| Wallet provisioning | `useEnsureWallet` (`/privy/react`) | `WalletGate` in `components/signed-in-view.tsx` |
| Server-side wallet creation | `createEnsureWalletRoute` (`/privy/server`) | `app/api/wallet/ensure/route.ts` |
| Embedded versus external wallet | `useEmbeddedWallet` (`/privy/react`) | `components/wallet-card.tsx` |
| Batched balance reads | `pepuMulticall` (core), viem's `multicall` pinned to PEPU's own Multicall3 | `components/token-gate-panel.tsx` |
| Chain facts, explorer links | `pepuMainnet`, `explorerLinks` (core) | wallet card, gate panel |
| Env check | `checkPepuEnv` (`/doctor`) | `scripts/doctor.mjs` |

The ERC-20 and ERC-721 read ABIs come from viem (`erc20Abi`, `erc721Abi`); the SDK does not ship its own. PEPU's Multicall3 is `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`, not the canonical address. See [The Multicall3 Trap](../contracts/multicall3.md).

## Environment and Privy settings

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Public. |
| `PRIVY_APP_SECRET` | Yes | Server only. |
| `NEXT_PUBLIC_GATE_ERC20_ADDRESS` | At least one of the two | Defaults in `.env.example` to WPEPU (`0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8`), only so the template runs out of the box. It is not a recommendation to gate on WPEPU: replace it with your token. |
| `NEXT_PUBLIC_GATE_ERC721_ADDRESS` | At least one of the two | Blank by default. Deploy the `nft-mint` template or your own ERC-721 and paste its address. The template will not invent an address. |

The doctor reports an error until at least one gate address is valid.

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
npm run doctor
npm run dev        # http://localhost:3000
```

## Project structure

```text
app/            layout, providers, page (behind SetupGate), api/wallet/ensure
components/     signed-out-view, signed-in-view, wallet-card, token-gate-panel, gated-content, setup-gate, missing-config-notice
lib/env.ts      parses the gate addresses once
lib/format.ts   address and token-amount formatting for any decimals
scripts/doctor.mjs
```

## What is proven and what is not

| Item | State |
|---|---|
| Login and wallet provisioning pattern | Proven against a live Privy app, per the README |
| Batched gate read through PEPU's Multicall3 | Uses `pepuMulticall`; the Multicall3 deployment is verified on mainnet |
| Server-side enforcement | Not included. The check runs in the browser and can be bypassed by editing browser state |

## Customizing it

- Replace `components/gated-content.tsx` with what you gate.
- Set your own token addresses. For tiers or minimums, change the rule in `components/token-gate-panel.tsx`.
- If you gate something server-enforced (an API route, a paid download), re-check the balance on the server too.
- If you add a write path, remember the user pays gas. Do not add a gasless badge without real sponsorship.

## Screenshots

Placeholders, not yet captured:

| Slot | Shows |
|---|---|
| Locked | The gate panel with zero balance |
| Unlocked | The gated content after a positive balance |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| The app shows a setup screen | Neither gate address is set to a valid address | Set `NEXT_PUBLIC_GATE_ERC20_ADDRESS` or `NEXT_PUBLIC_GATE_ERC721_ADDRESS`. |
| The batched read fails | Hardcoded canonical Multicall3 address in custom code | Use `pepuMulticall` from the SDK. |
| Login hangs or returns 403 | Wrong port or origin | Use `http://localhost:3000` and add it to Allowed origins. |

## Related

- [Template Gallery](index.md)
- [Gate Content by Token Balance](../recipes/gate-content-by-token-balance.md)
- [Batch Reads with Multicall3](../recipes/batch-reads-with-multicall3.md)
- [Template: NFT Mint](nft-mint.md)
