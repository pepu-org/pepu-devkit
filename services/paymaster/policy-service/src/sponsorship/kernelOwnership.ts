/**
 * Kernel v3.1 ownership (sender -> user), the missing half of the free-tier identity check.
 *
 * Privy's `getBySmartWalletAddress` only knows smart wallets that Privy itself created and linked. The PEPU SDK's
 * combo / session flow instead builds a ZeroDev Kernel v3.1 account (ECDSA root validator, owner = the user's Privy
 * EMBEDDED wallet, index 0), which Privy has never heard of. That account is still provably the user's: its address is
 * a pure function of (factory, ECDSA validator, owner, index), and the owner is read from Privy by user id.
 *
 * So a token user owns `sender` if `sender` equals the Kernel address derived from ANY of that user's own embedded
 * wallets. Nothing here trusts the request: the wallet list comes from Privy for the VERIFIED token's user id, and the
 * address comes from the trusted factory. A user cannot name an account they do not control, because deriving someone
 * else's Kernel address needs that person's embedded wallet address in THIS user's Privy record.
 *
 * Derivation is the factory's own `getAddress(initData, salt)` view (an eth_call, immutable result, cached forever),
 * with `initData` encoded exactly as `@zerodev/sdk` 5.5 does for a sudo-only ECDSA Kernel v3.1. A test pins the
 * encoding to a vector produced by the SDK against PEPU mainnet.
 */
import { encodeFunctionData, getAddress, isAddress, pad, parseAbi, toHex, concatHex, zeroAddress } from "viem";
import type { Address, Hex } from "viem";

/** Kernel v3.1 factory on PEPU mainnet (eth_getCode verified 2026-10-02, see packages/sdk/src/session/kernel.ts). */
export const DEFAULT_KERNEL_V31_FACTORY: Address = "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419";
/** ZeroDev ECDSA validator on PEPU mainnet. */
export const DEFAULT_KERNEL_ECDSA_VALIDATOR: Address = "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57";

const kernelInitializeAbi = parseAbi(["function initialize(bytes21 _rootValidator, address _hook, bytes validatorData, bytes hookData, bytes[] initConfig)"]);
const kernelFactoryAbi = parseAbi(["function getAddress(bytes data, bytes32 salt) view returns (address)"]);

/** `initialize(...)` calldata for a sudo-only ECDSA Kernel owned by `owner`. Byte-identical to ZeroDev SDK 5.5. */
export function kernelInitData(validator: Address, owner: Address): Hex {
  return encodeFunctionData({
    abi: kernelInitializeAbi,
    functionName: "initialize",
    // root validator id = VALIDATOR_TYPE.VALIDATOR (0x01) ++ validator address
    args: [concatHex(["0x01", validator]) as Hex, zeroAddress, owner, "0x", []],
  });
}

/** CREATE2 salt for Kernel account `index` (32-byte big-endian). */
export function kernelSalt(index: bigint): Hex {
  return pad(toHex(index), { size: 32 });
}

/** Reads the factory's `getAddress(data, salt)`. Injected so tests never touch a chain. */
export type KernelFactoryReader = (factory: Address, data: Hex, salt: Hex) => Promise<Address>;

export interface KernelAddressDeriverOptions {
  factory: Address;
  validator: Address;
  index: bigint;
  read: KernelFactoryReader;
}

/** owner (embedded wallet) -> counterfactual Kernel address. Results never change, so they are cached for the process. */
export function createKernelAddressDeriver(o: KernelAddressDeriverOptions): (owner: Address) => Promise<Address> {
  const cache = new Map<string, Address>();
  const salt = kernelSalt(o.index);
  return async (owner) => {
    if (!isAddress(owner)) throw new Error("owner is not an address");
    const key = owner.toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;
    const raw = await o.read(o.factory, kernelInitData(o.validator, getAddress(owner)), salt); // throws on RPC errors; NOT cached
    const derived = getAddress(raw);
    if (cache.size > 50_000) cache.clear();
    cache.set(key, derived);
    return derived;
  };
}

/** Production reader on a viem public client (structural, so this file imports no client constructor). */
export function viemKernelFactoryReader(client: { readContract(args: never): Promise<unknown> }): KernelFactoryReader {
  return async (factory, data, salt) => {
    const args = { address: factory, abi: kernelFactoryAbi, functionName: "getAddress", args: [data, salt] };
    return (await client.readContract(args as never)) as Address;
  };
}

