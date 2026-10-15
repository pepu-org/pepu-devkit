# FAQ

Short answers to questions builders ask first, with links to the page that has the detail.

> Status: reference. Answers reflect the code on main; re-check hosting status before repeating it as current.

## Chain and network

**Which chain do I build on?** Pepe Unchained V2 mainnet, chain ID `97741`. Testnet `97740` is out of scope (no faucet, no indexed explorer, no deployed infrastructure). `3409` is the dead V1 chain. See [V1 vs V2](../get-started/v1-vs-v2.md).

**Why is gas so high in gwei?** PEPU is a low-value token; the base fee is around 12,500 gwei and a transfer still costs a fraction of a cent. Do not hardcode a lower price. See [Network Reference](../get-started/network-reference.md).

**Is Multicall3 at the usual address?** No. PEPU's is `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`; the canonical address has no code. See [The Multicall3 Trap](../contracts/multicall3.md).

## Privy and login

**Login fails with a blocked iframe or 403.** The origin, including the port, is not in Allowed origins. Next.js may have moved to 3001. See [Dashboard Settings](../privy/dashboard-settings.md).

**"Creating your wallet..." never ends.** Use `PepuPrivyProvider` and `WalletGate`, which provision the wallet server-side. See [Embedded Wallets](../onboarding/privy-embedded-wallets.md).

**Do I need Smart Wallets in the Privy dashboard?** Only for the Privy Smart Wallets sponsorship transport. Not for login, Privy sessions or the combination.

**Which smart account setup should I use: ZeroDev-native or Privy Smart Wallets?** ZeroDev-native (the SDK builds the Kernel account) if you want sessions, the free tier, a server or a bot; Privy Smart Wallets for one gasless button in a client-only app. Users who just pay their own gas need neither. See [Smart Account Paths](../concepts/smart-account-paths.md).

**Why does my users' balance show 0 but they transacted?** With a smart account there are two addresses. See [The Two-Address Model](../onboarding/two-address-model.md).

## Sessions and sponsorship

**Privy session or Kernel session?** Privy: least setup, scope enforced by Privy, user pays gas. Kernel: scope enforced on-chain, usually sponsored, uses the hosted bundler and a funded project. See [Session Keys](../onboarding/session-keys.md).

**Is gas sponsorship available?** Yes. The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster (`https://paymaster.pepeunchained.com`) are live and proven on mainnet. You bring a project (claim, set targets and limits, deposit, token); the free tier is only for PEPU's own Privy app. Check live with `pepu_sponsorship_status`, or run your own from `services/`. See [Sponsored Transactions](../onboarding/sponsored-transactions.md).

**Why did the second tap fail with `trailing-hour spend ... would exceed cap`?** Per-user caps are below the worst-case reservation (about 20.5 PEPU for a session's first operation, 6.9 later). Raise them.

**What is the tiered paymaster?** v2: a free tier (100 PEPU per Privy user per day and 50 PEPU per hour, PEPU's own Privy app only) plus project deposits. Deployed on mainnet as a canary: internally reviewed 3x, external audit pending, funded in small tranches. See [Sponsorship Tiers](../onboarding/sponsorship-tiers.md).

**Does revoking a Kernel session uninstall it on-chain?** No. The server key is deleted at once; the grant lapses at expiry. Keep sessions short.

## Agents and MCP

**How do I give my coding agent PEPU facts?** Install the MCP server (`npx -y @pepu-chain/mcp`) and, for Claude Code, the plugin. See [Build with an AI Coding Agent](../get-started/ai-assisted.md).

**Can the agent set up Privy?** It can scaffold, write env keys without printing secrets, generate the authorization key and check config. You must create the Privy app, copy the App ID and secret, and register the public key in the dashboard.

## Related

- [Glossary](glossary.md)
- [Troubleshooting](../troubleshooting.md)
- [Error Reference](errors.md)
