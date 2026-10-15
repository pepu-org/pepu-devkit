# create-pepu-app CLI

`create-pepu-app` scaffolds a PEPU starter template into a new folder: it copies the template, vendors the SDK, writes `.env.local`, adds the agent kit, optionally installs dependencies and runs `git init`, then prints what is left for you to do. This page is the reference for its prompts, flags, `--json` output, env prefill and the vendored-SDK behaviour.

> Status: built and tested (version 0.1.3, on npm). The scaffold, `--json` output and doctor wiring have tests in `packages/create-pepu-app/test`. The default is the npm SDK, with a vendored fallback when npm cannot be reached. Run it with `npx create-pepu-app@latest`. The templates it ships scaffold `@pepu-chain/sdk@^0.2.2`.

## Prerequisites

- Node.js 18 or newer.
- A package manager: npm, pnpm, yarn or bun. The CLI detects the one that launched it.
- A target folder that does not exist or is empty.

## Usage

```bash
npx create-pepu-app                       # interactive
npx create-pepu-app my-app --yes          # defaults, no prompts
npm create pepu-app@latest my-app -- --pm pnpm
npx create-pepu-app my-app --template token-gated-app --yes
npx create-pepu-app --list                # show the templates
npx create-pepu-app my-app --template sponsored-session-app --yes --no-install --no-git --json
```

Agents can do the same through the MCP tool `pepu_scaffold_app`, which runs this CLI with `--yes --json`. See [Tool Reference](../mcp/tools.md#pepu_scaffold_app).

## Flags

```text
create-pepu-app [directory] [options]
```

| Flag | Default | What it does |
|---|---|---|
| `directory` (positional) | prompted, or `./pepu-app` with `--yes` | Where to create the project. Only one is accepted. A path such as `./apps/my-app` works; the package name is derived from the last segment. |
| `-t`, `--template <name>` | `consumer-app` | The template to scaffold. Passing it skips the template question. |
| `-y`, `--yes` | off | Skip prompts and accept defaults. Installs and runs `git init` unless you pass `--no-install` or `--no-git`. |
| `--pm <manager>` | auto-detected | `npm`, `pnpm`, `yarn` or `bun`. Detected from `npm_config_user_agent`, falling back to `npm`. |
| `--install` / `--no-install` | ask, or install | Install dependencies after scaffolding, or skip. |
| `--git` / `--no-git` | ask, or `git init` | Run `git init`, or skip. It is also skipped when the folder is already inside a git repository or git is missing. |
| `--sdk <mode>` | `npm` | How the app depends on `@pepu-chain/sdk`: `vendor` or `npm`. See [Vendored SDK versus npm](#vendored-sdk-versus-npm). |
| `--skip-agent-files` | off | Leave out the agent kit: `AGENTS.md`, `CLAUDE.md`, `.cursor/mcp.json`, `.vscode/mcp.json` and `.claude/settings.json`. See [AGENTS.md and CLAUDE.md in Templates](../agent-tooling/agents-md.md). |
| `--json` | off | Print exactly one JSON document on stdout. Implies `--yes`. For agents and scripts. |
| `--list` | off | Print the templates and exit. With `--json`, as JSON. |
| `-h`, `--help` | | Show usage. |
| `-v`, `--version` | | Show the CLI version. |

Parsing rules: an unknown flag, a missing value (`--template` with nothing after it), an invalid `--pm` or `--sdk` value, or a second positional argument is an error.

## Interactive flow

The prompts run only when stdin is a terminal and neither `--yes` nor `--json` is set. Each question is skipped when its flag was given. With no terminal (CI, piped input) the CLI behaves as if `--yes` were passed instead of waiting for an answer.

1. **Which template?** An arrow-key list. Each row shows the template title and its features (sign-in + embedded wallet, session keys, sponsored gas), and the description appears on the highlighted row. Default `consumer-app`.
2. **Project name.** Defaults to the directory's name, or `pepu-app`. The package name is a slug of it.
3. **Package manager.** `npm`, `pnpm`, `yarn` or `bun`, with the detected one marked.
4. **Install dependencies?** Yes by default.
5. **Initialize a git repository?** Yes by default.

Then the CLI copies the template, rewrites `package.json`, vendors the SDK, writes `.env.local`, adds the agent files, installs and runs `git init` as chosen, and shows numbered next steps.

Cancelling at any prompt exits with code 1 and creates nothing.

## What the scaffold does

1. Copies `templates/<name>` into the target folder and restores dotfiles.
2. Sets the `package.json` `name` to a slug of the project name and rewrites the `@pepu-chain/sdk` dependency (`workspace:*`) to the SDK spec.
3. Vendors the SDK into `vendor/pepu-sdk` when in vendor mode.
4. Generates `.env.local` from `.env.example`.
5. Applies the agent kit (kept, filled in from the shared kit, or dropped with `--skip-agent-files`).
6. Installs dependencies and runs `git init` when chosen.
7. Computes the next steps from the template's requirements and the actual contents of `.env.local`.

## Env prefill and next steps

`.env.local` keeps every comment and line of `.env.example` and is prefixed with a header that states the network: Pepe Unchained V2, mainnet, chain `97741`, currency PEPU, the public RPC and the explorer. The SDK already knows these, so no network variable needs setting by hand.

Secrets are never prefilled. `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_KEY`, `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` stay blank (any variable whose name matches `SECRET`, `AUTHORIZATION_KEY`, `API_KEY`, `PAYMASTER_URL` or `BUNDLER_URL` is treated as a credential). Values that a template's `.env.example` already carries as a public default stay as they are, for example the `WPEPU` address in `token-gated-app` and the paymaster contract address in `sponsored-demo`. If `.env.local` already exists it is not overwritten.

The next steps come from the SDK doctor's `TEMPLATE_REQUIREMENTS` and the Privy requirements table, checked against the real `.env.local`:

1. `cd <dir>`
2. The install command, when you skipped the install or it failed.
3. The env vars still blank, by name. Secrets stay server-side and out of git.
4. "Set at least one of A or B" for any-of groups (token-gated-app needs one gate token address).
5. The Privy dashboard settings the template needs, from `PEPU_PRIVY_REQUIREMENTS`.
6. The template's extra steps, with `{run:<script>}` expanded to your package manager's command (for example generating the authorization key for `game-app`, or deploying the contract for `nft-mint`).
7. The doctor command, if the template defines `doctor`.
8. The dev command.

The app runs and shows a setup screen even before you add a Privy App ID.

### Doctor

Every template has an `npm run doctor` script. It loads `.env.local` and runs `checkPepuEnv` from `@pepu-chain/sdk/doctor` for that template. It prints one line per required key (`ok` or `FAIL` plus the fix), never a value, and exits 1 when any required key is missing or malformed. The same check is available to agents as `pepu_check_env` and, for the dashboard, `pepu_check_privy_config`. See [Privy Env Vars and Verification](../privy/env-and-checks.md).

## JSON output

`--json` prints one document to stdout and sends everything else (including the package manager's install output) to stderr. Key names only, never values.

Success:

| Field | Type | Meaning |
|---|---|---|
| `ok` | `true` | |
| `path` | string | Absolute path of the new project. |
| `targetDir` | string | Same as `path`. |
| `template` | string | Template name. |
| `title` | string | Template title. |
| `features` | array of `login`, `session`, `sponsor` | What the template demonstrates (display tags). The SDK doctor's `pillars` are separate. |
| `packageManager` | string | The one used for printed commands and the install. |
| `sdk` | object | `{ mode: "vendor" or "npm", spec?: string, fellBackToVendor: boolean }`. |
| `installed` | boolean | Whether the install ran and succeeded. |
| `gitInitialized` | boolean | Whether `git init` ran. |
| `envFile` | string, optional | `.env.local`, when generated. |
| `requiredEnv` | array | `{ key, secret, missing }` for each required variable. `missing` is true when the scaffold left it blank. |
| `missingEnv` | array of strings | The keys still to set. |
| `privyDashboard` | array | `{ id, label, fix }` for each Privy dashboard setting needed. |
| `nextSteps` | array of strings | The same steps the human output prints. |
| `agentFiles` | array of strings | Agent kit files present in the project. |
| `warnings` | array of strings | For example a failed install, a skipped `git init`, an SDK fallback. |

An example for a no-install scaffold (abridged):

```json
{
  "ok": true,
  "path": "/home/me/my-app",
  "template": "game-app",
  "features": ["login", "session"],
  "packageManager": "pnpm",
  "sdk": { "mode": "npm", "spec": "^0.2.2", "fellBackToVendor": false },
  "installed": false,
  "gitInitialized": false,
  "envFile": ".env.local",
  "requiredEnv": [
    { "key": "NEXT_PUBLIC_PRIVY_APP_ID", "secret": false, "missing": true },
    { "key": "PRIVY_APP_SECRET", "secret": true, "missing": true }
  ],
  "missingEnv": ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"],
  "nextSteps": ["cd my-app", "pnpm install", "..."],
  "warnings": []
}
```

Failure (also exit code 1):

```json
{ "ok": false, "error": "Unknown template \"foo\".", "templates": ["consumer-app", "..."] }
```

`error` is always present. `templates` is added for an unknown template. Argument errors and an existing non-empty directory also come back this way.

`--list --json` prints `{ "ok": true, "templates": [...] }`, where each entry is the registry record (name, title, description, features, required and optional env, Privy dashboard ids, extra steps, `hasContracts`, difficulty, `recommendedFor`).

## Vendored SDK versus npm

By default the scaffold depends on `@pepu-chain/sdk` from npm. If the registry has no such package (or npm is offline), the CLI bundles a copy of the SDK instead. This is the vendored-SDK note:

| Mode | What it does |
|---|---|
| `--sdk npm` (default) | Writes `^<version>` from the registry. The CLI checks the registry with `npm view @pepu-chain/sdk version` (15 second timeout). If the SDK is not published, or npm is offline, it falls back to the vendored copy, says so as a warning, and reports `fellBackToVendor: true`. |
| `--sdk vendor` | Copies the bundled SDK into `vendor/pepu-sdk` in your project and rewrites the dependency to `file:./vendor/pepu-sdk`. The vendor folder is part of your project: commit it. |

If the CLI cannot find a bundled SDK, it warns that a dependency install may fail until the SDK is published or vendored.

To move a vendored project to npm later, change the `@pepu-chain/sdk` dependency to a registry range and delete `vendor/pepu-sdk`.

## Exit codes

| Code | When |
|---|---|
| 0 | Scaffold completed (even if the install or `git init` produced a warning), or `--help`, `--version`, `--list`. |
| 1 | Bad arguments, unknown template, target directory exists and is not empty, a prompt was cancelled, or an unexpected error. With `--json` the error is printed as `{ ok: false, error }` first. |

A failed install does not fail the scaffold: the project is created, a warning is recorded and the next steps tell you to run the install command yourself.

## What to expect

- The scaffold takes seconds; the install dominates.
- You end up with a folder that runs with `dev` and shows a setup screen listing exactly what is still missing.
- For sponsorship templates the CLI does not invent endpoints. It points you to the hosted bundler (`https://bundler.pepeunchained.com`, the default for `PEPU_BUNDLER_URL`) and tells you to set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<token>` with your own project token (local defaults for your own services are `http://localhost:4337` and `http://localhost:8788`).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `"<dir>" already exists and isn't empty.` | The target has files in it | Choose a new directory or empty it. The CLI never overwrites. |
| `Unknown template "<name>".` | Typo or a removed template | Run `npx create-pepu-app --list` and pass one of those names. |
| `--sdk requires "vendor" or "npm"` | Missing or wrong value | Pass `--sdk vendor` or `--sdk npm`. |
| Warning: `--sdk npm` fell back to the vendored copy | You are offline, or the registry check failed | Nothing to fix. Pass `--sdk vendor` to skip the registry check. |
| Warning: dependency install failed | Network, registry or package manager error | Run the printed install command in the project to see the error. |
| Warning: skipped git init | git is not installed, or the folder is already inside a repository | Nothing to fix, or run `git init` yourself. |
| Login fails after the first run | The Privy allowed origin does not match the port | Use the exact origin including the port (`http://localhost:3000`). See [Privy Setup Walkthrough](../onboarding/privy-setup.md). |

## Related

- [Template Gallery](../templates/index.md)
- [Quickstart: Zero to a Sponsored Transaction in 10 Minutes](../get-started/quickstart-app.md)
- [AGENTS.md and CLAUDE.md in Templates](../agent-tooling/agents-md.md)
- [Environment Variables](../reference/env-vars.md)
