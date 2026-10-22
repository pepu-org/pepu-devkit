# Table of contents

* [Overview](README.md)

## Get Started

* [What is Pepe Unchained V2](get-started/introduction.md)
* [V1 vs V2: Which Chain Are You On](get-started/v1-vs-v2.md)
* [The Three Pillars and How They Combine](get-started/pillars.md)
* [Quickstart: Zero to a Sponsored Transaction in 10 Minutes](get-started/quickstart-app.md)
* [Build with an AI Coding Agent in 3 Minutes](get-started/ai-assisted.md)
* [Network Reference](get-started/network-reference.md)
* [Network Properties](get-started/network-properties.md)

## Onboarding and Wallets

* [Social Login and Embedded Wallets (Privy)](onboarding/privy-embedded-wallets.md)
* [The Two-Address Model](onboarding/two-address-model.md)
* [Session Keys: No Popup Per Transaction](onboarding/session-keys.md)
* [Sponsored Transactions](onboarding/sponsored-transactions.md)
* [Sponsored Session: No Popup, No Gas](onboarding/sponsored-session.md)
* [Google Login, Session and Sponsorship End to End](onboarding/google-session-sponsored.md)
* [Smart Accounts](onboarding/smart-accounts.md)
* [Sponsorship Tiers](onboarding/sponsorship-tiers.md)

## Concepts

* [Architecture: Who Calls What](concepts/architecture.md)
* [Smart Account Paths: Plain Wallet, ZeroDev-Native or Privy Smart Wallets](concepts/smart-account-paths.md)
* [Trust and Security Model](concepts/trust-and-security.md)

## Privy

* [Privy Configuration Overview](privy/index.md)
* [Privy Setup Walkthrough](onboarding/privy-setup.md)
* [Dashboard Settings, Field by Field](privy/dashboard-settings.md)
* [Authorization Keys and Key Quorums](privy/authorization-keys.md)
* [Privy Env Vars and Verification](privy/env-and-checks.md)

## SDK

* [SDK Overview and Reference](sdk/reference.md)
* [Core: @pepu-chain/sdk](sdk/core.md)
* [/privy](sdk/privy.md)
* [/privy/react](sdk/privy-react.md)
* [/privy/wagmi](sdk/privy-wagmi.md)
* [/privy/server](sdk/privy-server.md)
* [/session](sdk/session.md)
* [/session/kernel](sdk/session-kernel.md)
* [/aa](sdk/aa.md)
* [/paymaster](sdk/paymaster.md)
* [/combo](sdk/combo.md)
* [/doctor](sdk/doctor.md)
* [Generated API Reference](sdk/api-reference.md)
* [SDK Error Catalog](sdk/errors.md)
* [Migration Notes](sdk/migration.md)

## MCP

* [MCP Server Overview](mcp/index.md)
* [Install per Client](mcp/install.md)
* [Tool Reference](mcp/tools.md)
* [Resources and Prompts](mcp/resources-and-prompts.md)

## Agent Tooling

* [MCP Server and Skills (overview)](agent-tooling/mcp-and-skills.md)
* [Skills Catalog](agent-tooling/skills.md)
* [Claude Code Plugin](agent-tooling/plugin.md)
* [AGENTS.md and CLAUDE.md in Templates](agent-tooling/agents-md.md)

## Templates and CLI

* [Template Gallery](templates/index.md)
* [Consumer App](templates/consumer-app.md)
* [Token-Gated App](templates/token-gated-app.md)
* [NFT Mint](templates/nft-mint.md)
* [Game App](templates/game-app.md)
* [Sponsored Demo](templates/sponsored-demo.md)
* [Sponsored Session App](templates/sponsored-session-app.md)
* [create-pepu-app CLI](cli/create-pepu-app.md)

## Infrastructure

* [Infrastructure Map](infra/overview.md)
* [Bundler Overview](infra/bundler/overview.md)
* [Bundler JSON-RPC API](infra/bundler/api.md)
* [Operating the Bundler](infra/bundler/operating.md)
* [Paymaster Overview](infra/paymaster/overview.md)
* [ERC-7677 Methods](infra/paymaster/erc7677.md)
* [REST API v1](infra/paymaster/rest-api-v1.md)
* [REST API v2](infra/paymaster/rest-api-v2.md)
* [Credential Matrix](infra/paymaster/auth.md)
* [Policy, Caps and the Circuit Breaker](infra/paymaster/policy-and-caps.md)
* [Register, Deposit and Claim a v2 Project](infra/paymaster/v2-register-deposit-claim.md)
* [PepuSponsoredPaymasterV7 Contract](infra/paymaster/contracts.md)

## Contracts and Addresses

* [Address Map](contracts/address-map.md)
* [Deployed Contracts Reference](contracts/deployed-contracts.md)
* [The Multicall3 Trap](contracts/multicall3.md)
* [Permit2](contracts/permit2.md)
* [EntryPoints and Kernel](contracts/entrypoints-and-kernel.md)
* [CREATE2 and Deterministic Deployment](contracts/create2-and-deterministic-deployment.md)
* [PepuSwap Addresses](contracts/pepuswap.md)
* [Deploy and Verify a Contract](contracts/deployment.md)
* [Paymaster v2 Spec Summary](contracts/paymaster-v2-spec.md)
* [Security Reviews](contracts/audits.md)

## Recipes

* [Read a Contract](recipes/read-a-contract.md)
* [Send a Transaction](recipes/send-a-transaction.md)
* [Sign with Privy, Broadcast Yourself](recipes/sign-with-privy-broadcast-yourself.md)
* [Provision the Wallet and Pin the Active Account](recipes/provision-and-pin-the-wallet.md)
* [Batch Reads with Multicall3](recipes/batch-reads-with-multicall3.md)
* [Add PEPU to a Wallet](recipes/add-pepu-to-a-wallet.md)
* [Deploy an ERC-20](recipes/deploy-an-erc20.md)
* [Gate Content by Token Balance](recipes/gate-content-by-token-balance.md)
* [Grant a Session](recipes/grant-a-session.md)
* [Send a Sponsored Transaction](recipes/sponsored-send.md)
* [Sponsored Session in One Flow](recipes/sponsored-session.md)
* [Deposit and Claim a Paymaster Project](recipes/v2-deposit-and-claim.md)
* [Sign a Permit2 Permit](recipes/permit2-permit.md)
* [Batch Reads with Multicall3 in React](recipes/multicall-in-react.md)
* [Explorer Links](recipes/explorer-links.md)

## Reference

* [Endpoints](reference/endpoints.md)
* [Environment Variables](reference/env-vars.md)
* [Error Reference](reference/errors.md)
* [Glossary](reference/glossary.md)
* [FAQ](reference/faq.md)
* [Changelog](reference/changelog.md)

## Troubleshooting

* [Troubleshooting](troubleshooting.md)

## Contributing

* [Docs Style Guide and Page Template](CONTRIBUTING-DOCS.md)
