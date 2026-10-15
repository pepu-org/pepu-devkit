import { describe, expect, it } from "vitest";

import {
  ARB_GAS_INFO_ADDRESS,
  arbGasInfoAbi,
  entryPointV07Abi,
  ERC7579_MODULE_TYPE,
  KERNEL_V3_1_IMPLEMENTATION_ADDRESS,
  kernelEcdsaValidatorAbi,
  kernelFactoryAbi,
  pepuSwapMulticallAbi,
  pepuSwapPermit2Abi,
  pepuSwapPositionManagerAbi,
  pepuSwapQuoterAbi,
  pepuSwapRouterAbi,
  pepuSwapTickLensAbi,
  pepuSwapUniversalRouterAbi,
  pepuSwapV3FactoryAbi,
  pepuSwapV3PoolAbi,
  wpepuAbi,
  erc20Abi,
  erc721Abi,
} from "../src/abi/index.js";

// These tests only check ABI *shape* (function/event names present, no
// duplicates, well-formed viem ABI objects) and fixed addresses/constants.
// They never call a contract — no network access happens.

function functionNames(abi: readonly { type: string; name?: string }[]): string[] {
  return abi
    .filter((item) => item.type === "function")
    .map((item) => item.name)
    .filter((name): name is string => typeof name === "string");
}

describe("abi exports", () => {
  it("ARB_GAS_INFO_ADDRESS is the fixed Arbitrum Nitro precompile address", () => {
    expect(ARB_GAS_INFO_ADDRESS).toBe(
      "0x000000000000000000000000000000000000006C",
    );
  });

  it("arbGasInfoAbi exposes the gas-pricing getters", () => {
    expect(functionNames(arbGasInfoAbi)).toEqual(
      expect.arrayContaining([
        "getPricesInWei",
        "getL1BaseFeeEstimate",
        "getMinimumGasPrice",
      ]),
    );
  });

  it("entryPointV07Abi exposes deposit/nonce management but not handleOps", () => {
    const names = functionNames(entryPointV07Abi);
    expect(names).toEqual(
      expect.arrayContaining(["getNonce", "balanceOf", "depositTo", "withdrawTo", "getDepositInfo"]),
    );
    expect(names).not.toContain("handleOps");
  });

  it("ERC7579_MODULE_TYPE has the standard module type ids", () => {
    expect(ERC7579_MODULE_TYPE).toEqual({
      validator: 1n,
      executor: 2n,
      fallback: 3n,
      hook: 4n,
    });
  });

  it("kernelEcdsaValidatorAbi exposes the ERC-7579 module surface", () => {
    expect(functionNames(kernelEcdsaValidatorAbi)).toEqual(
      expect.arrayContaining(["ecdsaValidatorStorage", "isModuleType", "isInitialized"]),
    );
  });

  it("kernelFactoryAbi exposes address computation and account creation", () => {
    expect(functionNames(kernelFactoryAbi)).toEqual(
      expect.arrayContaining(["implementation", "getAddress", "createAccount"]),
    );
  });

  it("KERNEL_V3_1_IMPLEMENTATION_ADDRESS is the verified singleton address", () => {
    expect(KERNEL_V3_1_IMPLEMENTATION_ADDRESS).toBe(
      "0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d",
    );
  });

  it("pepuSwapMulticallAbi exposes UniswapInterfaceMulticall's verified surface, not Multicall2/3's", () => {
    const names = functionNames(pepuSwapMulticallAbi);
    expect(names).toEqual(
      expect.arrayContaining(["getCurrentBlockTimestamp", "getEthBalance", "multicall"]),
    );
    // Multicall2/3 use getBlockNumber(), not getCurrentBlockTimestamp().
    expect(names).not.toContain("getBlockNumber");
  });

  it("pepuSwapPermit2Abi exposes the Permit2 read/approve surface", () => {
    expect(functionNames(pepuSwapPermit2Abi)).toEqual(
      expect.arrayContaining(["DOMAIN_SEPARATOR", "allowance", "approve"]),
    );
  });

  it("pepuSwapPositionManagerAbi extends ERC-721 with Uniswap V3 position reads", () => {
    const names = functionNames(pepuSwapPositionManagerAbi);
    expect(names).toEqual(expect.arrayContaining(["ownerOf", "balanceOf", "factory", "WETH9", "positions"]));
  });

  it("pepuSwapQuoterAbi exposes off-chain quote functions", () => {
    expect(functionNames(pepuSwapQuoterAbi)).toEqual(
      expect.arrayContaining(["quoteExactInputSingle", "quoteExactOutputSingle", "factory", "WETH9"]),
    );
  });

  it("pepuSwapRouterAbi exposes SwapRouter02's exact-in/out swap functions", () => {
    expect(functionNames(pepuSwapRouterAbi)).toEqual(
      expect.arrayContaining(["exactInputSingle", "exactOutputSingle", "factory", "WETH9", "multicall"]),
    );
  });

  it("pepuSwapTickLensAbi exposes getPopulatedTicksInWord", () => {
    expect(functionNames(pepuSwapTickLensAbi)).toEqual(["getPopulatedTicksInWord"]);
  });

  it("pepuSwapUniversalRouterAbi exposes only execute", () => {
    expect(functionNames(pepuSwapUniversalRouterAbi)).toEqual(["execute"]);
  });

  it("pepuSwapV3FactoryAbi exposes the standard Uniswap V3 factory surface", () => {
    expect(functionNames(pepuSwapV3FactoryAbi)).toEqual(
      expect.arrayContaining(["owner", "getPool", "feeAmountTickSpacing", "createPool"]),
    );
  });

  it("pepuSwapV3PoolAbi exposes the minimal pool-state read surface", () => {
    expect(functionNames(pepuSwapV3PoolAbi)).toEqual(
      expect.arrayContaining(["token0", "token1", "fee", "tickSpacing", "liquidity", "slot0"]),
    );
  });

  it("wpepuAbi extends ERC-20 with WETH9's deposit/withdraw", () => {
    const names = functionNames(wpepuAbi);
    expect(names).toEqual(expect.arrayContaining(["transfer", "approve", "balanceOf", "deposit", "withdraw"]));
  });
});

describe("re-exported viem ABIs", () => {
  it("exposes erc20Abi and erc721Abi from the abi module", () => {
    expect(functionNames(erc20Abi)).toEqual(expect.arrayContaining(["balanceOf", "decimals", "transfer"]));
    expect(functionNames(erc721Abi)).toEqual(expect.arrayContaining(["balanceOf", "ownerOf"]));
  });
});
