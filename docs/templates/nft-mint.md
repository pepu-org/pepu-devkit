# Template: NFT Mint

The `nft-mint` template is an ERC-721 mint page: connect, see the collection's live mint price and supply, mint with a real transaction and list the tokens the wallet owns. It ships the `PepuNft` contract twice, for Foundry and for Hardhat. Use it as the base for a mint page for your own collection.

> Status: Google to wallet is Proven on mainnet (wallet provisioning pattern proven against a live Privy app, per the template README). There is no pre-deployed collection: you deploy `PepuNft` yourself before the app runs. Minting is a real transaction and the user pays gas.

## What it demonstrates

| Pillar | Covered |
|---|---|
| Google to wallet | Yes |
| Session keys | No |
| Sponsored transactions | No. Even a zero-price mint costs the caller gas, and there is no gasless badge |

- Collection read in one batched Multicall3 call: name, symbol, mint price, total supply, `MAX_SUPPLY`.
- A Mint button that sends a real transaction.
- The owned token ids, from a second batched read using `ERC721Enumerable`.

## Scaffold

```bash
npx create-pepu-app@latest my-app --template nft-mint
```

## Deploy the contract first

Pick one toolchain, each in `contracts/`:

- `contracts/foundry` (Foundry, `forge` and `cast`)
- `contracts/hardhat` (Hardhat with TypeScript)

Both deploy the same `PepuNft`: OpenZeppelin Contracts v5.7.0 `ERC721`, `ERC721Enumerable` and `Ownable`, with `MAX_SUPPLY = 1000`, token ids from 1, and a `payable` `mint()` whose price the deployer sets. Neither project is wired into the Next.js build. If `foundry-zksync` is installed, the `forge` on your PATH may be the wrong fork for an Arbitrum Orbit chain: run `forge --version` and confirm it does not mention `zksync`. Verification and deployment: [Deploy and Verify a Contract](../contracts/deployment.md).

Then set `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` to the deployed address.

## SDK functions it uses

| Job | SDK function (subpath) | Where |
|---|---|---|
| Providers, mainnet-only Privy config, active-wallet pin | `PepuPrivyWagmiProvider` (`/privy/wagmi`) | `app/providers.tsx` |
| Wallet provisioning | `useEnsureWallet` (`/privy/react`), `createEnsureWalletRoute` (`/privy/server`) | `WalletGate`, `app/api/wallet/ensure/route.ts` |
| Embedded versus external wallet | `useEmbeddedWallet` (`/privy/react`) | `components/wallet-card.tsx` |
| Batched collection reads | `pepuMulticall` (core), pinned to PEPU's Multicall3 | `components/mint-panel.tsx` |
| Owned tokens | wagmi `useReadContracts`, routed through the same Multicall3 because `pepuMainnet` carries `contracts.multicall3` | `components/owned-tokens.tsx` |
| Chain facts, explorer links, amount formatting | `pepuMainnet`, `explorerLinks`, `formatPepu` (core) | wallet card, mint panel |
| Env check | `checkPepuEnv` (`/doctor`) | `scripts/doctor.mjs` |

The contract ABI is the template's own (`lib/nft-abi.ts`), covering only the functions the app calls.

## Environment and Privy settings

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Public. |
| `PRIVY_APP_SECRET` | Yes | Server only. |
| `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` | Yes | Blank on purpose. Until set, a setup screen shows the exact steps. |

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
# deploy the contract first (contracts/foundry or contracts/hardhat)
npm install
npm run doctor
npm run dev        # http://localhost:3000
```

Fund the wallet with a little PEPU: a mint needs gas, plus the mint price if it is above zero.

## Project structure

```text
app/            layout, providers, page (behind SetupGate), api/wallet/ensure
components/     signed-out-view, signed-in-view, wallet-card, mint-panel, owned-tokens, gas-notice, setup-gate, missing-config-notice
lib/            env.ts, nft-abi.ts, format.ts
scripts/doctor.mjs
contracts/      foundry/ and hardhat/ (PepuNft)
```

## What is proven and what is not

| Item | State |
|---|---|
| Login and wallet provisioning pattern | Proven against a live Privy app, per the README |
| Batched reads through PEPU's Multicall3 | Uses the SDK's `pepuMulticall`; Multicall3 is verified deployed on mainnet |
| End-to-end mint on your deployed collection | Depends on your deployment. The README does not claim a live mint run |

## Customizing it

- Change the supply, price or metadata in `contracts/`, redeploy and update the address and `lib/nft-abi.ts`.
- To list a collection somewhere, note that being listed (for example on PepuSwap) is a third-party decision and is not automatic from deploying.
- For a gasless mint you would need real sponsorship ([Sponsored Transactions](../onboarding/sponsored-transactions.md)), which this template does not include.

## Screenshots

Placeholders, not yet captured:

| Slot | Shows |
|---|---|
| Mint panel | Live price, supply and the Mint button |
| Owned tokens | The wallet's token ids after a mint |

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Setup screen with deployment steps | `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` is blank | Deploy `PepuNft` and set the address. |
| Deploy goes wrong or produces odd output | `forge` is the `foundry-zksync` fork | Install upstream Foundry and recheck `forge --version`. |
| Mint transaction fails | Not enough PEPU for gas plus the price, or supply is exhausted | Fund the wallet, or check `totalSupply` against `MAX_SUPPLY`. |

## Related

- [Template Gallery](index.md)
- [Deploy an ERC-20](../recipes/deploy-an-erc20.md)
- [Deploy and Verify a Contract](../contracts/deployment.md)
- [Template: Token-Gated App](token-gated-app.md)
