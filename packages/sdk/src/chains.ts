import { defineChain } from "viem";

/**
 * Pepe Unchained V2 — mainnet.
 *
 * Arbitrum Orbit / Nitro chain (ArbOS 51), hosted by Conduit, settling to
 * Ethereum L1 via AnyTrust. Verified against the live RPC endpoint.
 */
export const pepuMainnet = /*#__PURE__*/ defineChain({
  id: 97741,
  name: "Pepe Unchained V2",
  nativeCurrency: {
    name: "Pepe Unchained",
    symbol: "PEPU",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc-pepu-v2-mainnet-0.t.conduit.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "PepuScan",
      url: "https://pepuscan.com",
      apiUrl: "https://pepuscan.com/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd",
      blockCreated: 10521048,
    },
  },
  // IMPORTANT: that Multicall3 address is PEPU-specific and deliberately
  // NOT the canonical 0xcA11bde05977b3631167028862bE2a173976CA11.
  //
  // The canonical address is structurally unreachable on this chain: it
  // was created elsewhere by a pre-signed CREATE transaction carrying a
  // hardcoded 1,000,000 gas limit, and this Arbitrum Nitro chain needs
  // ~14.3M gas for the same bytecode, so that transaction can never
  // execute here. Conduit support confirmed there is no predeploy and
  // that deploying our own is the supported path.
  //
  // Ours was built from the canonical mds1/multicall3 source (solc
  // 0.8.12, optimizer 10,000,000 runs) and deployed through the CREATE2
  // deterministic deployer with a zero salt, so the address is
  // reproducible from the same inputs. It is verified on pepuscan, and
  // viem's `multicall` has been confirmed working against it.
  //
  // Never substitute the canonical address here — viem/wagmi would call
  // an address with no code and every batched read would fail.
  testnet: false,
});

/**
 * Pepe Unchained V2 — testnet.
 *
 * Same stack as mainnet; used for development and faucet-funded testing.
 */
export const pepuTestnet = /*#__PURE__*/ defineChain({
  id: 97740,
  name: "Pepe Unchained V2 Testnet",
  nativeCurrency: {
    name: "Pepe Unchained",
    symbol: "PEPU",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz"],
    },
  },
  // No `blockExplorers` entry: `pepuscan.com` is a Blockscout instance
  // registered against mainnet (chain 97741) specifically. Blockscout
  // instances index one chain each, so pointing the testnet definition at
  // the mainnet explorer would silently produce wrong/empty links for
  // testnet transactions and addresses. No verified Blockscout (or other)
  // explorer for chain 97740 was available at the time this package was
  // written. Add `blockExplorers.default` here once one is confirmed live.
  // See the mainnet definition above: Multicall3 is not deployed at the
  // canonical address on this chain either (no `contracts.multicall3`
  // here), and must not be faked with a placeholder.
  testnet: true,
});

/** All Pepe Unchained V2 chain definitions, mainnet first. */
export const pepuChains = [pepuMainnet, pepuTestnet] as const;

/** Union type of the two Pepe Unchained V2 chain definitions. */
export type PepuChain = (typeof pepuChains)[number];

/** The chain ids this package knows about — {@link pepuMainnet}'s and {@link pepuTestnet}'s. */
export type PepuChainId = PepuChain["id"];

/**
 * Type guard: is `chainId` one of PEPU's chain ids (mainnet `97741` or
 * testnet `97740`)? Narrows `number` to {@link PepuChainId}, so a caller can
 * use it to guard which chain-specific helper (`getContract`,
 * `explorerUrl`, etc.) is safe to call without re-deriving the id list by
 * hand each time.
 */
export function isPepuChain(chainId: number): chainId is PepuChainId {
  return pepuChains.some((chain) => chain.id === chainId);
}
