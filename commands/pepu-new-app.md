---
description: Scaffold a new PEPU app with create-pepu-app, choosing the template by what the app needs (Google login, session keys, sponsored transactions, or the sponsored session).
argument-hint: "[app name or idea]"
allowed-tools: Bash(npx create-pepu-app:*), Bash(pnpm:*), Bash(npm:*), Read, Write, Edit, mcp__plugin_pepu-devkit_pepu__pepu_list_templates, mcp__plugin_pepu-devkit_pepu__pepu_scaffold_app, mcp__plugin_pepu-devkit_pepu__pepu_check_env, mcp__plugin_pepu-devkit_pepu__pepu_check_privy_config, mcp__plugin_pepu-devkit_pepu__pepu_sponsorship_status
---

Create a new Pepe Unchained app for: $ARGUMENTS

Follow the `pepu-build-dapp` skill. Do the work yourself; ask the user only for things only they have (the Privy App ID and App Secret, registering a public key in the Privy dashboard, bundler and paymaster URLs).

1. Call `pepu_list_templates`. Choose the template by pillar and say why in one line: `consumer-app` (Google login and wallet), `game-app` (Privy session keys), `sponsored-demo` (gasless sends), `sponsored-session-app` (Google login, one signature, no popups, no user gas), `token-gated-app`, `nft-mint`. Default to `consumer-app` when unsure.
2. Pick an absolute directory that does not exist yet (the working directory plus a slug of the app name). Call `pepu_scaffold_app` with the template and that directory. If the tool is unavailable, run `npx create-pepu-app@latest <name> --template <template> --yes --no-install --no-git --json` and read the JSON.
3. Install dependencies with the package manager the result names.
4. Call `pepu_check_env` with `projectDir` and `template`. Write what you can into `.env.local` without echoing secrets and ask the user for the rest.
5. Call `pepu_check_privy_config` with the app id and the dev origin including the port (`http://localhost:3000`). Tell the user exactly which dashboard rows to fix.
6. For a sponsorship template call `pepu_sponsorship_status` and report its answer honestly (the hosted bundler is the default; the paymaster URL needs the project's token).
7. Run `typecheck` and `build`, and finish with the three commands the user needs to run the app.

Use `@pepu-chain/sdk` functions for any change you make; never hand-roll chain config, Privy plumbing, sessions or sponsorship (see the `pepu-sdk` skill).
