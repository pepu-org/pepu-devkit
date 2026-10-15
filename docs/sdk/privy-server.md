# /privy/server

`@pepu-chain/sdk/privy/server` is the server half of Google to wallet: the Privy server client, access-token verification, the authenticated-route helper and the ensure-wallet route factory. It is **server-only** and refuses to load in a browser bundle.

> Status: proven on mainnet, ported from the `consumer-app` template.

## Import, peers and boundary

| Item | Value |
|---|---|
| Import | `@pepu-chain/sdk/privy/server` |
| Server or client | Server only. It calls `assertServerOnly()` at import and throws `CONFIG_SERVER_ONLY` when `window` exists |
| Peer dependencies | `@privy-io/node` `^0.34.0` |
| Secrets read | `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID` (the canonical names in `PRIVY_ENV`), optionally `PRIVY_AUTHORIZATION_KEY` and `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` for sessions |
| Pillar | Google to wallet |

## Exports

| Export | Signature | What it abstracts |
|---|---|---|
| `privyEnvVar` | `(name: "appId" \| "appSecret" \| "authorizationKey" \| "keyQuorumId") => string \| undefined` | The single reader of the Privy variables and their aliases, trimmed |
| `readPrivyServerEnv` | `(o?) => PrivyServerEnv` | Reads the variables, explicit options winning. Throws one `CONFIG_MISSING_ENV` listing every missing variable by name only |
| `createPrivyServer` | `(o?) => PrivyClient` | A cached `@privy-io/node` client per credential set. The authorization key is not given to the client; Privy takes it per request |
| `verifyRequestUser` | `(request: Request, o?: { privy? }) => Promise<{ userId: string; claims: unknown }>` | Verifies the `Authorization: Bearer` token. Throws `AUTH_INVALID_TOKEN` (HTTP 401) when missing or invalid; Privy's reason is in `details.reason` with the token redacted |
| `requireUser` | `(request, o?) => Promise<{ ok: true; user: PepuUser } \| { ok: false; response: Response }>` | Route-handler helper. Never throws: failure is a ready JSON `Response` (401 bad token, 500 missing config, 502 Privy unreachable). `PepuUser` is `{ userId, address: Address \| null, privyUser }` |
| `findEmbeddedEthereumWallet` | `(user: PrivyUser) => LinkedWallet \| null` | The user's Ethereum embedded wallet, delegated or not |
| `findDelegatedEthereumWallet` | `(user: PrivyUser) => LinkedWallet \| null` | The wallet that has a session signer attached |
| `createEnsureWalletRoute` | `(o?: { privy?; onCreated? }) => { POST(request: Request): Promise<Response> }` | Creates the signed-in user's embedded wallet server-side if they have none. Idempotent, user id only from the verified token, wallet owned by the user |
| Types | `PrivyUser`, `PepuUser`, `PrivyServerEnv`, `LinkedWallet` | |

### Custody

`createEnsureWalletRoute` creates the wallet with `owner: { user_id }`. Your backend holds no signing authority over it. Do not add a session signer in this route: grants are explicit and scoped, see [/session](session.md).

## Errors

| Code | When |
|---|---|
| `CONFIG_SERVER_ONLY` | The entry was imported in a browser bundle |
| `CONFIG_MISSING_ENV` | `PRIVY_APP_SECRET` or the app id is unset (names only in the message) |
| `AUTH_INVALID_TOKEN` | Missing header or a token that does not verify. A mismatched `PRIVY_APP_SECRET` looks identical to an expired session, so check it first |
| `WALLET_NOT_PROVISIONED` | The wallet could not be read or created |
| `UNKNOWN` | Privy could not be reached |

## Example

```ts
// Pillar 1, server: provision the embedded wallet and authenticate requests.
// SERVER ONLY (reads PRIVY_APP_SECRET). See docs/sdk/privy-server.md
import { createEnsureWalletRoute, requireUser } from "@pepu-chain/sdk/privy/server";

// app/api/wallet/ensure/route.ts
export const { POST } = createEnsureWalletRoute();

// Any other authenticated route handler. The user id comes only from the
// verified Privy access token, never from the request body.
export async function whoAmI(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response; // ready-made JSON error with the right status
  return Response.json({ userId: auth.user.userId, address: auth.user.address });
}
```

Source: `docs/snippets/ensure-wallet-route.ts`, type-checked against the SDK.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `CONFIG_SERVER_ONLY` at build or load | A client component imports this entry | Move the import to a route handler, server action or script |
| 401 on a valid-looking session | Wrong `PRIVY_APP_SECRET` for the app id | Use the secret from the same Privy app |
| Two wallets for one user | A hand-rolled route without the re-check | Use `createEnsureWalletRoute`, which re-checks after a failed create |

## Related

- [/privy/react](privy-react.md), [/session](session.md)
- [Privy Env Vars and Verification](../privy/env-and-checks.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
