---
description: Add sponsored (gasless) transactions to the current PEPU app with the SDK's useSponsoredSend or sendSponsored, after live-checking that a bundler and paymaster are available.
argument-hint: "[transport: privy-smart-wallets or direct]"
allowed-tools: Bash(pnpm:*), Bash(npm:*), Read, Write, Edit, Glob, Grep, mcp__plugin_pepu-devkit_pepu__pepu_sponsorship_status, mcp__plugin_pepu-devkit_pepu__pepu_bundler_health, mcp__plugin_pepu-devkit_pepu__pepu_paymaster_health, mcp__plugin_pepu-devkit_pepu__pepu_sdk_snippet, mcp__plugin_pepu-devkit_pepu__pepu_check_env, mcp__plugin_pepu-devkit_pepu__pepu_check_privy_config
---

Add sponsored transactions to this app. Transport: $ARGUMENTS

Follow the `pepu-sponsored-transactions` skill. Login and the embedded wallet must already work (`/pepu-add-login`).

1. Call `pepu_sponsorship_status` first and report the answer exactly. The hosted bundler (bundler.pepeunchained.com) is the default; the paymaster URL needs the project's token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`). If no paymaster URL is configured, say so, set up the code anyway, and leave `PEPU_PAYMASTER_URL` as a clearly marked placeholder for the user (a project must be claimed and funded first). Then also call `pepu_bundler_health` and `pepu_paymaster_health`.
2. Choose the transport: `privy-smart-wallets` (URLs live in the Privy dashboard, Smart wallets, chain 97741, provider Kernel) or `direct` (env URLs, `useDirectSponsoredSend` from `@pepu-chain/sdk/aa/react-direct`, needs `@zerodev/*`). Prefer `privy-smart-wallets` for browser code because a paymaster URL embeds a credential.
3. Apply `pepu_sdk_snippet` tasks `sponsored-send` (component with `useSponsoredSend`, `usePepuSponsorship`, `usePepuSmartAccount`) and, for server code, `sponsored-send-server` (`toPepuKernelAccount`, `createPepuSponsoredClient`, `sendSponsored`). For the Privy transport also add `SmartWalletsProvider` through `composeProviders`. No hand-written bundler or paymaster calls.
4. Show the smart account address (not the owner address) and the explorer link from the result; only say a send was sponsored when `result.paymaster` is set.
5. Run `pepu_check_env` and `pepu_check_privy_config` with `pillars: ["sponsor"]`, then `typecheck` and `build`.
