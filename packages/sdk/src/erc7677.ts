import { toHex } from "viem";
import type { Address, Hex } from "viem";

import { pepuMainnet } from "./chains.js";
import { getContract } from "./contracts.js";

/**
 * ERC-7677 paymaster web-service types, for the two JSON-RPC methods PEPU's
 * paymaster policy service implements: `pm_getPaymasterStubData` and
 * `pm_getPaymasterData`. See https://eips.ethereum.org/EIPS/eip-7677.
 *
 * Pure types plus a few tiny builders: no network, no secrets, safe in a
 * browser bundle. Quantities are `0x`-prefixed hex strings, as on the wire.
 *
 * Note this package never implies sponsorship is available to an app: see
 * `getSponsorshipStatus()`. These types describe the protocol only.
 */

/** An ERC-4337 v0.7 UserOperation in its unpacked JSON-RPC shape. */
export interface Erc7677UserOperation {
  sender: Address;
  nonce: Hex;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster?: Address;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
  paymasterData?: Hex;
  signature: Hex;
}

/** Paymaster-defined, JSON-serializable context (params[3]). */
export type PaymasterContext = Record<string, unknown>;

export type PaymasterRpcParams = readonly [
  userOperation: Partial<Erc7677UserOperation> & Pick<Erc7677UserOperation, "sender" | "callData">,
  entryPoint: Address,
  chainId: Hex,
  context?: PaymasterContext,
];

export interface PaymasterStubDataRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: "pm_getPaymasterStubData";
  params: PaymasterRpcParams;
}

export interface PaymasterDataRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: "pm_getPaymasterData";
  params: PaymasterRpcParams;
}

/** Result of `pm_getPaymasterStubData`. Stub values are for gas estimation only. */
export interface PaymasterStubDataResult {
  paymaster: Address;
  paymasterData: Hex;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
  /** `true` when the stub values are also the final values. */
  isFinal?: boolean;
  sponsor?: { name: string; icon?: string };
}

/** Result of `pm_getPaymasterData`: the signed values to submit. */
export interface PaymasterDataResult {
  paymaster: Address;
  paymasterData: Hex;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
}

export interface PaymasterRpcError {
  code: number;
  message: string;
  /** PEPU's policy service puts the machine-readable denial reason in `data.reason`. */
  data?: { reason?: string } & Record<string, unknown>;
}

export type PaymasterRpcResponse<TResult> =
  | { jsonrpc: "2.0"; id: number | string | null; result: TResult }
  | { jsonrpc: "2.0"; id: number | string | null; error: PaymasterRpcError };

/**
 * Build a paymaster `context` object: drops `undefined` entries and throws on
 * anything that would not survive `JSON.stringify` (bigint, function, symbol),
 * so a bad value fails here instead of as an opaque RPC error. Returns `{}`
 * for no input. The context is paymaster-defined; PEPU's policy service
 * currently accepts and ignores it.
 */
export function buildPaymasterContext(
  entries: Readonly<Record<string, unknown>> = {},
): PaymasterContext {
  const context: PaymasterContext = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    const kind = typeof value;
    if (kind === "bigint" || kind === "function" || kind === "symbol") {
      throw new Error(
        `buildPaymasterContext: "${key}" is a ${kind}, which is not JSON-serializable. Convert it to a string or number first.`,
      );
    }
    context[key] = value;
  }
  return context;
}

export interface BuildPaymasterRequestOptions {
  userOperation: PaymasterRpcParams[0];
  /** Defaults to PEPU mainnet's EntryPoint v0.7. */
  entryPoint?: Address;
  /** Defaults to 97741 (PEPU mainnet). */
  chainId?: number;
  context?: PaymasterContext;
  id?: number | string;
}

function buildParams(options: BuildPaymasterRequestOptions): PaymasterRpcParams {
  const entryPointEntry = getContract(pepuMainnet.id, "entryPoint07");
  const entryPoint =
    options.entryPoint ??
    (entryPointEntry?.status === "deployed" ? entryPointEntry.address : undefined);
  if (!entryPoint) throw new Error("buildPaymasterRequest: no EntryPoint v0.7 address available.");
  const chainId = toHex(options.chainId ?? pepuMainnet.id);
  return options.context
    ? [options.userOperation, entryPoint, chainId, options.context]
    : [options.userOperation, entryPoint, chainId];
}

/** Build a `pm_getPaymasterStubData` JSON-RPC request body. */
export function buildPaymasterStubDataRequest(
  options: BuildPaymasterRequestOptions,
): PaymasterStubDataRequest {
  return {
    jsonrpc: "2.0",
    id: options.id ?? 1,
    method: "pm_getPaymasterStubData",
    params: buildParams(options),
  };
}

/** Build a `pm_getPaymasterData` JSON-RPC request body. */
export function buildPaymasterDataRequest(
  options: BuildPaymasterRequestOptions,
): PaymasterDataRequest {
  return {
    jsonrpc: "2.0",
    id: options.id ?? 1,
    method: "pm_getPaymasterData",
    params: buildParams(options),
  };
}
