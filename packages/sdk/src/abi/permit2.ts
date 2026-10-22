import { parseAbi } from "viem";

/**
 * Canonical Permit2 ABI subset (AllowanceTransfer plus SignatureTransfer
 * nonce reads). For the canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3`
 * deployed on PEPU. NOT PepuSwap's separate deployment (see `pepuSwapPermit2Abi`).
 */
export const permit2Abi = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)",
  "function invalidateNonces(address token, address spender, uint48 newNonce)",
]);
