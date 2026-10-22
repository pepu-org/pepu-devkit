# create-pepu-app

Scaffolds a PEPU developer kit starter template into a new directory —
pick from six, each a runnable Next.js + Privy app for a different
common pattern.

## Templates

| Name | What it is |
| --- | --- |
| `consumer-app` (default) | Email, Google or wallet sign-in, an embedded wallet, and a real PEPU send |
| `token-gated-app` | Sign in, then unlock content by holding an ERC-20 or NFT — balance checks batched via Multicall3 |
| `nft-mint` | An ERC-721 mint page (connect, mint, view owned tokens) plus the Foundry + Hardhat contract |
| `game-app` | A tap-to-score game demoing Privy session signers — grant once, then play with no wallet popup per move |
| `sponsored-demo` | Gas-sponsored transactions: a zero-balance smart account taps on-chain, paid by the PEPU paymaster. **It needs a paymaster URL with your project token** (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`) set in a Privy app with Smart Wallets (Kernel, bundler + paymaster URLs) for chain 97741. See its README |
| `sponsored-session-app` | Google or email sign-in, one scoped on-chain session (ZeroDev Kernel permission), then actions with no popup and no user gas via the PEPU paymaster. **Needs `PEPU_PAYMASTER_URL` with your project token** (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`); the bundler defaults to `https://bundler.pepeunchained.com` |

## Usage

```bash
npx create-pepu-app@latest
# or
npm create pepu-app@latest
# or
pnpm create pepu-app
```

Run interactively with no flags and you get an arrow-key flow
(`@clack/prompts`): template picker (each option shows its features, Google
login / session keys / sponsored gas, and a one-line description), project
name, package manager (detected), install, and git init. Any question whose
flag you passed is skipped.

Non-interactive (CI, scripts, agents):

```bash
npx create-pepu-app@latest my-app --yes --no-install --no-git
npx create-pepu-app@latest my-app --template sponsored-session-app --pm pnpm --yes
npx create-pepu-app@latest my-app --template game-app --yes --no-install --no-git --json
```

No TTY, `--yes` or `--json` means no prompts. `--yes` installs
dependencies and runs `git init` unless you pass `--no-install` / `--no-git`.

### Options

```
-t, --template <name>   Template (default: consumer-app)
-y, --yes               Skip prompts, accept defaults
    --pm <manager>      npm, pnpm, yarn or bun (default: detected)
    --install | --no-install
    --git | --no-git
    --sdk <vendor|npm>  How the app depends on @pepu-chain/sdk (default: npm)
    --skip-agent-files  Leave out AGENTS.md, CLAUDE.md
    --json              One JSON document on stdout; implies --yes
    --list              List templates (with --json: as JSON)
-h, --help / -v, --version
```

### --json (for agents)

Stdout is exactly one JSON document, nothing else (install output goes to
stderr). Success: `{ ok: true, path, targetDir, template, title, features,
packageManager, sdk: { mode, spec, fellBackToVendor }, installed,
gitInitialized, envFile, requiredEnv: [{ key, secret, missing }], missingEnv,
privyDashboard: [{ id, label, fix }], nextSteps, agentFiles, warnings }`.
Failure: `{ ok: false, error }` with exit code 1. Only key names are ever
reported, never values.

## What it does

1. Copies the chosen template (hidden files included) into the target directory.
2. Sets `package.json`'s `name` to a slug of the project name.
3. Points `@pepu-chain/sdk` at the SDK, per `--sdk`:
   - `npm` (default): `^<sdk version>` from the registry. Falls back to
     `vendor` (with a warning, `fellBackToVendor: true` in `--json`) if the
     SDK is not published or npm is unreachable.
   - `vendor`: `file:./vendor/pepu-sdk` plus a bundled, pre-built copy of the
     SDK (`workspace:*` cannot resolve outside the monorepo).
4. Writes `.env.local` from `.env.example`: a header with the network details
   (Pepe Unchained V2 mainnet, chainId 97741, RPC, explorer). Every
   secret stays blank; no value is ever invented.
5. Keeps the agent files (`AGENTS.md`, `CLAUDE.md`, editor MCP
   files) and fills in any that are missing from the shared `templates/_agent`
   kit, unless `--skip-agent-files`.
6. Optionally installs and runs `git init`.
7. Prints tailored next steps: the env vars still blank (from
   `TEMPLATE_REQUIREMENTS` in `@pepu-chain/sdk/doctor`), the Privy dashboard
   settings the template needs (from `PEPU_PRIVY_REQUIREMENTS`), and the
   template's own steps (for example game-app's authorization key).

## Development (this package)

For contributors working in the source repository:

```bash
pnpm install                 # from the repo root
pnpm --filter @pepu-chain/sdk build   # create-pepu-app vendors the SDK's dist/
pnpm --filter create-pepu-app sync    # refresh templates/ and vendor/
pnpm --filter create-pepu-app build   # sync + bundle to dist/
pnpm --filter create-pepu-app test    # vitest, against the real synced assets
pnpm --filter create-pepu-app dev -- my-app --yes   # run the CLI from source
```

`templates/<name>/` and `vendor/pepu-sdk/` inside this package are
**generated** — mirrored from `../../templates/<name>` and `../sdk`
respectively by `scripts/sync-assets.mjs`. Don't hand-edit them; edit the
source (the top-level template, or the SDK) and re-run `pnpm sync`.

`src/templates.json` is the single source of truth for which templates
exist: `src/templates.ts` (picker order, `--help`, validation) and
`scripts/sync-assets.mjs` (what gets vendored) both read it, and
`test/template-registry.test.ts` fails if a directory under the repo's
top-level `templates/` isn't listed there.

**Adding a template:** create `templates/<name>/` at the repo root, add one
entry (`name, title, description, features, requiredEnv, optionalEnv, privyDashboard, extraSteps, hasContracts, difficulty, recommendedFor, mcp`; a test keeps required env and dashboard keys equal to the SDK doctor's `TEMPLATE_REQUIREMENTS`) to `src/templates.json`, then `pnpm sync`.

**Removing a template:** delete its entry from `src/templates.json`, and
delete its `templates/<name>/` directory (the registry test requires disk
and registry to agree). Then update the count and table in this README and
the name assertions in `test/index-cli.test.ts`. Nothing else enumerates
templates.

See each template's own `AGENTS.md` (e.g.
[`templates/consumer-app/AGENTS.md`](../../templates/consumer-app/AGENTS.md))
for the rules that *scaffolded app's* code follows (gas wording, never
inventing chain facts, etc.) — this README only covers the CLI.

Hidden files: `sync-assets` mirrors dotfiles and dot-directories. npm never
packs `.gitignore` / `.npmrc`, so they are stored as `_gitignore` / `_npmrc`
in this package and restored on scaffold. The bundle includes the SDK's
doctor and Privy tables (the SDK is a devDependency, inlined by tsup).
