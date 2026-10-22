/**
 * The TapScore ABI, the one contract this template's session may call. The
 * address is NOT defined here: it comes from the SDK's verified registry
 * (`lib/scope.ts`), because the on-chain session policy and the paymaster
 * allowlist both name it.
 */
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
