# MCP Resources and Prompts

The five `pepu://` resources the server exposes and its six prompts: what each is for, its arguments, and how an agent should chain them with the tools. Read this if you attach context by hand in a client UI, or if you want to know what the prompt starters tell the agent to do.

Resources and prompts are static text and bundled data; nothing here sends a transaction or needs a key.

## Prerequisites

- The server is installed in your client. See [Install per Client](install.md).
- A client that supports MCP resources and prompts. Not every client does: Claude Code lists prompts as slash commands and resources as `@` mentions, other clients vary. Tools work everywhere.

## Resources

Resources are read-only context that you or the agent can attach without a tool call.

| URI | Content | MIME type |
|---|---|---|
| `pepu://chain-facts` | Mainnet network facts (chain `97741`), a note that the testnet `97740` is out of scope, and the known gotchas list | `application/json` |
| `pepu://addresses` | Every tracked mainnet contract from the SDK registry (`getPepuAddresses`): deployed addresses with notes (including the v2 paymaster and the retired v1 paymaster, flagged `retired`), and contracts not yet deployed, with the reason | `application/json` |
| `pepu://docs/{slug}` | A page of these docs, from a snapshot bundled at build time. `{slug}` is a page path such as `onboarding/session-keys` | `text/markdown` |
| `pepu://skills/{name}` | A skill's `SKILL.md`, bundled at build time. `{name}` is a skill name such as `pepu-session-keys` | `text/markdown` |
| `pepu://sdk/exports` | Every `@pepu-chain/sdk` import path with its exports and one-line summaries, generated from the SDK build | `application/json` |

Notes:

- `pepu://docs/{slug}` and `pepu://skills/{name}` are resource templates. A client lists the available slugs and names, and the server completes partial values.
- The docs and skills snapshots are bundled when the package is built. They are as current as the installed server version. For a newer answer, update the server (`npx -y @pepu-chain/mcp` fetches the latest unless a version is pinned) or read the docs directly.
- An unknown slug or skill name returns an error that lists what is available.
- `pepu://addresses` shows `paymasterV2` (and its alias `paymaster`) at the deployed paymaster `0xdb28528C9399C33c9A0297E8A62F39145acbC30D`, and `paymasterV1` as retired. Do not deposit to the retired v1 paymaster. See [Address Map](../contracts/address-map.md).

The tools that mirror resources: `pepu_chain_info` and `pepu_known_gotchas` (chain facts), `pepu_get_docs` (docs), `pepu_sdk_exports` (SDK exports). Use the resource when you want to attach the whole thing; use the tool when the agent should decide.

## Prompts

A prompt returns one user message that tells the agent which tools and SDK functions to use, in order. Each ends with a short reminder: sponsorship uses the hosted bundler and paymaster service with a project token, Privy session mode is off-chain and the user pays gas, Kernel session mode is on-chain, deposits to the v2 paymaster are one-way, and a transaction is never called gasless unless a paymaster paid it.

| Prompt | Arguments (all optional) | What it tells the agent to do |
|---|---|---|
| `new-pepu-app` | `idea`, `directory` (absolute path) | Read `pepu://chain-facts`, call `pepu_list_templates` and choose a template, call `pepu_scaffold_app`, run `pepu_check_env`, then `pepu_check_privy_config` with the dev origin and port, and use `pepu_sdk_snippet` and `pepu_sdk_exports` for extra wiring. |
| `add-google-login` | `projectDir` | Apply the `privy-provider` and `ensure-wallet-route` snippets, run `pepu_check_env` (template `consumer-app`) then `pepu_check_privy_config`, and pin Coinbase to `eoaOnly` and the embedded wallet when wagmi is used. |
| `add-session` | `mode` (`privy` or `kernel`), `contract`, `functions` (comma-separated signatures) | Explain the two trust models and confirm one, call `pepu_session_policy`, apply the session snippets (Privy mode also runs `pepu_generate_authorization_key` and asks you to register the public key), and show the consent text and trust notice. |
| `add-sponsorship` | `projectDir` | Run `pepu_sponsorship_status`, `pepu_bundler_health` and `pepu_paymaster_health`; apply `sponsored-send` (and `sponsored-send-server` for scripts); use `pepu_explain_error` on failures; do not tell you to deposit into v2. |
| `add-sponsored-session` | `contract`, `functions` | Build the Kernel scope with `pepu_session_policy`, apply `sponsored-session` and `sponsored-session-client` (the scope on server and client must match), confirm with `pepu_sponsorship_status`, size spend caps above the gas reservation (about 20.5 PEPU for a session's first operation, 6.9 later), and warn that `createMemoryStore` is dev only. |
| `debug-tx` | `hash`, `error` | With a hash: `pepu_explain_tx`. With an error: `pepu_explain_error` using the text exactly as given. Then `pepu_sponsorship_status` if sponsorship is involved, `pepu_decode_error` for custom errors, and `pepu_known_gotchas`. |

The three pillar prompts map one to one onto the three pillars: `add-google-login` (Google to wallet), `add-session` (session keys), `add-sponsorship` (sponsored transactions), and `add-sponsored-session` is the combination. See [The Three Pillars and How They Combine](../get-started/pillars.md).

## How agents should chain them

1. Start from a prompt when one fits. It encodes the right order. In Claude Code the [plugin commands](../agent-tooling/plugin.md) wrap the same flows (`/pepu-new-app`, `/pepu-add-login`, `/pepu-add-session`, `/pepu-add-sponsorship`, `/pepu-add-sponsored-session`, `/pepu-doctor`).
2. Ground the facts first: `pepu_chain_info` or the `pepu://chain-facts` resource. Never answer chain questions from memory.
3. Pick code from `pepu_sdk_snippet` and confirm names with `pepu_sdk_exports` before writing anything by hand.
4. Verify with `pepu_check_env` and `pepu_check_privy_config`, then the project's own typecheck and build.
5. When something fails, `pepu_explain_error` with the exact text, then `pepu_known_gotchas`.

## What to expect

- Invoking a prompt produces a message, not a result. The agent then makes the tool calls itself, and you approve them according to your client's permission rules.
- The read-only tools run without prompting in most clients. The two write tools (`pepu_scaffold_app`, `pepu_generate_authorization_key`) ask first in clients that honour the annotation hints.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| The client shows no prompts or resources | The client only supports MCP tools | Use the tools directly, or the plugin commands in Claude Code. |
| `pepu://docs/...` returns "No docs page" | The slug is not in the bundled snapshot | Read the slug list the error prints, or call `pepu_get_docs` with no arguments. |
| Resource content looks stale | The snapshot is bundled at build time | Update the server to the latest version, or pin a newer one. |

## Related

- [MCP Server Overview](index.md)
- [Tool Reference](tools.md)
- [Skills Catalog](../agent-tooling/skills.md)
- [Claude Code Plugin](../agent-tooling/plugin.md)
