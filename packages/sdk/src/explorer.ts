import { type PepuChain, pepuMainnet } from "./chains.js";

/** Resource types supported by Blockscout's URL scheme. */
export type ExplorerResourceType = "tx" | "address" | "token" | "block";

/**
 * Build a Blockscout explorer URL for a transaction hash, address, token
 * address, or block (by number or hash) on a Pepe Unchained V2 chain.
 *
 * Throws if the given chain has no `blockExplorers.default` configured
 * (this is currently the case for {@link pepuTestnet} — see `chains.ts`
 * for why).
 */
export function explorerUrl(
  chain: PepuChain,
  type: ExplorerResourceType,
  value: string | number,
): string {
  const explorer = chain.blockExplorers?.default;
  if (!explorer) {
    throw new Error(
      `explorerUrl: no block explorer is configured for chain "${chain.name}" (id ${chain.id}).`,
    );
  }
  return `${explorer.url}/${type}/${value}`;
}

/** Build a transaction-page URL. Shorthand for `explorerUrl(chain, "tx", hash)`. */
export function txUrl(chain: PepuChain, hash: string): string {
  return explorerUrl(chain, "tx", hash);
}

/** Build an address-page URL. Shorthand for `explorerUrl(chain, "address", address)`. */
export function addressUrl(chain: PepuChain, address: string): string {
  return explorerUrl(chain, "address", address);
}

/** Build a token-page URL. Shorthand for `explorerUrl(chain, "token", address)`. */
export function tokenUrl(chain: PepuChain, address: string): string {
  return explorerUrl(chain, "token", address);
}

/** Build a block-page URL, by block number or block hash. Shorthand for `explorerUrl(chain, "block", value)`. */
export function blockUrl(chain: PepuChain, blockNumberOrHash: string | number): string {
  return explorerUrl(chain, "block", blockNumberOrHash);
}

/**
 * Convenience bundle of explorer links. pepuscan (Blockscout) has no UserOp
 * pages, so a UserOperation is linked through its bundle `tx` and its
 * `sender` (the smart account address).
 *
 * @example
 * ```ts
 * explorerLinks({ tx: "0xabc", sender: "0xdef" });
 * // { tx: "https://pepuscan.com/tx/0xabc", sender: "https://pepuscan.com/address/0xdef" }
 * ```
 */
export function explorerLinks(
  o: {
    tx?: string;
    address?: string;
    sender?: string;
    token?: string;
    block?: bigint | number | string;
  },
  chain: PepuChain = pepuMainnet,
): { tx?: string; address?: string; sender?: string; token?: string; block?: string } {
  const out: { tx?: string; address?: string; sender?: string; token?: string; block?: string } = {};
  if (o.tx !== undefined) out.tx = txUrl(chain, o.tx);
  if (o.address !== undefined) out.address = addressUrl(chain, o.address);
  if (o.sender !== undefined) out.sender = addressUrl(chain, o.sender);
  if (o.token !== undefined) out.token = tokenUrl(chain, o.token);
  if (o.block !== undefined) out.block = blockUrl(chain, String(o.block));
  return out;
}
