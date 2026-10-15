import { ethers } from "hardhat";

async function main() {
  const factory = await ethers.getContractFactory("TapScore");
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`TapScore deployed to: ${address}`);
  console.log(
    `\nSet this in your app's .env.local:\n  NEXT_PUBLIC_GAME_CONTRACT_ADDRESS=${address}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
