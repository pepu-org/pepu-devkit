import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPublicClient, http, getAddress, parseAbi } from "viem";

function readEnvValue(path, key) {
  const contents = readFileSync(path, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const match = new RegExp(`^${key}=(.*)$`).exec(line);
    if (match) return match[1];
  }
  return undefined;
}

// services/paymaster/policy-service/ -> repo root is three levels up.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const CONDUIT_API_KEY = readEnvValue(`${REPO_ROOT}/.env`, "CONDUIT_API_KEY");
const RPC_URL = `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}`;

const PAYMASTER = getAddress("0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0");
const ENTRY_POINT_V07 = getAddress("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
const EXECUTOR = getAddress("0xF585840Cb46852223B1a8ecE23EA31Ef9656e60e");
const SIGNER = getAddress("0x106e6d6dB9f22AF147D27E7EFa3E7D6f5DeF2454");

const abi = parseAbi([
  "function isBundlerAllowed(address) view returns (bool)",
  "function signers(address) view returns (bool)",
]);

const entryPointAbi = parseAbi([
  "function getDepositInfo(address account) view returns (uint256 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)",
]);

const client = createPublicClient({ transport: http(RPC_URL) });

const bundlerAllowed = await client.readContract({ address: PAYMASTER, abi, functionName: "isBundlerAllowed", args: [EXECUTOR] });
console.log("isBundlerAllowed(executor", EXECUTOR, ") =", bundlerAllowed);

const signerRegistered = await client.readContract({ address: PAYMASTER, abi, functionName: "signers", args: [SIGNER] });
console.log("signers(", SIGNER, ") =", signerRegistered);

const depositInfo = await client.readContract({ address: ENTRY_POINT_V07, abi: entryPointAbi, functionName: "getDepositInfo", args: [PAYMASTER] });
console.log("deposit info:", depositInfo);
