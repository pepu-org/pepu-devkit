import type { Abi, AbiFunction, Address } from "viem";
import { isAddress } from "viem";
import { describeSessionScope } from "@pepu-chain/sdk/session";

/**
 * The TapScore game contract (see `contracts/foundry/src/TapScore.sol` and
 * `contracts/hardhat/contracts/TapScore.sol`, the same contract for both
 * toolchains). Read by the client (`useReadContract`) and the server (the
 * session routes), and the single place the session scope is defined.
 */
export const tapScoreAbi = [
  { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] },
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
] as const satisfies Abi;

/**
 * The ONE function a session may call. `tap()` being non-payable is what
 * makes the zero-value condition in the policy meaningful: do not make
 * gameplay functions payable. To add a gameplay function, add its ABI
 * fragment here and to `sessionScope.functions`; `buildSessionPolicy` adds a
 * matching rule.
 */
export const tapFunction: AbiFunction = tapScoreAbi[0];

/** The game contract address, public by nature (the policy names it explicitly). */
export const gameContractAddress = process.env.NEXT_PUBLIC_GAME_CONTRACT_ADDRESS?.trim() ?? "";
export const hasGameContractAddress = isAddress(gameContractAddress, { strict: false });

/**
 * The session scope: this contract, these functions. Everything else (the
 * policy, the consent screen's contract/function rows, the tap route's
 * allow-list) is derived from it by `@pepu-chain/sdk/session*`.
 */
export const sessionScope: { contractAddress: Address; functions: readonly AbiFunction[] } = {
  contractAddress: gameContractAddress as Address,
  functions: [tapFunction],
};

/**
 * Consent-screen data for the scope (contract, `tap()` signature, selector,
 * zero value). The expiry is decided server-side, so none is shown from here.
 */
export function describeGameScope() {
  return describeSessionScope({ ...sessionScope, expiresAtUnixSeconds: Math.floor(Date.now() / 1000) });
}
