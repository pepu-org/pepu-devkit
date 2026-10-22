# Template: Game App

The `game-app` template shows how a game can write on-chain on every move without a wallet popup per move. The player signs in with Google or email, grants one scoped Privy session signer, and then taps. Each tap is a real transaction submitted by the app's backend on the player's behalf. The player pays gas.

No sponsorship: the user pays gas in PEPU.

## What it demonstrates

| Pillar | Covered |
|---|---|
| Google to wallet | Yes |
| Session keys | Yes: a Privy session signer on a plain embedded wallet. The scope is enforced off-chain by Privy's policy engine |
| Sponsored transactions | No. The player's wallet pays gas, a fraction of a cent per tap |

The flow: sign in, grant a session (one consent screen, one signature), play (the backend submits `tap()` with no further prompts), revoke at any time or let it expire.

The scope, built by `buildSessionPolicy` from the one definition in `lib/scope.ts`:

| Constraint | Value |
|---|---|
| Contract | only the deployed `TapScore` address |
| Function | only `tap()`, matched by selector |
| Value | exactly `0x0` |
| Expiry | denied after `SESSION_DURATION_MINUTES` |

Trust model, stated in the app and the README: Privy's backend policy engine enforces the scope. There is no on-chain validator to audit. For the on-chain model see [`sponsored-session-app`](sponsored-session-app.md).

## Scaffold

```bash
npx create-pepu-app@latest my-app --template game-app
```

## SDK functions it uses

| Job | SDK function (subpath) | Where |
|---|---|---|
| Providers and active-wallet pin | `PepuPrivyWagmiProvider` (`/privy/wagmi`) | `app/providers.tsx` |
| Wallet provisioning | `createEnsureWalletRoute` (`/privy/server`), `useEnsureWallet`, `useEmbeddedWallet` (`/privy/react`) | `app/api/wallet/ensure`, `components/` |
| Scoped policy and consent data | `buildSessionPolicy`, `describeSessionScope`, `SESSION_TRUST_NOTICE`, `PRIVY_POLICY_NAME_MAX_LENGTH` (`/session`) | `lib/scope.ts`, `components/session-consent-screen.tsx` |
| Grant, status and revoke routes | `createSessionRoutes` (`/session/server`) | `app/api/session/*` |
| One gameplay transaction: Privy signs, the SDK broadcasts | `createSessionActionRoute` (`/session/server`) | `app/api/game/tap` |
| Client session flow | `useSessionGrant`, `useSessionStatus`, `useSessionRevoke`, `useSessionAct` (`/session/react`) | `components/` |
| Authorization key generation | `generatePrivyAuthorizationKey` (`/doctor`) | `scripts/generate-authorization-key.mjs` |
| Explorer links | `explorerLinks` (core) | components |

Privy's server-side `eth_sendTransaction` does not support chain `97741`. The SDK works around it by asking Privy to sign only (`eth_signTransaction`) and broadcasting the signed transaction to PEPU's RPC itself, with a 20% gas-limit buffer. See [Sign with Privy, Broadcast Yourself](../recipes/sign-with-privy-broadcast-yourself.md).

## Environment and Privy settings

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Yes | Public. |
| `PRIVY_APP_SECRET` | Yes | Server only. Authenticates the backend that submits taps and provisions wallets. |
| `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` | Yes | Id of the key quorum Privy returns after you register the public key. An identifier, not a secret. |
| `PRIVY_AUTHORIZATION_KEY` | Yes | The private half, base64 PKCS8. A real secret: anyone holding it can request transactions as any wallet that granted a signer to the quorum, bounded by the policy. Never commit it. |
| `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS` | Yes | Your deployed `TapScore`. The policy names this contract explicitly. |
| `SESSION_DURATION_MINUTES` | No | Default 15, clamped to 1440. Baked into the policy expiry, so Privy enforces it. |
| `PEPU_RPC_URL` | No | Server only. RPC the backend broadcasts to. Without it the SDK uses the public default. |

Privy dashboard checklist (the same list sits in the template's `.env.example`). Doctor requirements `login-methods`, `allowed-origins`, `embedded-wallets`, `authorization-key-quorum`:

- Env: `NEXT_PUBLIC_PRIVY_APP_ID` (public) and `PRIVY_APP_SECRET` (secret, server only), both under Settings, Basics.
- Allowed origins: the exact origin with the port, `http://localhost:3000`, plus your production domain.
- Login methods: email, Google and external wallet, matching `loginMethods` in `app/providers.tsx` (enable what you list).
- Embedded wallets: enable for Ethereum, create on login. `WalletGate` calls `/api/wallet/ensure` after login and creates the wallet server-side with the app secret if the dashboard setting is off, so both together is fine. TEE (user-controlled) mode is what the live tests used.
- Smart Wallets: not needed. This template uses a session signer on a plain embedded wallet.
- Coinbase Wallet is pinned to `eoaOnly` in code because it does not support chain `97741`.
- Authorization key and key quorum (Wallet infrastructure, Authorization keys): run `npm run generate-authorization-key`, register the public key, put it in a key quorum, and set `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` (public id) and `PRIVY_AUTHORIZATION_KEY` (the private half, secret). They must come from the same pair. Policy and rule names are limited to 49 characters.

See [Authorization Keys and Key Quorums](../privy/authorization-keys.md) and [Dashboard Settings, Field by Field](../privy/dashboard-settings.md).

## Run and check

```bash
cd my-app
npm install
npm run generate-authorization-key   # register the public half in Privy, then fill .env.local
# deploy contracts/foundry or contracts/hardhat (TapScore) and set NEXT_PUBLIC_GAME_CONTRACT_ADDRESS
npm run doctor
npm run dev                          # http://localhost:3000
npm test                             # the scope tests
```

TapScore is also deployed on mainnet at `0x261eA5971B93237a56990206A46Bc80318e4d078` (used by the sponsored templates). Deploy your own for your own game.

## Project structure

```text
app/api/config/          booleans only, never values
app/api/wallet/ensure/   createEnsureWalletRoute()
app/api/session/*        createSessionRoutes(): grant, status, revoke
app/api/game/tap/        createSessionActionRoute(): one gameplay tx
components/              session-consent-screen (the most important UI), session-status-card, game-board
lib/scope.ts             the ONE session scope and the game ABI
lib/env.ts               client-safe NEXT_PUBLIC_* values
contracts/               TapScore for Foundry and Hardhat
```

## Limitations

- Sessions are Privy session signers scoped off-chain. The user pays gas.

## Customizing it

- To add a gameplay function, add its ABI fragment to `lib/scope.ts` and add a condition for it. Widening the policy widens what a compromised key can do.
- Keep gameplay functions non-payable: that is what makes the zero-value condition meaningful.
- Keep sessions short. The 15 minute default is deliberate.
- Never add a code path that grants an unscoped signer. An empty `policyIds` makes a signer effectively unscoped over the whole wallet, and `buildSessionPolicy` refuses to build one.
- Policy and rule names must be at most 49 characters (Privy's live validator); `buildSessionPolicy` enforces it.
- Keep the off-chain notice in the README and the consent screen. Do not soften it.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Grant fails with a name error | A custom policy name is 50 characters or more | Keep names at 49 or fewer. |
| A tap returns 409 or is denied | The session expired, was revoked, or the call is outside the scope | Grant a new session; check `lib/scope.ts` against the call. |
| "Unsupported chain with id 97741" | Something is calling Privy's server-side `eth_sendTransaction` | Use `createSessionActionRoute`, which signs and broadcasts itself. |
| Taps fail to broadcast | Public RPC rate limit | Set `PEPU_RPC_URL` to an authenticated endpoint. |
| Login hangs or returns 403 | Wrong port or origin | Use `http://localhost:3000` and allow it in Privy. |

## Related

- [Template Gallery](index.md)
- [Session Keys: No Popup Per Transaction](../onboarding/session-keys.md)
- [Grant a Session](../recipes/grant-a-session.md)
- [Template: Sponsored Session App](sponsored-session-app.md)
