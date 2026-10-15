import type { Abi, Address, Hex } from "viem";

/**
 * One call inside a (possibly batched) sponsored UserOperation. Give either
 * raw `data`, or `abi` plus `functionName` (plus `args`) and the SDK encodes it.
 */
export interface Call {
  to: Address;
  value?: bigint;
  data?: Hex;
  abi?: Abi;
  functionName?: string;
  args?: readonly unknown[];
}

/** What a sponsored send resolves to once the UserOperation is included. */
export interface SponsoredResult {
  /** `null` when the transport only exposes the bundle transaction (Privy Smart Wallets). */
  userOpHash: Hex | null;
  transactionHash: Hex;
  success: boolean;
  /** The paymaster the EntryPoint charged, or `null` when the account paid for itself. */
  paymaster: Address | null;
  actualGasCostWei: bigint;
  explorerUrl: string;
}
