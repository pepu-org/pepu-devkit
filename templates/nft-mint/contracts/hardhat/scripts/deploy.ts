import { ethers } from "hardhat";

/**
 * Reads deploy-time constructor args from the environment so the same
 * script works for a free mint (the default) or a paid one, and so the
 * metadata base URI isn't hardcoded here. See ../.env.example.
 */
const BASE_URI = process.env.BASE_URI ?? "";
const MINT_PRICE = process.env.MINT_PRICE ?? "0";

async function main() {
  if (!BASE_URI) {
    console.warn(
      "Warning: BASE_URI is empty — tokenURI() will resolve to just the token id with no base. Set BASE_URI in .env before deploying for real.",
    );
  }

  const PepuNft = await ethers.getContractFactory("PepuNft");
  const pepuNft = await PepuNft.deploy(BASE_URI, BigInt(MINT_PRICE));
  await pepuNft.waitForDeployment();
  console.log("PepuNft deployed to:", await pepuNft.getAddress());
  console.log("  baseURI:", BASE_URI || "(empty)");
  console.log("  mintPrice (wei):", MINT_PRICE);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
