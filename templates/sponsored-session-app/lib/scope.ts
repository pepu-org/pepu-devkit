import { getContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";
import type { KernelSessionCall } from "@pepu-chain/sdk/session/kernel";
import { tapScoreAbi } from "./tapscore";

/**
 * THE scope of every session this app grants: one function (`tap()`) on one
 * contract (TapScore), value 0. The server routes (`lib/session-routes.ts`)
 * and the browser hook (`components/session-flow.tsx`) both import this, so the
 * policy the user signs and the one the server issued cannot drift.
 *
 * The target address comes from the SDK's registry (`getContract`, verified on
 * chain 97741 with `eth_getCode`), not from an env var: a silently changed
 * address would change what users consent to, and the paymaster only sponsors
 * allowlisted destinations.
 */
const entry = getContract(pepuMainnet.id, "tapScore");
if (!isDeployed(entry)) throw new Error("TapScore is not deployed on this chain in the SDK registry.");

export const TAPSCORE_ADDRESS = entry.address;

export const scope: { calls: readonly KernelSessionCall[] } = {
  calls: [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }],
};
