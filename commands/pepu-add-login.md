---
description: Add Google login and a Privy embedded wallet to the current Next.js app using the PEPU SDK (provider, wallet gate, ensure-wallet route).
argument-hint: "[login methods, default google and email]"
allowed-tools: Bash(pnpm:*), Bash(npm:*), Read, Write, Edit, Glob, Grep, mcp__plugin_pepu-devkit_pepu__pepu_sdk_snippet, mcp__plugin_pepu-devkit_pepu__pepu_sdk_exports, mcp__plugin_pepu-devkit_pepu__pepu_check_env, mcp__plugin_pepu-devkit_pepu__pepu_check_privy_config
---

Add Google login and an embedded wallet to this app. Login methods: $ARGUMENTS

Follow the `pepu-onboarding-privy` skill exactly.

1. Install `@pepu-chain/sdk`, `@privy-io/react-auth`, `@privy-io/node` (plus `@privy-io/wagmi`, `wagmi`, `@tanstack/react-query` if the app uses wagmi hooks).
2. Call `pepu_sdk_snippet` with `privy-provider` (or `wagmi-privy`) and `ensure-wallet-route`, and apply them: `PepuPrivyProvider` or `PepuPrivyWagmiProvider` with `WalletGate` in `app/providers.tsx`, and `createEnsureWalletRoute()` in `app/api/wallet/ensure/route.ts`. Do not write a `PrivyProvider` config or wallet-creation code by hand.
3. Add `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` placeholders to `.env.local` and `.env.example`. Ask the user for the real values; never echo the secret.
4. Run `pepu_check_env`, then `pepu_check_privy_config` with the dev origin including the port, and tell the user exactly which dashboard rows to fix (Allowed origins with the port, Google enabled, embedded wallets on).
5. Run `typecheck` and `build`.
