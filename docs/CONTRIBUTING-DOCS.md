# Docs Style Guide and Page Template

Rules for writing and editing pages in this folder. The docs are the single source of truth for the PEPU dev kit, so accuracy outranks polish.

## Voice

- Plain, sober, friction-focused. Say what to do, then why.
- No hype words, no emoji, no marketing adjectives.
- Every page must make it easier to build or to use. If it does not, cut it.
- PEPU is a chain, not "an AI chain". Agent tooling is described as tooling that helps builders get PEPU facts right.

## Honesty about status

State plainly what is proven and what is pending. Use these labels consistently:

| Label | Meaning |
|---|---|
| Proven | Run end to end on mainnet, by a script or a person, and the page says which |
| Proven on mainnet (canary, external audit pending) | Deployed and exercised on mainnet, internally reviewed, not externally audited; the v2 paymaster carries this label |
| Built, not deployed | Code and tests exist; nothing live depends on it |
| Pending | Not built or not live yet |

Current facts to respect (re-verify before repeating as current):

- Mainnet only: chain ID `97741`. The testnet `97740` is out of scope for development. Chain ID `3409` is the dead V1 chain.
- The hosted endpoints are live and proven: bundler `https://bundler.pepeunchained.com` and paymaster service `https://paymaster.pepeunchained.com`. They are the SDK defaults; keep the env var names `PEPU_BUNDLER_URL` and `PEPU_PAYMASTER_URL` as overrides. The ERC-7677 URL always embeds a token (`https://paymaster.pepeunchained.com/v2/paymaster/<token>`), so there is no tokenless default; write `<token>` and never a real one. Local development defaults (`http://localhost:4337`, `http://localhost:8788`) may stay for people running their own services. Never write a tunnel URL (no ngrok, no trycloudflare) anywhere.
- The v2 paymaster `PepuSponsoredPaymasterV7` is deployed on mainnet as a canary. Use exactly: "deployed as a canary: internally reviewed 3x, external audit pending, funded in small tranches". Never say audited. The v1 paymaster is retired.
- Multicall3 is at a PEPU-specific address, never the canonical one. Give full addresses, never truncated ones, in tables meant for copying.
- Never state a feature is available if it is not live.

## Code samples use real SDK exports

- Import only symbols that exist in `@pepu-chain/sdk` and its documented subpaths: `/privy`, `/privy/react`, `/privy/wagmi`, `/privy/server`, `/session`, `/session/server`, `/session/react`, `/session/kernel`, `/aa`, `/aa/kernel`, `/aa/react`, `/aa/react-direct`, `/paymaster`, `/paymaster/server`, `/combo`, `/combo/react`, `/doctor`.
- If a symbol is not exported, do not invent it. Check `packages/sdk/src` and the exports test, or call the `pepu_sdk_exports` MCP tool.
- Prefer SDK functions over hand-rolled infrastructure. Use raw viem or JSON-RPC only where the SDK has no equivalent, and say so.
- Server-only code (Privy app secret, authorization key, claim attestation) is labeled server-only and never reads `NEXT_PUBLIC_` variables.
- Never print or embed secrets, keys or real tokens. Use obvious placeholders.
- Samples meant to compile live under `docs/snippets/` and are type-checked in CI. Pages include them and do not diverge from them.

## Page template

````markdown
# Page Title

One paragraph: what this page is for and who needs it.

> Status: proven | proven on mainnet (canary, external audit pending) | built, not deployed | pending (and what exactly was run)

## Prerequisites
## Steps or reference body
## What to expect
## Common failures
## Related
````

Rules:

- One H1 per page, title case, matching the `SUMMARY.md` entry.
- Reference pages use tables; procedures use numbered steps.
- Every failure symptom names the cause and the fix.
- Link with relative paths, for example from the docs root `[Session Keys](onboarding/session-keys.md)`.
- Add every new page to `SUMMARY.md` in the same change.
- Do not put Markdown link syntax inside `TODO` comments; the link checker reads them.

## Stubs and ownership

New pages start as stubs: a title, a one-paragraph purpose and a `TODO(Dn)` comment listing the required sections. The owner replaces the stub and removes the TODO and the status line.

| Writer | Folders |
|---|---|
| D2 | `get-started/`, `onboarding/`, `concepts/`, `privy/`, `reference/env-vars.md`, glossary, FAQ |
| D3 | `sdk/`, `recipes/`, `snippets/`, changelog |
| D4 | `mcp/`, `agent-tooling/`, `templates/`, `cli/` |
| D5 | `infra/`, `contracts/` |
| D6 | generated pages (`reference/errors.md`, `reference/endpoints.md`, `sdk/errors.md`), `llms.txt`, `llms-full.txt`, `troubleshooting.md` |

## Checks

- `node scripts/check-links.mjs` must report 0 broken links.
- `docs/llms.txt` assumes each page URL mirrors its path; D6 keeps it current.
