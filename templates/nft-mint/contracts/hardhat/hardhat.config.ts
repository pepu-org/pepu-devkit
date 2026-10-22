import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    pepuMainnet: {
      url: "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz",
      chainId: 97741,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
    pepuTestnet: {
      url: "https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz",
      chainId: 97740,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://contracts.conduit.xyz",
    browserUrl: "https://pepuscan.com",
  },
};

export default config;
