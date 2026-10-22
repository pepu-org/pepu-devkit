# Migration Notes

Upgrade notes for `@pepu-chain/sdk`. The only upgrade today is 0.1 to 0.2. It adds subpaths and keeps every 0.1 export, so no code has to change to upgrade, but one helper is deprecated and several hand-rolled patterns now have SDK replacements.

Every 0.1 export is still present in 0.2.4. The full list of changes is in the [Changelog](../reference/changelog.md).

## 0.1 to 0.2

### Breaking changes

None. Additive only.

### Deprecated

| 0.1 | Status in 0.2 | Replacement |
|---|---|---|
| `getSponsorshipStatus(options?)` | Deprecated. Still exported from `@pepu-chain/sdk` and `/aa`. Always returns `{ available: false, reason }` and ignores `bundlerUrl` | `checkSponsorship(options?)`, a live probe of the bundler and paymaster |
| `useSponsorshipStatus(options?)` from `/react` | Deprecated for the same reason | `usePepuSponsorship({ pollMs? })` from `/aa/react` |

```ts
// 0.1
import { getSponsorshipStatus } from "@pepu-chain/sdk";
const { available } = getSponsorshipStatus(); // always false

// 0.2
import { checkSponsorship, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
const s = await checkSponsorship({ publicClient: getPublicClient(pepuMainnet) });
if (!s.available) console.log(s.reason, s.fixes);
```

`checkSponsorship` resolves the bundler and paymaster URLs from options, then env (`PEPU_BUNDLER_URL`, `PEPU_PAYMASTER_URL`), then the hosted defaults: the hosted bundler (`https://bundler.pepeunchained.com`) and the hosted paymaster service base (`https://paymaster.pepeunchained.com`). The complete ERC-7677 paymaster URL has no default because it embeds a project token. It probes both and reports `available`, `transport`, `reason` and `fixes`. It never throws for an unreachable service.

### New subpaths

| Subpath | Replaces this hand-rolled code |
|---|---|
| `/privy`, `/privy/react`, `/privy/wagmi`, `/privy/server` | Your own `PrivyProvider` config, wallet gate, wagmi config, active-wallet pin and ensure-wallet route. See [Provision the Wallet and Pin the Active Account](../recipes/provision-and-pin-the-wallet.md) |
| `/session`, `/session/server`, `/session/react` | Your own session policy builder, grant, status and revoke routes and sign-then-broadcast code. See [Grant a Session](../recipes/grant-a-session.md) |
| `/session/kernel` | Hand-built ZeroDev permission validators and approval handling |
| `/aa`, `/aa/kernel`, `/aa/react` | Your own bundler and paymaster clients, the Alto fee estimator, UserOperation error decoding and receipt parsing. See [Send a Sponsored Transaction](../recipes/sponsored-send.md) |
| `/paymaster`, `/paymaster/server` | Direct calls to the policy service and hand-encoded v2 contract calls |
| `/combo`, `/combo/react` | The five session routes and the browser flow in the `sponsored-session-app` template |
| `/doctor` | Ad hoc env checks |
| `/server` | Kept as a stable path that re-exports the pure session policy helpers. New server code lives in `/privy/server`, `/session/server` and `/paymaster/server` |

### New exports on existing paths

On `@pepu-chain/sdk`: the error model (`PepuError` and subclasses, `explainError`, `toPepuError`, `toErrorBody`, `toErrorResponse`, `PEPU_ERROR_CATALOG`), `resolvePepuEndpoints` and `PEPU_ENV`, `pepuMulticall` and `getMulticall3`, `getPermit2` and the Permit2 typed-data builders, `explorerLinks`, `getPepuAddresses`, `formatUnitsCompact`, `erc20Abi` and `erc721Abi`, `multicall3Abi`, `permit2Abi`, `checkSponsorship`. The registry gained `kernelImplementation`, `kernelEcdsaSignerModule`, `kernelCallPolicyV004`, `kernelTimestampPolicy`, `tapScore`, `paymasterV1` and `paymasterV2` (pending).

### Behavior changes to know about

- `pepuContracts.multicall3` was always PEPU's own address. Code that hard-coded the canonical address `0xcA11bde05977b3631167028862bE2a173976CA11` was always wrong on PEPU. Use `pepuMulticall` or `getMulticall3`, which throws `MULTICALL3_CANONICAL_ADDRESS` rather than use it.
- Everything the SDK throws now carries a stable `code`. Replace string matching on messages with `error.code` or `explainError(e)`.
- Route factories (`createSessionRoutes`, `createSessionActionRoute`, `createSponsoredSessionRoutes`) answer `CONFIG_MISSING_ENV` as JSON at request time when the contract address is empty, instead of throwing at module load.

### Checklist

1. Upgrade: `npm install @pepu-chain/sdk@^0.2.4 viem`.
2. Replace `getSponsorshipStatus` and `useSponsorshipStatus` with `checkSponsorship` and `usePepuSponsorship`.
3. Install the optional peers for the subpaths you adopt (see the [peer table](reference.md#subpath-map-and-peer-dependencies)).
4. Swap hand-rolled infrastructure for the SDK function. Keep your code where the SDK has no equivalent.
5. Run the doctor: `runDoctor({ env: process.env })` from [/doctor](doctor.md).

## Related

- [Changelog](../reference/changelog.md)
- [SDK Overview and Reference](reference.md)
- [SDK Error Catalog](errors.md)
