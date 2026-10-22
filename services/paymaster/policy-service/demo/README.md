# Gas-sponsorship demo: a zero-PEPU Kernel account, sponsored for real

This directory holds one script, `sponsor-with-real-privy-login.mjs`, whose
job is to answer one question as literally as possible: **can an account
holding zero PEPU submit a transaction that the paymaster actually pays
for, end to end, through a real (not stubbed) Privy login?**

> **Update.** This page records an earlier headless run. The gate it stopped
> at was fixed by enabling Smart Wallets in the Privy Dashboard, and a real
> sponsored transaction has since been proven live on PEPU mainnet from a
> browser (the `sponsored-demo` template). The bundler and policy service
> that served it are still not publicly hosted. What follows is the original
> investigation, kept for its findings.

Short answer at the time, verified live against PEPU mainnet and the real
Privy app: **everything up to and including a real Privy login works.** The
one remaining gate — proving to the policy service that the Kernel smart
account belongs to the logged-in user — could not pass because that Privy
app had its "Smart Wallets" feature turned off in the Dashboard. See "Where
this stops, and why" below.

## What runs, in what order

```
 1. services/bundler          (Alto, JSON-RPC on :4337, safe-mode:false)
 2. services/paymaster/policy-service   (HTTP on :8788)
 3. demo/sponsor-with-real-privy-login.mjs   (this script; no server, no port)
```

Start the first two exactly as their own READMEs say:

```bash
# terminal 1
cd services/bundler
npm start                 # listens on :4337 -- confirm with npm run healthcheck

# terminal 2
cd services/paymaster/policy-service
npm start                 # listens on :8788 -- confirm with curl :8788/health
```

Then run the demo from this directory (it resolves the parent package's
`node_modules`, exactly like `../integration-test.mjs` already does):

```bash
cd services/paymaster/policy-service/demo
node sponsor-with-real-privy-login.mjs
```

It needs nothing else: no browser, no `PRIVY_ACCESS_TOKEN` env var, no
funded account. It reads `CONDUIT_API_KEY` from the repo-root `.env` and
`PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PAYMASTER_CONTRACT_ADDRESS` from the
policy-service's own `.env` (same files `integration-test.mjs` already
reads) — never prints any of them.

Port 3000 (the running `templates/consumer-app` dev server) is never
touched by any of this — not read from, not written to, not used as a
`localhost` target. The `Origin: http://localhost` header this script
sends to Privy's remote API (`auth.privy.io`) is a value picked from this
app's *configured allowed-origins list*, not a request to anything running
locally; see the comment at its call site for why `http://localhost:3000`
specifically was avoided even though it's also on that list.

## EOA vs. Kernel smart account — why this demo needs a different account
type than the game template

`templates/game-app`'s session-key flow (`components/wallet-gate.tsx`,
`components/session-consent-screen.tsx`) is real and already proven on
mainnet — but the account it operates is a **plain Privy embedded EOA**.
An EOA signs and submits ordinary `eth_sendTransaction` calls; there is no
ERC-4337 `EntryPoint` in that path at all, and therefore nothing for a
paymaster to intercept. **Gas sponsorship is only possible for a
UserOperation flowing through `EntryPoint`, which requires the sender to
be a smart contract account** (one that implements `validateUserOp`) —
an EOA cannot fill that role no matter how it authenticates.

That's why this demo computes a **Kernel v3.1 smart account**
(`KERNEL_FACTORY.getAddress(...)`, same factory/validator PEPU already has
deployed: `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` /
`0x845ADb2C711129d4f3966735eD98a9F09fC4cE57`) instead of reusing the game
template's EOA path. The account is counterfactual (undeployed, zero
balance) until the moment a sponsored UserOperation actually deploys it —
which is the whole point: an account that has never held a single unit of
PEPU is the strongest possible proof that gas sponsorship, not the
account's own funds, paid for its first transaction.

The owner key controlling that Kernel account in this script is a
disposable EOA the script itself generates — used for exactly two
signatures: the Privy SIWE login message, and (had sponsorship been
approved) the final UserOperation. Nothing about the Kernel-account
construction depends on Privy at all; Privy only needs to recognize the
*owner*, and (were it enabled) the *smart account derived from that
owner*, as belonging to a real logged-in user.

## Live-verified findings (this session, against the real Privy app and PEPU mainnet)

Everything below was **observed**, not inferred from documentation:

1. **`client.apps.get(appId)`** (Privy server SDK, using this package's own
   `PRIVY_APP_ID`/`PRIVY_APP_SECRET`) returned:
   - `smart_wallet_config: { "enabled": false }`
   - `guest_auth: false`, `email_auth: true`, `wallet_auth: true`
   - `allowed_domains: ["http://localhost", "http://localhost:3000"]`
2. **`client.apps.getTestCredentials(appId)`** returned no test accounts —
   this app has none configured, so Privy's canned-OTP testing shortcut
   isn't available here (not a code problem, just an unconfigured
   Dashboard feature, same category as finding 1).
3. **`client.users().create({ wallets: [{ chain_type: 'ethereum',
   create_smart_wallet: true }] })`** — the only SDK-level way to attach a
   `type: "smart_wallet"` linked account to a user — failed live with
   `400 {"error":"App does not have smart wallets enabled"}`. This is the
   direct, load-bearing consequence of finding 1: **no user of this Privy
   app can have a `smart_wallet` linked account right now, for any
   address, by any method** — there is no per-call override, and the
   `LinkedAccountInput` union type the SDK exposes for manually linking
   accounts has no `smart_wallet` variant at all (confirmed by reading
   `node_modules/@privy-io/node/resources/users/users.d.ts` directly).
4. **A real SIWE login against this exact app succeeded live** —
   `POST https://auth.privy.io/api/v1/siwe/init` then
   `.../siwe/authenticate`, using a disposable local key this script
   generated and controls, with `Origin: http://localhost` (from finding 1's
   `allowed_domains`). This created a brand-new real Privy user and
   returned a real access token, independently re-verified in this same
   run via `privy.utils().auth().verifyAccessToken()` — the exact check
   `policy-service/src/privyAuth.ts` performs. **This is not a stub**: it
   is the same REST contract `@privy-io/react-auth` itself uses (confirmed
   by reading that package's actual compiled dependency,
   `@privy-io/js-sdk-core`, and its route table, `@privy-io/routes`) —
   see the script's own header comment for the exact source lines this was
   read from.
5. **`POST /sponsor` with that real token got past the token-verification
   gate** (no longer `invalid_or_expired_token` — the failure every prior
   run without a real token got) **and reached the very next gate**:

   ```json
   {
     "status": "denied",
     "reason": "sender_not_owned_by_token_user",
     "message": "userOp.sender is not a smart wallet owned by the authenticated Privy user."
   }
   ```

   This is `policy-service/src/privyAuth.ts`'s `verifySenderOwnership`
   calling Privy's `getBySmartWalletAddress(sender)` and correctly getting
   "not found" — because, per findings 1-3, **no address can ever be
   registered as this user's smart wallet today**, regardless of which
   Kernel account this script computes or how the user logs in. This is
   the actual, precise, currently-live stopping point for this whole demo.

## Where this stops, and why

Everything below `POST /sponsor` never runs, because there is no
`paymasterData` to attach without an `approved` response — sending an
unsponsored UserOperation from a zero-balance sender would just fail
`AA21 didn't pay prefund` (already independently confirmed in
`../integration-test.mjs`'s header comment and this session's own re-run
of it), proving nothing about sponsorship either way.

**This is not a code bug in this repository.** `verifySenderOwnership`
existing and fail-closing exactly like this is the correct behavior — it's
the check that stops a stolen-but-valid token from sponsoring gas toward
an attacker-chosen address (see `services/paymaster/README.md`, "Threat
model", "Stolen Privy tokens"). Per the task this script was built for
("never bypass, stub, or disable the token check — a demo that fakes it
proves nothing"), this script does not weaken, route around, or fake that
check, and this README does not recommend touching `privyAuth.ts` or
`policy.ts` to work around it.

**What would actually unblock this**, in order of how directly it matches
what this policy service's code already expects:

1. **Enable "Smart Wallets" in this Privy app's Dashboard**, configured
   for PEPU (chain `97741`) with provider `kernel`. This is a Dashboard
   setting, not an API call — there is no SDK method to flip it (confirmed
   by reading the full `Apps` resource surface: `get`, `getGasSpend`,
   `getTestCredentials` — no `update`/`patch`). Only whoever owns this
   Privy Dashboard can make this change, which is exactly why this session
   stopped here to report it rather than guessing at a workaround.
   Whether Privy's own Kernel provider would compute the *same* address
   this script's factory call computes (so a deployment this stack builds
   would actually match what Privy thinks the user's smart wallet is) is
   an open question this session could not test without that toggle being
   on — flag this as the first thing to check once it is.
2. Failing that, a **product decision** (not a code fix this task's rules
   allow making unilaterally) about what "the policy service can prove
   this user owns this sender" should mean for an app that derives its own
   Kernel accounts instead of using Privy's Smart Wallets product — e.g.
   some other server-side attestation this app's own backend controls.
   That's a real security-model change and deliberately left to whoever
   owns that decision, not decided here.

## Re-running this yourself

```bash
cd services/bundler && npm start                       # terminal 1
cd services/paymaster/policy-service && npm start       # terminal 2
cd services/paymaster/policy-service/demo
node sponsor-with-real-privy-login.mjs                  # terminal 3
```

Each run creates one throwaway Privy user (via a fresh disposable SIWE
key) and deletes it again at the end (`privy.users().delete`) — safe to
run repeatedly. Nothing it does is destructive: no on-chain call is ever
made (sponsorship is denied before `eth_sendUserOperation` is reached),
and the only Privy-side state it touches is that one throwaway user.
