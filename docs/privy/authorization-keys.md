# Authorization Keys and Key Quorums

The authorization key is the credential your server uses to ask Privy to sign for a user's wallet under a session grant. This page covers what it authorizes, how to generate it without printing the private half, how to register it, where it is read and how to rotate it. It applies to Privy session signers only; Kernel sessions use no authorization key.

## Prerequisites

- Pillar 1 working. See [Social Login and Embedded Wallets](../onboarding/privy-embedded-wallets.md).
- Access to the Privy dashboard for the app.

## What it authorizes

Privy requires that a signing request for a delegated wallet be authorized by the key quorum the user granted as a signer. Your server signs each `eth_signTransaction` request with the private half (`PRIVY_AUTHORIZATION_KEY`); Privy checks it, then evaluates the policy attached to the grant. So the key is a production signing credential: anyone holding it can request transactions for any wallet that granted a signer to its quorum, bounded only by the attached policy (one contract, listed functions, zero value, expiry). Gas is not bounded. It is a server secret: never `NEXT_PUBLIC_`, never committed, never logged.

## Generate

Three ways, all producing a P-256 pair in Privy's format (base64 SPKI public, base64 PKCS8 private, no PEM headers):

| Way | How |
|---|---|
| Template script | `npm run generate-authorization-key` in `game-app` |
| SDK | `generatePrivyAuthorizationKey()` from `@pepu-chain/sdk/doctor`. Returns `{ publicKey, privateKey }`; it writes and logs nothing |
| MCP | `pepu_generate_authorization_key` with an absolute `.env.local` path and `confirm_write: true`. It writes the private half to the env file and returns only the public key and a fingerprint; it refuses to replace an existing key unless `overwrite: true` |

```ts
import { generatePrivyAuthorizationKey } from "@pepu-chain/sdk/doctor";
const { publicKey, privateKey } = await generatePrivyAuthorizationKey();
// Show publicKey. Write privateKey straight to .env.local. Never print it.
```

## Register the public key and create the quorum

Menu labels may drift.

1. Privy dashboard, Controls (Wallet infrastructure), Authorization keys, **New key**. Paste the public key.
2. Create a **key quorum** containing that key.
3. Copy the key quorum id into `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`. It is an identifier, not a secret: Privy's own client-side `addSigners` examples pass it from browser code.

## Env vars and where they are read

| Variable | Scope | Read by |
|---|---|---|
| `PRIVY_AUTHORIZATION_KEY` | Server, secret | `privySessionSigner` and `createSessionActionRoute` (`/session/server`), through `privyEnvVar`. Never given to the Privy client; Privy takes it per request |
| `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID` (alias `PRIVY_KEY_QUORUM_ID`) | Public | `createSessionRoutes` (grant returns it as `signerId`) |

The SDK's server entries refuse to load in a browser bundle. Check presence with `pepu_check_env` or `npm run doctor`; both report presence and length only.

## Rotation and revocation

- Rotate if the private key leaks: generate a new pair, register it, create a new quorum, update both env vars, redeploy. Sessions granted under the old quorum stop working, so users must grant again.
- To end one user's session, the browser calls `removeSigners` (`useSessionRevoke`). After it resolves your backend can no longer sign for that wallet.
- Delete a retired key and its quorum in the dashboard.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| 401 "No valid authorization keys or user signing keys available" (`PRIVY_KEY_QUORUM_MISMATCH`) | The private key is not the half of a key in the quorum named by `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`, or the user granted a different quorum | Realign the pair; grant again |
| `CONFIG_MISSING_ENV` naming `PRIVY_AUTHORIZATION_KEY` | Unset on the server, or the dev server was not restarted | Set it and restart |
| Grant works but signing is denied | The policy rejected the call, or it expired | See [Session Keys](../onboarding/session-keys.md) |

## Related

- [Dashboard Settings, Field by Field](dashboard-settings.md)
- [Session Keys](../onboarding/session-keys.md)
- [Trust and Security Model](../concepts/trust-and-security.md)
- [/doctor](../sdk/doctor.md)
