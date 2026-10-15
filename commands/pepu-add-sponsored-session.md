---
description: Add the full combination to the current PEPU app - Google login, one owner signature for an on-chain Kernel session, then actions with no popup and no user gas - using createSponsoredSessionRoutes and useSponsoredSession.
argument-hint: "<contract address> <function signatures, e.g. tap()>"
allowed-tools: Bash(pnpm:*), Bash(npm:*), Read, Write, Edit, Glob, Grep, mcp__plugin_pepu-devkit_pepu__pepu_sponsorship_status, mcp__plugin_pepu-devkit_pepu__pepu_session_policy, mcp__plugin_pepu-devkit_pepu__pepu_sdk_snippet, mcp__plugin_pepu-devkit_pepu__pepu_check_env, mcp__plugin_pepu-devkit_pepu__pepu_check_privy_config
---

Add the sponsored session to this app. Contract and functions: $ARGUMENTS

Follow the `pepu-sponsored-session` skill. For a new project prefer scaffolding: `/pepu-new-app` with the `sponsored-session-app` template.

1. Call `pepu_sponsorship_status` and report the answer. This flow needs a bundler (default `https://bundler.pepeunchained.com`) and a paymaster URL with the project's server key (`PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<server key>`, server only, secret). Say the combination is proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster.
2. Login and wallet: apply `/pepu-add-login` first if missing.
3. Call `pepu_session_policy` with `mode: "kernel"`, the contract, the functions and a duration, for the consent summary. Put the scope in one shared file used by server and browser.
4. Apply `pepu_sdk_snippet` tasks `sponsored-session` and `sponsored-session-client`: `createSponsoredSessionRoutes` with the five route files (prepare, activate, status, act, revoke) and a component with `useSponsoredSession`. Do not hand-write session-key, permission or UserOperation code.
5. The default `createMemoryStore()` is dev only: tell the user a production deployment needs a persistent `SessionStore` with the session private key encrypted at rest. Say that revoke is server-side and the on-chain permission lapses at expiry.
6. The consent screen shows the scope, the expiry and `SESSION_TRUST_NOTICE["kernel-onchain"]`. Size any spend cap above the reservation (about 20.5 PEPU first operation, 6.9 later).
7. Run `pepu_check_env` (template `sponsored-session-app`) and `pepu_check_privy_config`, then `typecheck` and `build`.
