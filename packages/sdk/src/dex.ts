import type { ContractEntry } from "./contracts.js";
import { pepuMainnet } from "./chains.js";

/**
 * PepuSwap is PEPU's flagship DEX and a Uniswap V3 fork. This registry is
 * deliberately separate from {@link pepuContracts} in `contracts.ts`:
 * `pepuContracts` tracks *chain infrastructure* (things any app might rely
 * on — Multicall3, the AA stack), while this tracks *one specific
 * application's* deployment. Mixing the two would make `pepuContracts`
 * ambiguous about what counts as "the chain" versus "a dapp on the chain."
 *
 * Mainnet only — PepuSwap has no testnet deployment, and testnet (97740) is
 * out of scope for this package regardless (no faucet exists to fund
 * verification there).
 *
 * Every address below was independently verified on 2026-09-24 with both
 * an `eth_getCode` check (non-empty bytecode) and a successful `eth_call`
 * against a real function — see the doc comment on that contract's ABI file
 * in `./abi/` for the exact call and response. Two addresses
 * (`multicallNonCanonical`, `permit2NonCanonical`) are PepuSwap-specific
 * overrides of otherwise-canonical contracts; do not confuse them with
 * {@link pepuContracts}'s `multicall3`/`permit2` entries, which track the
 * *canonical* versions of those same standards.
 */
export type PepuSwapContractName =
  | "v3Factory"
  | "swapRouter02"
  | "universalRouter"
  | "positionManager"
  | "quoterV2"
  | "tickLens"
  | "v3Migrator"
  | "v3Staker"
  | "multicallNonCanonical"
  | "permit2NonCanonical";

const V3_FACTORY_NOTES =
  "Uniswap V3 core factory. owner() returns a live address; getPool() " +
  "resolves real WPEPU/USDT pools at multiple fee tiers, and those pools' " +
  "own token0()/token1() match. Four other PepuSwap contracts " +
  "(swapRouter02, positionManager, quoterV2, v3Migrator) each read their " +
  "own factory() immutable and all agree on this exact address.";

export const pepuSwapContracts: Readonly<
  Record<number, Readonly<Record<PepuSwapContractName, ContractEntry>>>
> = {
  [pepuMainnet.id]: {
    v3Factory: {
      status: "deployed",
      name: "PepuSwap V3 Factory",
      address: "0x5984B8BF2d4dB9C0aCB1d7924762e4474D80C807",
      notes: V3_FACTORY_NOTES,
    },
    swapRouter02: {
      status: "deployed",
      name: "PepuSwap SwapRouter02",
      address: "0x150c3F0f16C3D9EB34351d7af9c961FeDc97A0fb",
      notes:
        "factory() and WETH9() both resolve to the independently-verified " +
        "v3Factory/WPEPU addresses.",
    },
    universalRouter: {
      status: "deployed",
      name: "PepuSwap UniversalRouter",
      address: "0x0dE72b751b77d3c74fB96C5fAd0320Cd8d133d36",
      notes:
        "No public getters for its configured Permit2/factory addresses " +
        "(dispatcher contracts don't expose those). Verified instead by " +
        "simulating execute(\"0x\", [], farFutureDeadline) via eth_call, " +
        "which returned successfully under the exact UniversalRouter " +
        "selector.",
    },
    positionManager: {
      status: "deployed",
      name: "PepuSwap NonfungiblePositionManager",
      address: "0xe2060CbdE18b5e765c86e5Cd6EE68AF209a9faa7",
      notes:
        "factory() and WETH9() both resolve to the independently-verified " +
        "v3Factory/WPEPU addresses. LP positions are ERC-721 tokens minted " +
        "by this contract (pepuscan lists them as \"Launchpad V3 Positions " +
        "NFT\" / UNI-V3-POS).",
    },
    quoterV2: {
      status: "deployed",
      name: "PepuSwap QuoterV2",
      address: "0xd647b2D80b48e93613Aa6982b85f8909578b4829",
      notes:
        "factory() and WETH9() both resolve to the independently-verified " +
        "v3Factory/WPEPU addresses. Off-chain-quote contract — call via " +
        "eth_call/simulateContract only, never send it a real transaction.",
    },
    tickLens: {
      status: "deployed",
      name: "PepuSwap TickLens",
      address: "0x4EB8aA84c066f9bf210eAfE33B30AE49BfafD9a6",
      notes:
        "Stateless (no zero-arg getter to probe). Verified instead by " +
        "calling getPopulatedTicksInWord() against a real WPEPU/USDT pool " +
        "at that pool's own current tick-bitmap word; call succeeded.",
    },
    v3Migrator: {
      status: "deployed",
      name: "PepuSwap V3Migrator",
      address: "0xFE406d6c3fc0BB3a6D195b089eFADfc8658206D5",
      notes:
        "factory() and WETH9() both resolve to the independently-verified " +
        "v3Factory/WPEPU addresses. No dedicated ABI is shipped for this " +
        "contract in ./abi/ — only these two getters were checked, which " +
        "is enough to confirm the address but not enough to type its " +
        "migration-specific functions. Pair with Uniswap's public " +
        "V3Migrator ABI if you need those.",
    },
    v3Staker: {
      status: "deployed",
      name: "PepuSwap V3Staker",
      address: "0x0a875d1C72cb4e1CD61401c3C49f85Df45071f83",
      notes:
        "factory() resolves to the independently-verified v3Factory " +
        "address (this contract has no WETH9() getter — it's a Uniswap " +
        "LP incentive-staking contract, unrelated to the general \"stake " +
        "PEPU\" product). No dedicated ABI is shipped for it in ./abi/ — " +
        "pair with Uniswap's public V3Staker ABI if you need one.",
    },
    multicallNonCanonical: {
      status: "deployed",
      name: "PepuSwap Multicall (UniswapInterfaceMulticall, non-canonical)",
      address: "0x927af2a6B76d2d8206d93004463F8C122701383B",
      notes:
        "PepuSwap's own multicall contract, NOT Multicall3 and NOT " +
        "interchangeable with pepuContracts.multicall3. Verified on " +
        "pepuscan as Uniswap's UniswapInterfaceMulticall (a Multicall2 " +
        "fork with a different function set/return shape — see " +
        "pepuSwapMulticallAbi in ./abi/pepuSwapMulticall.js for the " +
        "verified ABI and exactly which functions were confirmed live).",
    },
    permit2NonCanonical: {
      status: "deployed",
      name: "PepuSwap Permit2 (non-canonical)",
      address: "0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B",
      notes:
        "PepuSwap's own Permit2 deployment, NOT at the canonical Permit2 " +
        "address and NOT interchangeable with pepuContracts.permit2 " +
        "(which tracks the canonical Permit2, now deployed on mainnet at " +
        "0x000000000022D473030F116dDEE9F6B43aC78BA3 — see ../contracts.js). " +
        "Both DOMAIN_SEPARATOR() calls respond live but return different " +
        "values (different EIP-712 domains, since they're different " +
        "contracts). See pepuSwapPermit2Abi in ./abi/pepuSwapPermit2.js.",
    },
  },
};

/** Look up one PepuSwap contract entry for a chain id. */
export function getPepuSwapContract(
  chainId: number,
  name: PepuSwapContractName,
): ContractEntry | undefined {
  return pepuSwapContracts[chainId]?.[name];
}

/** List every tracked PepuSwap contract entry for a chain id, in registry order. */
export function listPepuSwapContracts(
  chainId: number,
): readonly ContractEntry[] {
  const registry = pepuSwapContracts[chainId];
  return registry ? Object.values(registry) : [];
}

/** Narrow a {@link ContractEntry} to {@link DeployedContract} — re-exported for convenience so callers don't need to import both `./contracts.js` and `./dex.js` just to narrow a result. */
export { isDeployed } from "./contracts.js";
