# Releasing

How maintainers publish `@pepu-chain/sdk`, `@pepu-chain/mcp`, `create-pepu-app` and the `pepu-devkit` Claude Code plugin. Run each step by hand, in order, and confirm the check before moving on.

> Status: `@pepu-chain/sdk` and `@pepu-chain/mcp` are published (0.2.x). `create-pepu-app` 0.1.0 is waiting on npm's staged-release approval. For anything not yet live, install from the repository (build it, or use the tarballs `node scripts/check-pack.mjs` produces) or from a local registry.

## Publish order

Always in this order. Each step depends on the one before it being resolvable from its registry.

1. `@pepu-chain/sdk` (npm). Everything else depends on it.
2. `@pepu-chain/mcp` (npm, then the MCP Registry entry). It depends on the published SDK.
3. `create-pepu-app` (npm). Its default `--sdk npm` needs the SDK on the registry.
4. The `pepu-devkit` plugin (the GitHub repository and marketplace entry). It launches `npx -y @pepu-chain/mcp`, so the MCP package must already be live.

## Release from a fresh repository

The public release comes from a **fresh, single-commit repository**, not from this working history. Create it from a clean export of the tracked tree after the PII and secrets sweep below passes, with only the organization identity as author and committer. Never push this working history.

## One-time setup

- A GitHub organization owning the repository (`pepu-org/pepu-devkit`) and an npm organization owning the `@pepu-chain` scope. `create-pepu-app` is unscoped.
- A maintainer account with publish rights on all three packages (`npm login`, then `npm whoami`).
- For CI publishing, an npm automation or granular token stored as the `NPM_TOKEN` repository secret. Scope it to the PEPU organization account, never a personal token.

## Every release

1. Bump the version of each package that changed (`npm version patch --no-git-tag-version` inside `packages/<name>`) and commit it.
2. Install, build and test from the repo root. Build order matters because `create-pepu-app` vendors the built SDK:

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @pepu-chain/sdk build
   pnpm --filter @pepu-chain/mcp build
   pnpm --filter create-pepu-app build
   pnpm -r typecheck
   pnpm -r --workspace-concurrency=1 test
   (cd services/paymaster/policy-service && npm ci && npm test)   # runs serially (vitest.config.ts)
   node templates/scripts/check-design.mjs
   node templates/scripts/check-agent-kit.mjs
   node scripts/check-plugin.mjs
   node scripts/check-versions.mjs
   node scripts/check-path-length.mjs
   node scripts/sync-skill-shared.mjs --check
   node scripts/gen-docs.mjs --check
   node scripts/check-docs-parity.mjs
   node scripts/check-links.mjs
   pnpm --filter @pepu-chain/sdk live-check   # read-only: every registry address still has code
   ```

   If `gen-docs.mjs --check` reports a stale file, run `node scripts/gen-docs.mjs`, then `pnpm --filter @pepu-chain/mcp snapshots`, and commit the result.

3. `LICENSE` is copied into each package by its `prepack` script (it runs on `pnpm pack` and `pnpm publish`; the copies are gitignored, never commit them). Nothing to do by hand.

4. Run the pack check. It runs `pnpm pack` for all three packages, asserts each tarball has `LICENSE`, `README.md` and a `package.json` with no `workspace:` range, installs them into an empty temp directory outside the repo in publish order (SDK, then MCP with the SDK tarball, then the CLI), starts the installed MCP server and lists its tools, and runs `create-pepu-app --list --json`. Also run the scaffold check, which scaffolds all six templates outside the workspace and runs `npm install`, `npm run build` and `npm run typecheck` in each (slow: several minutes):

   ```bash
   node scripts/check-pack.mjs
   node scripts/check-scaffolds.mjs
   ```

   Then audit each tarball with `pnpm pack --dry-run` (run it inside `packages/<name>`; `npm pack --dry-run` lists the same files). Expect only `LICENSE`, `README.md`, `package.json` and the declared `files` (`dist` for sdk and mcp; `dist`, `templates`, `vendor` for create-pepu-app). No `.env`, `.next`, `node_modules` or `tsbuildinfo`. Then run the PII and secrets sweep below over the **tarball contents** too: pipe the dry-run file list and grep the unpacked files (`npm pack`, then `tar -xzf` into a scratch directory) for `ngrok`, machine paths, personal names and secrets. A hit in `dist` or `vendor` counts exactly like a hit in the source tree.
5. Publish in the order above (SDK, then MCP, then CLI; the plugin comes last, in step 8) with **`pnpm publish`, never `npm publish`**. `@pepu-chain/mcp` depends on `@pepu-chain/sdk` as `workspace:*`, and only pnpm rewrites that to the real version range in the published `package.json`. `npm publish` would ship `workspace:*` verbatim and the package could not be installed.

   ```bash
   pnpm --filter @pepu-chain/sdk publish --access public --no-git-checks
   pnpm --filter @pepu-chain/mcp publish --access public --no-git-checks
   pnpm --filter create-pepu-app publish --access public --no-git-checks
   ```

   `.github/workflows/publish.yml` does the same from the Actions tab (manual trigger with a typed confirmation), after running the pack check. `create-pepu-app` has the SDK only as a devDependency (its tarball vendors a copy of the SDK, whose manifest carries no `workspace:` range), so it needs no rewrite.

   The CLI default `--sdk npm` is already flipped (see [Flip the CLI default](#flip-the-cli-default-to---sdk-npm)); publish the SDK first so the default resolves from the registry.
6. Smoke test from a directory outside the repo: `npx create-pepu-app@latest my-app --template consumer-app --yes`, then `npm install` and `npm run dev`. Also run `npx -y @pepu-chain/mcp`.
7. If the MCP version changed, update `packages/mcp/server.json` to match and re-run `mcp-publisher publish` to refresh the MCP Registry entry (the `io.github.pepu-org/*` namespace needs GitHub organization-owner auth).

8. Validate and publish the plugin. From the repo root, run `claude plugin validate ./` with and without `--strict`; both must pass (warnings under `--strict` are release blockers). Then tag the repository and publish the marketplace entry in `.claude-plugin/marketplace.json`. Keep `.claude-plugin/plugin.json` and `marketplace.json` versions equal (`node scripts/check-versions.mjs`).
9. Confirm the hosted-URL state before announcing (next section).

## Hosted endpoints: the swap point

The hosted bundler and paymaster URLs live in exactly one place: `PEPU_HOSTED` in `packages/sdk/src/endpoints.ts`. They are live: `bundlerUrl` is `https://bundler.pepeunchained.com` and `paymasterBaseUrl` is `https://paymaster.pepeunchained.com` (the service base; the ERC-7677 URL always embeds a token, so `paymasterUrl` stays `null`). To change them:

1. Set `bundlerUrl` and `paymasterBaseUrl` in `PEPU_HOSTED` (https URLs, no embedded secrets).
2. Rebuild the SDK, then run `node scripts/gen-docs.mjs`. It regenerates `docs/reference/endpoints.md` and `docs/llms.txt` and `docs/llms-full.txt`.
3. Run `pnpm --filter @pepu-chain/mcp snapshots` so the bundled docs match, then `node scripts/gen-docs.mjs --check` and `node scripts/check-docs-parity.mjs`.
4. Review the prose pages that quote the URLs (`docs/get-started/network-reference.md`, `docs/onboarding/sponsored-transactions.md`, `docs/infra/overview.md`) and update them by hand. Release the SDK and MCP together. Keep the labels honest: the v2 paymaster is a canary (internally reviewed 3 times, external audit pending, funded in small tranches); the combination flow is proven live in a browser on mainnet (2026-10-14) against the hosted bundler and v2 paymaster.

## Flip the CLI default to --sdk npm

**Done:** the CLI now defaults to `--sdk npm` and falls back to the bundled vendor copy (with a warning and `fellBackToVendor: true`) while `@pepu-chain/sdk` is not on the registry. The steps below are kept as the record. Originally: the CLI defaulted to `--sdk vendor` only until the SDK was on npm. Right after the SDK is published, and before publishing `create-pepu-app`:

1. In `packages/create-pepu-app/src/cli-args.ts`, change the default `sdk` mode from `vendor` to `npm`.
2. Update the flag table in `packages/create-pepu-app/README.md` and `docs/cli/create-pepu-app.md` (default column, the vendored-versus-npm section), then run `node scripts/gen-docs.mjs` and `pnpm --filter @pepu-chain/mcp snapshots`.
3. Run `pnpm --filter create-pepu-app test` and a scaffold smoke test with `--sdk npm` outside the repo.
4. Keep `--sdk vendor` available as an opt-in for offline use, and keep the registry-fallback behaviour.

## Scaffolded SDK dependency

Templates declare `"@pepu-chain/sdk": "workspace:*"`. `create-pepu-app` rewrites it at scaffold time (see `packages/create-pepu-app/src/scaffold.ts`, `rewritePackageJson`). Today it rewrites to a vendored copy (`file:./vendor/pepu-sdk`). Once `@pepu-chain/sdk` is on npm, change the rewrite to the published version range (for example `^0.1.0`), stop vendoring, and drop the vendoring step from `scripts/sync-assets.mjs`.

## Pre-release PII and secrets checklist

Search the full tracked tree (`git ls-files`) case-insensitively before every release. Any hit is a release blocker unless it is a documented public identity.

- Personal names, handles, personal email addresses and the name of any consulting firm.
- Machine paths: `C:\Users`, `/mnt/c`, `/home/<user>`, scratchpad directories.
- Tunnel hostnames (`ngrok`, `trycloudflare`, `localhost.run`) presented as endpoints.
- Real `did:privy:` identifiers (only the placeholder `did:privy:...` is allowed), `privy_app_secret_`, `npm_` tokens, and private keys (`0x` plus 64 hex characters that are not known public hashes or storage slots).
- Tracked `.env`, `.env.local` or key files. Only `.env.example` files may be tracked.
- Package metadata (`author`, `repository`, `bugs`, `homepage`), `.claude-plugin/*` and `LICENSE` show organization identity only.
- Git author and committer identity is the organization identity.
