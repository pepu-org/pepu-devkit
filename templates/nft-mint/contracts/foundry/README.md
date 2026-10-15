# Foundry path

```bash
# Install Foundry if you don't have it
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Confirm you're running upstream Foundry, not the zkSync fork (see
`../README.md` — Pepe Unchained is an Arbitrum Orbit/Nitro chain, not
zkSync):

```bash
forge --version   # must NOT mention zksync
```

## Install OpenZeppelin Contracts

`PepuNft.sol` imports OpenZeppelin's `ERC721`, `ERC721Enumerable`, and
`Ownable`. Pin the exact version this template was written against
(v5.7.0) rather than tracking a moving branch:

```bash
# From this directory:
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-commit
```

This places the library under `lib/openzeppelin-contracts` (gitignored —
see `../../.gitignore`). `foundry.toml` already has the matching
remapping (`@openzeppelin/=lib/openzeppelin-contracts/`), so no further
config is needed.

```bash
forge build
```

## Deploy (mainnet — recommended, see root README for why)

```bash
export PRIVATE_KEY=0xyourdevelopmentprivatekey   # a dev key only, never commit it
export BASE_URI="https://your-metadata-host.example/"   # trailing slash; token ids get appended
export MINT_PRICE=0   # in wei; 0 = free mint

forge create src/PepuNft.sol:PepuNft \
  --rpc-url pepu_mainnet \
  --private-key $PRIVATE_KEY \
  --constructor-args "$BASE_URI" $MINT_PRICE
```

Swap `pepu_mainnet` for `pepu_testnet` if you hold testnet PEPU (there is
no public faucet for it today).

Copy the deployed address into the Next.js app's `.env.local` as
`NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` (see `../../README.md`).

## Verify

```bash
forge verify-contract \
  --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz \
  --verifier sourcify \
  --verifier-url https://contracts.conduit.xyz \
  <DEPLOYED_ADDRESS> \
  src/PepuNft.sol:PepuNft \
  --constructor-args $(cast abi-encode "constructor(string,uint256)" "$BASE_URI" $MINT_PRICE)
```

Then view it at `https://pepuscan.com/address/<DEPLOYED_ADDRESS>`.
