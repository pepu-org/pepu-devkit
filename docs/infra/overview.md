# Infrastructure Map

One page listing every endpoint and address the PEPU dev kit relies on: bundler, paymaster, EntryPoints, Kernel, Multicall3, Permit2 and the CREATE2 deployer. Start here to find the right detail page. For the call flow between these pieces see [Architecture: Who Calls What](../concepts/architecture.md).

The hosted bundler (`https://bundler.pepeunchained.com`) and paymaster service (`https://paymaster.pepeunchained.com`) are the SDK defaults. You can also run your own bundler or policy service.

## Endpoints

| Service | Variable | Hosted URL | Local default | Detail |
|---|---|---|---|---|
| Bundler (Alto, ERC-4337 v0.7) | `PEPU_BUNDLER_URL` (browser: `NEXT_PUBLIC_PEPU_BUNDLER_URL`) | `https://bundler.pepeunchained.com` (SDK default) | `http://localhost:4337` | [Bundler Overview](bundler/overview.md), [API](bundler/api.md), [Operating](bundler/operating.md) |
| Paymaster policy service | `PEPU_PAYMASTER_URL` (browser: `NEXT_PUBLIC_PEPU_PAYMASTER_URL`) | Base `https://paymaster.pepeunchained.com` (SDK default). The ERC-7677 URL always embeds a token: `https://paymaster.pepeunchained.com/v2/paymaster/<token>`, so there is no tokenless default | `http://localhost:8788` | [Paymaster Overview](paymaster/overview.md) |
| RPC | `PEPU_RPC_URL` | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` | | [Network Reference](../get-started/network-reference.md) |

The SDK resolves these in `src/endpoints.ts` (`resolvePepuEndpoints()`): explicit option, then env, then the hosted default (`PEPU_HOSTED`: `bundlerUrl`, `paymasterBaseUrl`, and `paymasterUrl: null` because the ERC-7677 URL needs a token). `isHostedSponsorshipLive()` returns true. Build the token URL with `hostedErc7677Url(token)` (`@pepu-chain/sdk/paymaster`). The `/v2` routes of the service are public (free-tier, config, SIWE login, project verify); `/v2/admin` is not exposed. Health checks: `probeBundler` and `probePaymaster` (`@pepu-chain/sdk/aa`), or the MCP tools `pepu_bundler_health`, `pepu_paymaster_health` and `pepu_sponsorship_status`. Complete list: [Endpoints](../reference/endpoints.md).

## Addresses (mainnet 97741)

| Name | Address | Notes |
|---|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Deployed |
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Deployed |
| Kernel v3 factory | `0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419` | Deployed |
| Kernel MetaFactory | `0xd703aaE79538628d27099B8c4f621bE4CCd142d5` | Deployed |
| Kernel v3.1 implementation | `0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d` | Deployed |
| Kernel ECDSA validator | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` | Deployed |
| Kernel ECDSA signer module | `0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF` | Deployed |
| Call policy v0.0.4 | `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2` | Deployed. v0.0.5 is not deployed |
| Timestamp policy | `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` | Deployed |
| Multicall3 (PEPU-specific) | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` | Deployed. Canonical address has no code |
| Permit2 (canonical) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Deployed |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | Deployed |
| Paymaster v2 (`paymaster`, `paymasterV2`) | `0xdb28528C9399C33c9A0297E8A62F39145acbC30D` | Deployed |
| Paymaster v1 | `0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0` | Retired: deposit withdrawn (0), cannot sponsor. Never deposit |
| TapScore (demo) | `0x261eA5971B93237a56990206A46Bc80318e4d078` | Deployed |

Notes and sources for each are in the [Address Map](../contracts/address-map.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `CONFIG_MISSING_ENV` for a bundler or paymaster URL | `PEPU_PAYMASTER_URL` unset and the call needs the complete ERC-7677 URL, which always embeds a token (there is no tokenless default) | Set `PEPU_PAYMASTER_URL` to `https://paymaster.pepeunchained.com/v2/paymaster/<token>`, or pass `paymasterToken`. The bundler defaults to the hosted URL |
| Batched reads fail | Tooling uses the canonical Multicall3 address | Use the PEPU address |
| Policy-service call works locally, fails for others | You pointed at `http://localhost:8788` | Use `https://paymaster.pepeunchained.com` |

## Related

- [Architecture: Who Calls What](../concepts/architecture.md)
- [Address Map](../contracts/address-map.md)
- [Bundler Overview](bundler/overview.md)
- [Paymaster Overview](paymaster/overview.md)
- [Sponsored Transactions](../onboarding/sponsored-transactions.md)
