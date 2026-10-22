// Shared by the pillar snippets: the TapScore ABI and its registry address.
// TapScore is the sample contract live on PEPU mainnet; the address comes from
// the SDK registry, never a literal.
import { getContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";
import type { Abi, AbiFunction } from "viem";

export const tapScoreAbi = [
  { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "scores",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

/** The one function a session may call, as an ABI function fragment. */
export const tapFunction: AbiFunction = tapScoreAbi[0];

const entry = getContract(pepuMainnet.id, "tapScore");
if (!isDeployed(entry)) throw new Error("TapScore is not deployed on this chain in the SDK registry");

export const TAPSCORE_ADDRESS = entry.address;
