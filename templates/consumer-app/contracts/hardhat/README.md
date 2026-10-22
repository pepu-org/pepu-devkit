# Hardhat path

```bash
npm install   # installs hardhat + toolbox, standalone from the repo root workspace
cp .env.example .env
# edit .env and set DEPLOYER_PRIVATE_KEY to a dev key with minimal funds

npx hardhat compile
```

## Deploy (mainnet — recommended, see root README for why)

```bash
npx hardhat run scripts/deploy.ts --network pepuMainnet
```

Swap `pepuMainnet` for `pepuTestnet` if you hold testnet PEPU (there is no
public faucet for it today).

## Verify

With the `sourcify` block already in `hardhat.config.ts`, Hardhat's
standard verify command runs against Conduit's Sourcify-compatible
service:

```bash
npx hardhat verify --network pepuMainnet <DEPLOYED_ADDRESS>
```

Then view it at `https://pepuscan.com/address/<DEPLOYED_ADDRESS>`.
