# Contributing to the Pepe Unchained Developer Kit

Thanks for your interest in contributing. This repo is a pnpm workspace
containing three npm packages, six starter templates, a Claude Code
plugin, and the PEPU developer documentation.

## Setup

Requirements: Node.js >= 18.17, [pnpm](https://pnpm.io) 11.x (the repo pins
`packageManager: pnpm@11.25.0` in `package.json` — `corepack enable` will
pick this up automatically).

```bash
git clone https://github.com/pepu-org/pepu-devkit.git
cd pepu-devkit
pnpm install
```

On Windows, clone with `git clone -c core.longpaths=true https://github.com/pepu-org/pepu-devkit.git` when the target folder is deep (the longest tracked path is 112 characters, so a base folder over about 147 characters otherwise fails with "Filename too long").

## Build order matters

`create-pepu-app` vendors a built copy of `@pepu-chain/sdk` (see
[`RELEASING.md`](RELEASING.md) for
why), so builds must happen in this order:

```bash
pnpm --filter @pepu-chain/sdk build
pnpm --filter @pepu-chain/mcp build
pnpm --filter create-pepu-app build   # runs scripts/sync-assets.mjs first
```

Build order matters: `create-pepu-app` vendors the SDK build. See
[`RELEASING.md`](RELEASING.md) for the full verification and release sequence.

## Running tests

```bash
pnpm --filter @pepu-chain/sdk test
pnpm --filter @pepu-chain/mcp test
pnpm --filter create-pepu-app test   # needs @pepu-chain/sdk built first — see above
```

Or all at once: `pnpm -r --workspace-concurrency=1 test`. Also run `node templates/scripts/check-design.mjs` and `node scripts/check-links.mjs`.

## The one rule that matters most here: never guess a chain fact

This repo's credibility rests on every chain ID, RPC URL, contract address,
ABI, and gas number being independently verified against live PEPU mainnet —
not copied from a block explorer's UI, not assumed from "how it works on
other Arbitrum Orbit chains," and never invented. Read
[`docs/contracts/multicall3.md`](docs/contracts/multicall3.md) for a worked
example of why this matters: PEPU's Multicall3 is at a non-canonical address
for a structural reason (a pre-signed deploy transaction with a gas limit
too low for this chain's opcode costs), and every tool that assumes the
canonical address silently fails here.

If you're adding or changing a contract address, chain fact, or ABI in
`packages/sdk` or `packages/mcp`:

1. Verify it against live mainnet (`eth_getCode`, a live read call, or both)
   — cite exactly how in a source comment, the way the existing code does.
2. Never substitute an address from another chain's deployment "because it's
   usually the same" — PEPU's Multicall3 is the canonical counterexample.
3. If you can't verify something, say so in the code/docs rather than
   guessing. An honest "not verified" note is more useful to the next reader
   than a confident wrong answer.

## Code conventions

- TypeScript strict mode; no `any`.
- Named exports (no default exports) in `packages/*/src`.
- New public API surface needs tests in the same PR.
- Each package's `AGENTS.md` (`packages/sdk/AGENTS.md`,
  `packages/mcp/AGENTS.md`) has package-specific conventions and gotchas —
  read the relevant one before touching that package.

## Adding a starter template

Templates live in `templates/<name>` and are mirrored into
`packages/create-pepu-app` at build time by
`packages/create-pepu-app/scripts/sync-assets.mjs`. Adding one requires:

1. The template itself under `templates/<name>`.
2. An entry in `TEMPLATES` in `packages/create-pepu-app/src/templates.ts`
   (what the CLI offers).
3. A matching entry in `TEMPLATE_NAMES` in
   `packages/create-pepu-app/scripts/sync-assets.mjs` (what actually gets
   bundled into the npm package).

Both lists must stay in sync — see the comments in each file. (As of this
writing, `templates/game-app` exists on disk but is in neither list yet.)

## Documentation

Developer-facing docs live in `docs/` and sync to
[docs.pepeunchained.com](https://docs.pepeunchained.com) via GitBook's
Git Sync. `docs/SUMMARY.md` defines the published table of contents — a
page not listed there will not appear on the live site. See
[`docs/README.md`](docs/README.md) for the full explanation.

## Pull requests

- Keep PRs scoped to one concern.
- Run the affected package's build, typecheck, and test scripts locally
  before opening a PR — CI (`.github/workflows/ci.yml`) runs the same
  commands and will block merge otherwise.
- Describe *why* a change is needed, not just what changed — especially for
  anything touching a chain fact or contract address, per the verification
  rule above.

## Security

Do not open a public issue for a security vulnerability — see
[`SECURITY.md`](SECURITY.md) for the disclosure process.

## License

By contributing, you agree your contribution is licensed under this repo's
[MIT license](LICENSE).
