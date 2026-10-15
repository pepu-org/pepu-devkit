import { parseAbi } from "viem";

/**
 * Minimal Multicall3 ABI (aggregate3 plus the common read helpers). Same
 * interface as canonical mds1/multicall3; on PEPU it lives at the
 * PEPU-specific `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd`, never at the
 * canonical `0xcA11...CA11`.
 */
export const multicall3Abi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getChainId() view returns (uint256)",
]);
