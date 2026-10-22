# Social Login and Embedded Wallets (Privy)

Pillar 1 of the dev kit: a user signs in with Google (or email) and gets a self-custodial Privy embedded wallet on Pepe Unchained V2, with no seed phrase and no browser extension. This page covers the experience, the architecture and trust model, the SDK code, the dashboard settings it needs, the tools that automate it and the failures you may hit. The SDK's dashboard check treats every field Privy's public config returns as optional and reports `unknown` for a missing one, not a failure. It is the base for sessions and sponsorship, so read it before them.

## Prerequisites

- A Privy app with its App ID and App Secret. Create one at [dashboard.privy.io](https://dashboard.privy.io).
- The settings on [Dashboard Settings, Field by Field](../privy/dashboard-settings.md): Allowed origins with the exact port, Google enabled, embedded wallets on for Ethereum.
- `@pepu-chain/sdk`, `@privy-io/react-auth`, `@privy-io/node`. Add `@privy-io/wagmi`, `wagmi` and `@tanstack/react-query` if you use wagmi hooks.
- No bundler, no paymaster and no gas: login and wallet creation cost nothing.

## The user experience

1. The user clicks sign in and chooses Google (or email).
2. Privy handles the OAuth flow. The user lands back in your app authenticated.
3. `WalletGate` shows "Setting up your wallet..." for a moment while your server creates the embedded wallet.
4. The app renders with an address. The user never saw a seed phrase.

The wallet is an EOA. On its own it is the only address the user has. With sponsorship or Kernel sessions there is a second, smart-account address; see [The Two-Address Model](two-address-model.md).

## Architecture and trust model

```
browser                         your Next.js server                 Privy
-------                         -------------------                 -----
PepuPrivyProvider
usePrivy().login()  ───────────────────────────────────────────────► Google OAuth, user created
WalletGate / useEnsureWallet
POST /api/wallet/ensure  ─────►  createEnsureWalletRoute()
  Authorization: Bearer <token>   verifies the token (app secret)  ──► verifyAccessToken
                                  finds an existing wallet         ──► users()._get
                                  else creates one, owner = user   ──► wallets().create
   ◄──── { address, created }
refreshUser()  (client picks up the wallet)
```

What this guarantees, and what it does not:

- **The user id comes only from the verified access token.** The route never reads it from the body or query string.
- **Your server gets no signing authority.** The wallet is created with `owner: { user_id }`. Your backend can create it, and cannot sign for it. Do not add a session signer in this route. Authority is only granted later, with the user's consent, by a session grant (see [Session Keys](session-keys.md)).
- **The route is idempotent.** It looks for an existing Ethereum embedded wallet first, and re-checks after a failed create, so a double submit never makes a second wallet.
- **Custody is Privy's, not yours.** Privy runs two execution modes. `legacy-embedded-wallets-only` reassembles keys on the user's device. `user-controlled-server-wallets-only`, which Privy calls TEE execution, reassembles them inside a secure enclave that only Privy's infrastructure can invoke, gated by the user's session. Both are self-custodial by Privy's description; the live tests ran with TEE. You are trusting Privy's infrastructure either way. See [Trust and Security Model](../concepts/trust-and-security.md).

### Why the server creates the wallet

Privy's own client-side creation depends on the dashboard's "automatically create embedded wallets on login" setting. With it off, a Google login creates a user, but nothing creates the wallet, and Privy's "Creating your wallet..." screen hangs forever. This was reproduced live. Calling `useCreateWallet()` explicitly did not help, because it still runs through the same client-side machinery. The SDK avoids all of it: `createPepuPrivyConfig` sets `createOnLogin: "off"`, and `WalletGate` calls your ensure route right after login. The `createOnLogin` value you pass is largely symbolic, because Privy resolves it from the dashboard. Leave the dashboard setting on as well; having both is fine.

## Configure the dashboard

Short list, in `.env.local` and the Privy dashboard. The field-by-field table is on [Dashboard Settings](../privy/dashboard-settings.md).

| Where | Setting | Value |
|---|---|---|
| env | `NEXT_PUBLIC_PRIVY_APP_ID` | the App ID (public) |
| env | `PRIVY_APP_SECRET` | the App Secret (server only) |
| dashboard | Allowed origins | `http://localhost:3000` exactly, plus your production origin |
| dashboard | Login methods | Google, plus any method you list in `loginMethods` |
| dashboard | Embedded wallets | on for Ethereum |
| dashboard | Smart Wallets | leave off unless you use the Privy Smart Wallets transport |

## SDK code

Each snippet uses exports that exist today. Add `"use client"` in files that use the React entries.

### 1. Provider

With wagmi (what the templates use), `PepuPrivyWagmiProvider` mounts Privy, react-query and wagmi in the order Privy requires, and pins the embedded wallet as wagmi's active account:

```tsx
// app/providers.tsx
"use client";
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PepuPrivyWagmiProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{ loginMethods: ["google", "email"] }}
    >
      {children}
    </PepuPrivyWagmiProvider>
  );
}
```

Without wagmi, use `PepuPrivyProvider` from `@pepu-chain/sdk/privy/react` with the same props. When `appId` is missing it renders a notice naming the env variable instead of crashing inside Privy. Both providers build their config with `createPepuPrivyConfig`: mainnet only, `createOnLogin: "off"`, and Coinbase Wallet pinned to `eoaOnly` because Coinbase Smart Wallet does not support chain 97741.

### 2. Ensure-wallet route (server)

```ts
// app/api/wallet/ensure/route.ts
import { createEnsureWalletRoute } from "@pepu-chain/sdk/privy/server";

export const { POST } = createEnsureWalletRoute();
```

It reads `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` through the SDK's single env reader and returns `{ address, created }`. It answers with typed JSON errors: 401 for a bad token, 500 for missing config, 502 if Privy cannot be reached.

### 3. Wallet gate (browser)

```tsx
import { WalletGate, useEmbeddedWallet } from "@pepu-chain/sdk/privy/react";

function Home() {
  return (
    <WalletGate>
      <Account />
    </WalletGate>
  );
}

function Account() {
  const { address } = useEmbeddedWallet();
  return <p>{address}</p>;
}
```

`WalletGate` takes render props `loading`, `error(e, retry)` and `stalled(address, reload)` for your own markup. `useEmbeddedWallet` separates the embedded wallet from any external wallet (MetaMask, Phantom) that Privy is also tracking. Gate on the embedded wallet, never on "any connected wallet". The lower-level hook is `useEnsureWallet`, which returns `{ status, address, error, retry }` with status `idle`, `checking`, `creating`, `ready`, `stalled` or `error`.

### 4. Protect an API route

```ts
// app/api/me/route.ts
import { requireUser } from "@pepu-chain/sdk/privy/server";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return Response.json({ userId: auth.user.userId, address: auth.user.address });
}
```

And the browser side, which attaches the Privy access token for you:

```tsx
import { usePepuAuthFetch } from "@pepu-chain/sdk/privy/react";

const authFetch = usePepuAuthFetch();
const me = await authFetch("/api/me").then((r) => r.json());
```

`requireUser` never throws. It returns either `{ ok: true, user }` or a ready `Response`. Lower-level pieces are `verifyRequestUser`, `createPrivyServer`, `findEmbeddedEthereumWallet` and `readPrivyServerEnv`.

### 5. Wagmi active account

Left alone, an installed extension can silently become wagmi's active account, and balances and sends then act on the wrong wallet. `PepuPrivyWagmiProvider` mounts `useActiveWalletPin` to keep the embedded wallet active. Pass `pinEmbeddedWallet={false}` only for an app that is deliberately external-wallet-first.

## MCP tools and skills that automate it

| Need | Tool or skill |
|---|---|
| Canonical code for the provider and the route | `pepu_sdk_snippet` with `privy-provider` or `wagmi-privy`, and `ensure-wallet-route` |
| Check the env keys (presence and length, never values) | `pepu_check_env` |
| Check dashboard settings and get the requirement table | `pepu_check_privy_config` |
| Add login to an existing app | Slash command `/pepu-add-login` |
| The agent's playbook | Skill `pepu-onboarding-privy` |
| Scaffold the whole app | `pepu_scaffold_app` with template `consumer-app` |

See [MCP Tool Reference](../mcp/tools.md), [Skills Catalog](../agent-tooling/skills.md) and [Claude Code Plugin](../agent-tooling/plugin.md).

## The template that demonstrates it

`consumer-app`: sign in, see your address and PEPU balance, send a real transaction. It states plainly that gas is not sponsored. See [Consumer App](../templates/consumer-app.md).

```bash
npx create-pepu-app@latest my-app --template consumer-app
```

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Login fails, iframe blocked, OAuth init 403 | The page origin is not in Allowed origins. Next.js moved to port 3001 because 3000 was taken | Free port 3000, or add the exact new origin to Allowed origins |
| "Creating your wallet..." never ends | A custom `PrivyProvider` is in use and the dashboard creation setting is off | Use `PepuPrivyProvider`, which turns client creation off, and `WalletGate` |
| `POST /api/wallet/ensure` returns 500 | `PRIVY_APP_SECRET` is unset on the server, or the dev server was not restarted after editing `.env.local` | Set it and restart; Next.js reads `.env.local` once |
| `POST /api/wallet/ensure` returns 401 for a logged-in user | The access token does not verify: wrong secret for this app, or a stale `next dev` still holds the port | Check the secret belongs to the same app as the App ID; kill the leftover process |
| `WalletGate` shows "stalled" | The server confirmed the wallet but this session has not seen it yet | Reload. It is a client sync delay, not a lost wallet |
| Balances or sends use the wrong address | An extension became the active account | Use `PepuPrivyWagmiProvider`, or call `useActiveWalletPin()` once near the root |
| Console: "configured chains are not supported by Coinbase Smart Wallet: 97741" | The Coinbase connector is not `eoaOnly` | Use the SDK provider, which pins it |
| Console: "Unable to fetch token price" | Privy has no fiat price for PEPU | Harmless |
| A transfer is refused in Privy's modal though the wallet can afford it | Privy's pre-flight gas check is conservative at PEPU's roughly 12,500 gwei base fee | Cannot be fixed in your code; see [Troubleshooting](../troubleshooting.md) |

Testing without a faucet: login and wallet creation need no gas. An on-chain action needs a little PEPU, because there is no testnet faucet and the kit targets mainnet, where a transaction costs a fraction of a cent.

## Related

- [Dashboard Settings, Field by Field](../privy/dashboard-settings.md)
- [Privy Setup Walkthrough](privy-setup.md)
- [The Two-Address Model](two-address-model.md)
- [Session Keys](session-keys.md)
- [Sponsored Transactions](sponsored-transactions.md)
- [/privy](../sdk/privy.md), [/privy/react](../sdk/privy-react.md), [/privy/wagmi](../sdk/privy-wagmi.md), [/privy/server](../sdk/privy-server.md)
- [Recipes: Provision the Wallet and Pin the Active Account](../recipes/provision-and-pin-the-wallet.md)
