import {
  type Address,
  type ContractFunctionParameters,
  type Hex,
  type MulticallReturnType,
  type PublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
} from "viem";

import { multicall3Abi } from "./abi/multicall3.js";
import { pepuMainnet } from "./chains.js";
import { type DeployedContract, getContract, isDeployed } from "./contracts.js";
import { PepuChainError } from "./errors.js";

/** The canonical Multicall3 address, which is NOT deployed on PEPU. */
export const CANONICAL_MULTICALL3_ADDRESS =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/**
 * Guard: throws `MULTICALL3_CANONICAL_ADDRESS` if `address` is the canonical
 * Multicall3 address (which has no code on PEPU).
 *
 * @example
 * ```ts
 * assertNotCanonicalMulticall3("0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd"); // ok
 * ```
 */
export function assertNotCanonicalMulticall3(address: Address): void {
  if (isAddressEqual(address, CANONICAL_MULTICALL3_ADDRESS)) {
    throw new PepuChainError("MULTICALL3_CANONICAL_ADDRESS");
  }
}

/**
 * The PEPU-specific Multicall3 registry entry. Never the canonical address.
 *
 * @example
 * ```ts
 * const { address } = getMulticall3(); // 0x9CE19273...01bd
 * ```
 */
export function getMulticall3(chainId: number = pepuMainnet.id): DeployedContract {
  const entry = getContract(chainId, "multicall3");
  if (!isDeployed(entry)) {
    throw new PepuChainError("UNKNOWN", "Multicall3 is not deployed on the requested chain.");
  }
  assertNotCanonicalMulticall3(entry.address);
  return entry;
}

/**
 * viem `multicall` pinned to the PEPU Multicall3 address.
 *
 * @example
 * ```ts
 * const [name, supply] = await pepuMulticall(client, [
 *   { address: token, abi: erc20Abi, functionName: "name" },
 *   { address: token, abi: erc20Abi, functionName: "totalSupply" },
 * ], { allowFailure: false });
 * ```
 */
export function pepuMulticall<
  const T extends readonly ContractFunctionParameters[],
  A extends boolean = true,
>(
  client: PublicClient,
  calls: T,
  o: { allowFailure?: A; blockNumber?: bigint } = {},
): Promise<MulticallReturnType<T, A>> {
  const chainId = client.chain?.id ?? pepuMainnet.id;
  const multicallAddress = getMulticall3(chainId).address;
  return client.multicall({
    contracts: calls,
    multicallAddress,
    allowFailure: o.allowFailure ?? true,
    ...(o.blockNumber !== undefined ? { blockNumber: o.blockNumber } : {}),
  } as never) as Promise<MulticallReturnType<T, A>>;
}

/**
 * ABI-encode a Multicall3 `aggregate3` call.
 *
 * @example
 * ```ts
 * const data = encodeAggregate3([{ target: token, callData: "0x18160ddd" }]);
 * ```
 */
export function encodeAggregate3(
  calls: readonly { target: Address; allowFailure?: boolean; callData: Hex }[],
): Hex {
  return encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [
      calls.map((c) => ({
        target: c.target,
        allowFailure: c.allowFailure ?? false,
        callData: c.callData,
      })),
    ],
  });
}

/**
 * Decode the return data of `aggregate3`.
 *
 * @example
 * ```ts
 * const results = decodeAggregate3Result(returnData);
 * results[0]?.success;
 * ```
 */
export function decodeAggregate3Result(data: Hex): { success: boolean; returnData: Hex }[] {
  const out = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data,
  });
  return out.map((r) => ({ success: r.success, returnData: r.returnData }));
}
