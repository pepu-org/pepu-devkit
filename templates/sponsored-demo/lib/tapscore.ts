import { getContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";

/**
 * TapScore, the one contract this demo is allowed to sponsor a call to.
 * Same deployed contract and ABI as the `game-app` and `sponsored-session-app`
 * templates; the ABI is duplicated here (not imported) because each PEPU
 * template is self-contained once scaffolded.
 *
 * The address comes from the SDK's contract registry (`getContract`, verified
 * on chain 97741 with `eth_getCode`), not from an env var: it must match BOTH
 * the paymaster operator's global destination allowlist AND your app's
 * registered `allowedDestinations` for the policy service to ever approve a
 * sponsored call here. An env var a developer could silently change would
 * just turn into an opaque `destination_not_globally_allowed` /
 * `destination_not_allowed_for_app` denial instead of a config that's
 * visibly wrong.
 */
const entry = getContract(pepuMainnet.id, "tapScore");
if (!isDeployed(entry)) throw new Error("TapScore is not deployed on this chain in the SDK registry.");

export const TAPSCORE_ADDRESS = entry.address;

export const tapScoreAbi = [
  {
    type: "function",
    name: "tap",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "scores",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Tapped",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "newScore", type: "uint256", indexed: false },
    ],
  },
] as const;
