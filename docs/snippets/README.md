# Docs Snippets

Canonical, type-checked TypeScript samples for the SDK docs. The recipes and SDK pages embed these files verbatim, so a sample never drifts from code that compiles.

Check them against the built workspace SDK:

```sh
pnpm install
pnpm --filter @pepu-chain/sdk build
pnpm --filter @pepu-chain/sdk exec tsc -p ../../docs/snippets
```

With a global TypeScript, `npx -p typescript tsc -p docs/snippets` from the repository root does the same. `tsconfig.json` maps `@pepu-chain/sdk` and its subpaths to the built declarations in `packages/sdk/dist`, and resolves `viem`, `wagmi`, `react` and `@privy-io/react-auth` from the SDK's own dependencies.

Rules: use real SDK exports only, no secrets, no tunnel URLs, and read `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` from the environment (the bundler defaults to the hosted one; the paymaster URL needs a project token), and never paste a real token.
