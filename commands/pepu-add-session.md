---
description: Add popup-free Privy session keys to the current PEPU app (scoped policy, grant, act and revoke routes, consent UI). The user pays gas; scope is enforced off-chain by Privy.
argument-hint: "<contract address> <function signatures, e.g. tap()>"
allowed-tools: Bash(pnpm:*), Bash(npm:*), Read, Write, Edit, Glob, Grep, mcp__plugin_pepu-devkit_pepu__pepu_session_policy, mcp__plugin_pepu-devkit_pepu__pepu_generate_authorization_key, mcp__plugin_pepu-devkit_pepu__pepu_sdk_snippet, mcp__plugin_pepu-devkit_pepu__pepu_check_env, mcp__plugin_pepu-devkit_pepu__pepu_check_privy_config
---

Add Privy session keys to this app. Contract and functions: $ARGUMENTS

Follow the `pepu-session-keys` skill. Login and the embedded wallet must already work (`/pepu-add-login`).

1. Call `pepu_session_policy` with `mode: "privy"`, the contract, the functions and a short duration to get the consent summary and a snippet. Keep the functions nonpayable: the policy requires zero value.
2. Call `pepu_generate_authorization_key` with the absolute path of `.env.local` and `confirm_write: true`. It writes the private half and returns only the public key. Ask the user to register that public key in the Privy dashboard (Controls, Authorization keys, New key, create a key quorum) and paste the key quorum id; write it to `NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID`.
3. Apply `pepu_sdk_snippet` tasks `session-routes`, `session-action-route` and `grant-session`: `createSessionRoutes` (grant, status, revoke), `createSessionActionRoute` (the action), and a client panel with `useSessionGrant`, `useSessionStatus`, `useSessionAct`, `useSessionRevoke`. Do not hand-write policies, nonce handling or broadcast code.
4. The consent screen must show the contract, function signatures, zero value, expiry, `SESSION_TRUST_NOTICE["privy-offchain"]`, that the user's wallet pays gas, and a revoke button. Never call it free or gasless.
5. Run `pepu_check_env` and `pepu_check_privy_config` with `pillars: ["session"]`, then `typecheck` and `build`.
