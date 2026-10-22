// Build pepuscan links. See docs/recipes/explorer-links.md
import { addressUrl, blockUrl, explorerLinks, explorerUrl, pepuMainnet, tokenUrl, txUrl } from "@pepu-chain/sdk";
import type { SponsoredResult } from "@pepu-chain/sdk/aa";

export const single = {
  tx: (hash: string) => txUrl(pepuMainnet, hash),
  address: (a: string) => addressUrl(pepuMainnet, a),
  token: (a: string) => tokenUrl(pepuMainnet, a),
  block: (n: number) => blockUrl(pepuMainnet, n),
  generic: (hash: string) => explorerUrl(pepuMainnet, "tx", hash),
};

// A UserOperation has no page of its own on pepuscan: link its bundle transaction
// and its sender (the smart account).
export function userOpLinks(result: SponsoredResult, smartAccount: string) {
  return explorerLinks({ tx: result.transactionHash, sender: smartAccount });
}
