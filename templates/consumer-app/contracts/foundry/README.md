# Foundry path

Verified working against both Pepe Unchained V2 RPCs on upstream Foundry
`v1.5.1-stable`.

```bash
# Install Foundry if you don't have it
curl -L https://foundry.paradigm.xyz | bash
foundryup

# From this directory:
forge install         # only needed if you add dependencies under lib/
forge build
```

Confirm you're running upstream Foundry, not the zkSync fork (see
`../README.md`):

```bash
forge --version   # must NOT mention zksync
```

## Deploy (mainnet — recommended, see root README for why)

```bash
export PRIVATE_KEY=0xyourdevelopmentprivatekey   # a dev key only, never commit it

forge create src/Counter.sol:Counter \
  --rpc-url pepu_mainnet \
  --private-key $PRIVATE_KEY
```

Swap `pepu_mainnet` for `pepu_testnet` if you hold testnet PEPU (there is
no public faucet for it today).

## Verify

```bash
forge verify-contract \
  --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz \
  --verifier sourcify \
  --verifier-url https://contracts.conduit.xyz \
  <DEPLOYED_ADDRESS> \
  src/Counter.sol:Counter
```

Then view it at `https://pepuscan.com/address/<DEPLOYED_ADDRESS>`.
