# Sponsorship tiers: stable facts for agents

This file states the stable facts of the tiered design (v2). For the rest, call the MCP tool
`pepu_get_docs` or read `docs/onboarding/sponsorship-tiers.md` (https://docs.pepeunchained.com/onboarding/sponsorship-tiers), and
treat any detail there that conflicts with this file as possibly out of date. Do not copy numbers other than the ones below into user-facing text.

## Versions

- **v1 (single-tenant verifying paymaster):** **retired.** Its deposit was withdrawn (deposit is 0); it sponsors nothing. Never deposit to it.
- **v2 (tiered, on-chain projects):** deployed on mainnet at `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` (`paymasterV2`, alias `paymaster`). Whether a given app is sponsored depends on its project and token: run `pepu_sponsorship_status` (SDK `checkSponsorship()`) and report that. Advise depositing only what the project needs.

## The v2 model, in four facts

1. **Free tier, funded by the chain.** 100 PEPU per user per day and 50 PEPU per user per hour (enforced by the policy service), for Privy users only: a verified Privy access token from PEPU's own Privy app in the ERC-7677 context is required. Today the only free-tier target is TapScore (the manager can add more), so it does not cover third-party apps. Non-Privy wallets do not draw on it.
2. **Projects are keyed by Privy app id.** `projectId = keccak256(bytes(appId))` (`computeProjectId`). The app id is case-sensitive. A project pays for its own users' gas.
3. **Anyone can deposit into a project.** Funding is permissionless. Claiming a project needs an attestation proving control of the Privy app (EIP-712 `ProjectClaim`).
4. **Deposits are one-way: no withdrawals by anyone.** Do not tell a developer they can get a deposit back.

If a project cannot pay, its users are not covered by the chain's free pool unless they qualify for the free tier themselves.

Credentials: a project client token (`ppt_`) only works from the project's allowed origins (refused with `project_origin_not_allowed` otherwise, and when none are set); server-side callers use the project server key (`ppk_`). The ERC-7677 URL is `https://paymaster.pepeunchained.com/v2/paymaster/<token>`.

## How to answer common questions

- "Can my app use gas sponsorship now?" Run `pepu_sponsorship_status` and answer from it. The hosted services are the defaults; the app needs a project (claim, deposit, token) unless it is PEPU's own free-tier app.
- "How much is free?" 100 PEPU per user per day and 50 PEPU per hour for PEPU's own Privy app users, TapScore only for now. Beyond that, deposit into your own project.
- "Can I get my deposit back?" Under the v2 design, no. Deposits are one-way.

`pepu_known_gotchas` carries the same facts. The v2 workflow is the `pepu-paymaster-projects` skill.
