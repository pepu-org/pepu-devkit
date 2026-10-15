---
description: Check a PEPU project's readiness - env keys, Privy dashboard settings, RPC and sponsorship - and fix what can be fixed. Reports key names and status only, never secret values.
argument-hint: "[template name, optional]"
allowed-tools: Bash(npm run doctor:*), Bash(pnpm doctor:*), Bash(pnpm run doctor:*), Read, Edit, mcp__plugin_pepu-devkit_pepu__pepu_check_env, mcp__plugin_pepu-devkit_pepu__pepu_check_privy_config, mcp__plugin_pepu-devkit_pepu__pepu_sponsorship_status, mcp__plugin_pepu-devkit_pepu__pepu_health_check, mcp__plugin_pepu-devkit_pepu__pepu_explain_error, mcp__plugin_pepu-devkit_pepu__pepu_known_gotchas
---

Run a readiness check on the PEPU project in the current directory. Template (optional): $ARGUMENTS

1. Work out the template: the argument, else the `name` in `package.json` or the project's `AGENTS.md`. Never read `.env*` values yourself; the tools report key names, presence and length only.
2. Call `pepu_check_env` with `projectDir` (the absolute current directory) and `template`. If the project defines `npm run doctor`, run it too; it uses the SDK's `checkPepuEnv` and prints no values.
3. Read `NEXT_PUBLIC_PRIVY_APP_ID` via the check result (it is public; if you need its value ask the user to paste it). Call `pepu_check_privy_config` with the app id, the dev origin including the port, and the template's pillars.
4. If the template has the sponsorship pillar, call `pepu_sponsorship_status` and report whether sponsorship is available and the `fixes`.
5. Call `pepu_health_check` for RPC and pepuscan reachability.
6. For any failure call `pepu_explain_error` with the exact text.
7. Summarise as a short table: check, status, fix. Apply the fixes you can (for example a missing `.env.local` key placeholder, a wrong port) and list precisely what only the user can do (paste the App Secret, add the allowed origin, register the authorization key).

Never print a secret, a paymaster URL or an authorization key. Skills for each fix: `pepu-onboarding-privy`, `pepu-session-keys`, `pepu-sponsored-transactions`, `pepu-debug-transaction`.
