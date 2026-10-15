import type { Address, PublicClient, TypedDataDomain } from "viem";

import { permit2Abi } from "./abi/permit2.js";
import { pepuMainnet } from "./chains.js";
import { type DeployedContract, getContract, isDeployed } from "./contracts.js";
import { PepuChainError } from "./errors.js";

/**
 * The canonical Permit2 registry entry (`0x000000000022D473...78BA3`).
 *
 * @example
 * ```ts
 * const { address } = getPermit2();
 * ```
 */
export function getPermit2(chainId: number = pepuMainnet.id): DeployedContract {
  const entry = getContract(chainId, "permit2");
  if (!isDeployed(entry)) {
    throw new PepuChainError("UNKNOWN", "Permit2 is not deployed on the requested chain.");
  }
  return entry;
}

/**
 * EIP-712 domain for canonical Permit2: name "Permit2" (no version).
 *
 * @example
 * ```ts
 * const domain = permit2Domain(); // { name: "Permit2", chainId: 97741, verifyingContract }
 * ```
 */
export function permit2Domain(chainId: number = pepuMainnet.id): TypedDataDomain {
  return {
    name: "Permit2",
    chainId,
    verifyingContract: getPermit2(chainId).address,
  };
}

/** Typed-data definition accepted by viem `signTypedData`. */
export interface Permit2TypedData<P extends string, M extends Record<string, unknown>> {
  domain: TypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: P;
  message: M;
}

/**
 * Typed data for Permit2 AllowanceTransfer `PermitSingle`.
 *
 * @example
 * ```ts
 * const td = buildPermitSingleTypedData({ token, amount: 1n, expiration: 1900000000, nonce: 0, spender, sigDeadline: 1900000000n });
 * ```
 */
export function buildPermitSingleTypedData(p: {
  token: Address;
  amount: bigint;
  expiration: number;
  nonce: number;
  spender: Address;
  sigDeadline: bigint;
  chainId?: number;
}): Permit2TypedData<
  "PermitSingle",
  {
    details: { token: Address; amount: bigint; expiration: number; nonce: number };
    spender: Address;
    sigDeadline: bigint;
  }
> {
  return {
    domain: permit2Domain(p.chainId),
    types: {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    primaryType: "PermitSingle",
    message: {
      details: {
        token: p.token,
        amount: p.amount,
        expiration: p.expiration,
        nonce: p.nonce,
      },
      spender: p.spender,
      sigDeadline: p.sigDeadline,
    },
  };
}

/**
 * Typed data for Permit2 SignatureTransfer `PermitTransferFrom`.
 *
 * @example
 * ```ts
 * const td = buildPermitTransferFromTypedData({ token, amount: 1n, spender, nonce: 0n, deadline: 1900000000n });
 * ```
 */
export function buildPermitTransferFromTypedData(p: {
  token: Address;
  amount: bigint;
  spender: Address;
  nonce: bigint;
  deadline: bigint;
  chainId?: number;
}): Permit2TypedData<
  "PermitTransferFrom",
  {
    permitted: { token: Address; amount: bigint };
    spender: Address;
    nonce: bigint;
    deadline: bigint;
  }
> {
  return {
    domain: permit2Domain(p.chainId),
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "PermitTransferFrom",
    message: {
      permitted: { token: p.token, amount: p.amount },
      spender: p.spender,
      nonce: p.nonce,
      deadline: p.deadline,
    },
  };
}

/**
 * Read the Permit2 AllowanceTransfer allowance for (owner, token, spender).
 *
 * @example
 * ```ts
 * const { amount, expiration, nonce } = await readPermit2Allowance(client, { owner, token, spender });
 * ```
 */
export async function readPermit2Allowance(
  client: PublicClient,
  o: { owner: Address; token: Address; spender: Address },
): Promise<{ amount: bigint; expiration: number; nonce: number }> {
  const [amount, expiration, nonce] = await client.readContract({
    address: getPermit2(client.chain?.id ?? pepuMainnet.id).address,
    abi: permit2Abi,
    functionName: "allowance",
    args: [o.owner, o.token, o.spender],
  });
  return { amount, expiration, nonce };
}
