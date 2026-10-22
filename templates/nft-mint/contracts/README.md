# contracts/

`PepuNft` — a minimal ERC-721 with a public `mint()` — shipped twice, once
per toolchain, so this template serves developers on either one. Pick
whichever you already use; you don't need both.

- [`foundry/`](./foundry) — Foundry project (`forge`/`cast`).
- [`hardhat/`](./hardhat) — Hardhat + TypeScript project.

Both deploy the exact same contract, built on OpenZeppelin Contracts
v5.7.0's `ERC721` + `ERC721Enumerable` + `Ownable` (not hand-rolled —
those are the security-sensitive parts of an NFT contract and this
template inherits them from an audited implementation), to the same
chain, using the same RPC URLs and the same Sourcify-compatible
verification endpoint (`https://contracts.conduit.xyz`). Neither
subfolder is wired into the Next.js app's TypeScript project or build —
they're standalone.

**Important:** if you have
[`foundry-zksync`](https://github.com/matter-labs/foundry-zksync)
installed on the same machine, the `forge` on your `PATH` may resolve to
that fork instead of upstream Foundry. Pepe Unchained is an Arbitrum
Orbit/Nitro chain, not zkSync — the zkSync fork compiles and deploys
differently and is the wrong tool here. Run `forge --version` and confirm
it does not mention `zksync` before using the Foundry path.

## The contract, briefly

- `MAX_SUPPLY = 1000`, token ids starting at 1.
- `mint()` is `payable`; the deployer sets an initial `mintPrice` at
  construction (0 = free mint) and can change it later with
  `setMintPrice` (owner-only).
- `withdraw()` (owner-only) sweeps collected mint proceeds.
- Enumerable, so a wallet's owned token ids can be read with
  `balanceOf` + `tokenOfOwnerByIndex` — see the Next.js app's
  `components/owned-tokens.tsx`, which batches exactly that read via
  Multicall3.

This is a starting point, not a production launch contract — there's no
allowlist, no reveal mechanism, and no royalty standard (ERC-2981)
wired in. Add what your actual launch needs.

## Network parameters (both toolchains)

| | Mainnet (default) | Testnet |
|---|---|---|
| Chain ID | `97741` | `97740` |
| RPC URL | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` | `https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz` |
| Explorer | `https://pepuscan.com` | none indexed yet |

There is currently no public testnet faucet. Deploying to mainnet costs a
fraction of a cent in PEPU gas — see the root `README.md` for how to fund
a development wallet.
