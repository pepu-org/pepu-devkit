# Hardhat path

```bash
npm install   # installs hardhat + toolbox + @openzeppelin/contracts, standalone from the repo root workspace
cp .env.example .env
# edit .env: set DEPLOYER_PRIVATE_KEY (a dev key with minimal funds),
# BASE_URI (your metadata host), and MINT_PRICE (wei; 0 = free)

npx hardhat compile
```

## Deploy (mainnet — recommended, see root README for why)

```bash
npx hardhat run scripts/deploy.ts --network pepuMainnet
```

Swap `pepuMainnet` for `pepuTestnet` if you hold testnet PEPU (there is no
public faucet for it today).

Copy the deployed address into the Next.js app's `.env.local` as
`NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` (see `../../README.md`).

## Verify

With the `sourcify` block already in `hardhat.config.ts`, Hardhat's
standard verify command runs against Conduit's Sourcify-compatible
service:

```bash
npx hardhat verify --network pepuMainnet <DEPLOYED_ADDRESS> "$BASE_URI" $MINT_PRICE
```

Then view it at `https://pepuscan.com/address/<DEPLOYED_ADDRESS>`.
