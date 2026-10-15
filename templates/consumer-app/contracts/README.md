# contracts/

A trivial example contract, shipped twice — once per toolchain — so this
template serves developers on either one. Pick whichever you already use;
you don't need both.

- [`foundry/`](./foundry) — Foundry project (`forge`/`cast`). Verified
  working against both Pepe Unchained V2 RPCs on upstream Foundry
  `v1.5.1-stable`.
- [`hardhat/`](./hardhat) — Hardhat + TypeScript project.

Both deploy the exact same `Counter` contract to the same chain, using the
same RPC URLs and the same Sourcify-compatible verification endpoint
(`https://contracts.conduit.xyz`). Neither subfolder is wired into the
Next.js app's TypeScript project or build — they're standalone.

**Important:** if you have
[`foundry-zksync`](https://github.com/matter-labs/foundry-zksync)
installed on the same machine, the `forge` on your `PATH` may resolve to
that fork instead of upstream Foundry. Pepe Unchained is an Arbitrum
Orbit/Nitro chain, not zkSync — the zkSync fork compiles and deploys
differently and is the wrong tool here. Run `forge --version` and confirm
it does not mention `zksync` before using the Foundry path.

For the fully narrated version of both paths (build, deploy, verify, view
on pepuscan), see the "Quickstart: Zero to Deployed" page of the PEPU
developer docs, or just follow the commands in `foundry/README.md` /
`hardhat/README.md` below — they're the same steps.

## Network parameters (both toolchains)

| | Mainnet (default) | Testnet |
|---|---|---|
| Chain ID | `97741` | `97740` |
| RPC URL | `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz` | `https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz` |
| Explorer | `https://pepuscan.com` | none indexed yet |

There is currently no public testnet faucet. Deploying to mainnet costs a
fraction of a cent in PEPU gas — see the root `README.md` for how to fund
a development wallet.
