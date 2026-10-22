import { parseAbi } from "viem";

/**
 * PepuSwap's own Permit2 deployment, at
 * `0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B` on mainnet (see
 * `pepuSwapContracts.permit2` in `../dex.js`).
 *
 * **This is NOT the canonical Permit2** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`).
 * The canonical address is now also deployed on PEPU (see
 * `pepuContracts.permit2` in `../contracts.js`, `status: "deployed"`), but
 * PepuSwap's own frontend was built against this separate, earlier
 * deployment and overrides the canonical address specifically for chain
 * 97741 to point at this contract instead. The two are different contracts
 * with different EIP-712 domains — do not assume a generic
 * canonical-Permit2-aware tool (e.g. a library that hardcodes the canonical
 * address) will interoperate with PepuSwap using it; approvals made against
 * one are not visible to the other.
 *
 * Verified live against mainnet 2026-09-24:
 * - `eth_getCode` returns 18,306 bytes of bytecode.
 * - `DOMAIN_SEPARATOR()` returns a live 32-byte value without reverting —
 *   confirming this contract implements Permit2's standard EIP-712 domain
 *   separator getter, consistent with a genuine (if non-canonical) Permit2
 *   deployment.
 *
 * `allowance`/`approve`/`permit` are Permit2's standard signatures; not
 * separately simulated here (each needs a real token/owner/spender to
 * return a meaningful result). Kept intentionally minimal — this package
 * does not ship a full Permit2 ABI, only enough to recognize and read from
 * this specific deployment.
 */
export const pepuSwapPermit2Abi = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
