# Security Policy

## Scope

This policy covers the code in this repository: `@pepu-chain/sdk`, `@pepu-chain/mcp`,
`create-pepu-app`, the starter templates under `templates/`, the
`pepu-devkit` Claude Code plugin, and the deployment scripts under
`contracts/`.

It does **not** cover the Pepe Unchained V2 chain itself (Conduit's
infrastructure, the sequencer, the RPC endpoints), `pepuscan.com`
(Blockscout), or third-party contracts this kit merely reads from (e.g. the
Kernel v3 smart-account contracts, PepuSwap). Report issues in those to
their respective operators.

## Reporting a Vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Email **contact@pepeunchained.com** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof-of-concept if you have one.
- The package/file and version affected.
- Whether you believe it affects deployed contracts, an npm package, the
  MCP server, or the CLI/templates specifically — the risk profile differs
  a lot between "a template ships a client-side bug" and "an address in
  `@pepu-chain/sdk` is wrong."

We will acknowledge receipt within **5 business days** and aim to provide an
initial assessment (severity, whether it's confirmed, expected timeline)
within **10 business days**. Please give us a reasonable window to ship a
fix before any public disclosure.

## What counts as a security issue here

Examples worth reporting privately rather than as a public issue:

- A contract address in `packages/sdk` or `packages/mcp` that is wrong,
  or that could cause a caller to send funds/approvals to an attacker
  address (this is the highest-severity class of bug this kit can ship).
- A starter template that constructs a transaction, signature, or Permit2
  payload in a way that could be exploited (e.g. an unbounded approval, a
  missing nonce/deadline check, a signature that doesn't bind to the
  intended chain/contract).
- Any secret, private key, or credential accidentally committed to this
  repository or shipped inside a published npm tarball.
- A vulnerability in `create-pepu-app`'s scaffolding logic that could lead
  to arbitrary file write/execution outside the target directory.

Bugs that are just "the app doesn't work" or "the docs are wrong" belong in
a regular GitHub issue instead.

## Supported Versions

This kit is pre-1.0 (`0.x`). Security fixes are made against the latest
published version of each package; older `0.x` versions are not
separately patched.
