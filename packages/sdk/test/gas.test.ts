import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
} from "viem";
import { describe, expect, it } from "vitest";

import { ARB_GAS_INFO_ADDRESS, arbGasInfoAbi } from "../src/abi/arbGasInfo.js";
import { pepuMainnet } from "../src/chains.js";
import {
  DEFAULT_MAX_SEND_MARGIN_BPS,
  estimateTransactionCost,
  explainDualFeeModel,
  formatPepu,
  formatUnitsCompact,
  formatPepuGasPrice,
  getNitroFeeBreakdown,
  maxSendableAmount,
} from "../src/gas.js";

// All network access is faked via a viem `custom` transport whose `request`
// handler decodes the call and returns a hand-encoded response — no fetch,
// no real RPC, ever happens in this file.

type PricesInWei = readonly [bigint, bigint, bigint, bigint, bigint, bigint];

const LIVE_PRICES: PricesInWei = [
  0n,
  0n,
  250_000_000_000_000_000n,
  12_500_000_000_000n,
  0n,
  12_500_000_000_000n,
];

function makeMockClient(
  overrides: {
    pricesInWei?: PricesInWei;
    l1BaseFeeEstimateWei?: bigint;
    estimateGasResult?: bigint;
  } = {},
) {
  const pricesInWei = overrides.pricesInWei ?? LIVE_PRICES;
  const l1BaseFeeEstimateWei = overrides.l1BaseFeeEstimateWei ?? 0n;
  const estimateGasResult = overrides.estimateGasResult ?? 21_000n;

  return createPublicClient({
    chain: pepuMainnet,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown[] }) {
        if (method === "eth_call") {
          const call = (params as [{ to: string; data: `0x${string}` }])[0];
          const { functionName } = decodeFunctionData({
            abi: arbGasInfoAbi,
            data: call.data,
          });
          if (functionName === "getPricesInWei") {
            return encodeFunctionResult({
              abi: arbGasInfoAbi,
              functionName: "getPricesInWei",
              result: pricesInWei,
            });
          }
          if (functionName === "getL1BaseFeeEstimate") {
            return encodeFunctionResult({
              abi: arbGasInfoAbi,
              functionName: "getL1BaseFeeEstimate",
              result: l1BaseFeeEstimateWei,
            });
          }
          throw new Error(`test mock: unexpected eth_call function ${functionName}`);
        }
        if (method === "eth_estimateGas") {
          return `0x${estimateGasResult.toString(16)}`;
        }
        throw new Error(`test mock: unexpected RPC method ${method}`);
      },
    }),
  });
}

describe("getNitroFeeBreakdown", () => {
  it("reads and maps ArbGasInfo's getPricesInWei/getL1BaseFeeEstimate", async () => {
    const client = makeMockClient();
    const breakdown = await getNitroFeeBreakdown(client);
    expect(breakdown).toEqual({
      l2PricePerGasWei: 12_500_000_000_000n,
      l1PricePerCalldataUnitWei: 0n,
      l1BaseFeeEstimateWei: 0n,
    });
  });

  it("reflects a non-zero L1 data fee if the chain ever charges one", async () => {
    const client = makeMockClient({
      pricesInWei: [0n, 5n, 250_000_000_000_000_000n, 12_500_000_000_000n, 100n, 12_500_100_000_000n],
      l1BaseFeeEstimateWei: 1_000_000_000n,
    });
    const breakdown = await getNitroFeeBreakdown(client);
    expect(breakdown.l1PricePerCalldataUnitWei).toBe(5n);
    expect(breakdown.l1BaseFeeEstimateWei).toBe(1_000_000_000n);
    expect(breakdown.l2PricePerGasWei).toBe(12_500_100_000_000n);
  });
});

describe("estimateTransactionCost", () => {
  it("multiplies estimated gas by the current L2 price", async () => {
    const client = makeMockClient({ estimateGasResult: 21_000n });
    const estimate = await estimateTransactionCost(client, {
      to: "0x0000000000000000000000000000000000000000",
      value: 0n,
    });
    expect(estimate.gas).toBe(21_000n);
    expect(estimate.gasPriceWei).toBe(12_500_000_000_000n);
    expect(estimate.costWei).toBe(21_000n * 12_500_000_000_000n);
    expect(estimate.costFormatted).toBe(formatPepu(21_000n * 12_500_000_000_000n));
  });
});

describe("explainDualFeeModel", () => {
  it("returns a static, non-empty explanation with no network call", () => {
    const explanation = explainDualFeeModel();
    expect(explanation.summary.length).toBeGreaterThan(0);
    expect(explanation.l2ExecutionFee.length).toBeGreaterThan(0);
    expect(explanation.l1DataPostingFee.length).toBeGreaterThan(0);
    expect(explanation.pepuStatus.length).toBeGreaterThan(0);
  });

  it("mentions the verified 12,500 gwei baseline and the zero L1 fee", () => {
    const explanation = explainDualFeeModel();
    expect(explanation.l2ExecutionFee).toMatch(/12,500 gwei/);
    expect(explanation.l1DataPostingFee).toMatch(/\b0\b/);
  });
});

describe("formatPepu", () => {
  it("formats a whole-number PEPU amount", () => {
    expect(formatPepu(1_000_000_000_000_000_000n)).toBe("1 PEPU");
  });

  it("does not collapse a small-but-real amount to zero, unlike a 4-decimal ETH-style formatter", () => {
    // 0.00000001 PEPU = 1e10 wei
    const result = formatPepu(10_000_000_000n);
    expect(result).not.toBe("0 PEPU");
    expect(result).toBe("0.00000001 PEPU");
  });

  it("truncates to maxDecimals rather than showing every decimal", () => {
    // 1.23456789123456789 PEPU
    const wei = 1_234_567_891_234_567_890n;
    expect(formatPepu(wei, { maxDecimals: 4 })).toBe("1.2345 PEPU");
  });

  it("handles zero", () => {
    expect(formatPepu(0n)).toBe("0 PEPU");
  });

  it("handles negative amounts", () => {
    expect(formatPepu(-1_000_000_000_000_000_000n)).toBe("-1 PEPU");
  });

  it("omits the suffix when asked", () => {
    expect(formatPepu(1_000_000_000_000_000_000n, { suffix: false })).toBe("1");
  });
});

describe("formatPepuGasPrice", () => {
  it("formats the verified PEPU baseline with context, not a bare number", () => {
    const result = formatPepuGasPrice(12_500_000_000_000n);
    expect(result).toMatch(/^12500 gwei\/gas/);
    expect(result).toMatch(/not a congestion spike/i);
  });
});

describe("maxSendableAmount", () => {
  const FROM = "0x1111111111111111111111111111111111111111" as const;
  const TO = "0x2222222222222222222222222222222222222222" as const;

  // 21,000 gas * 12,500,000,000,000 wei/gas (LIVE_PRICES' l2 price above).
  const RAW_COST_WEI = 21_000n * 12_500_000_000_000n; // 262,500,000,000,000,000n
  const DEFAULT_MARGIN_WEI = (RAW_COST_WEI * BigInt(DEFAULT_MAX_SEND_MARGIN_BPS)) / 10_000n;
  const DEFAULT_TOTAL_RESERVED_WEI = RAW_COST_WEI + DEFAULT_MARGIN_WEI;

  it("returns zero-balance and never touches the network when balance is 0", async () => {
    const client = createPublicClient({
      chain: pepuMainnet,
      transport: custom({
        async request() {
          throw new Error("network should never be called for a zero balance");
        },
      }),
    });

    const result = await maxSendableAmount({
      client,
      from: FROM,
      to: TO,
      balanceWei: 0n,
    });

    expect(result).toEqual({
      status: "zero-balance",
      reason: expect.stringContaining("no PEPU to send"),
    });
  });

  it("also treats a negative balance as zero-balance (defensive, should not happen in practice)", async () => {
    const client = makeMockClient();
    const result = await maxSendableAmount({ client, from: FROM, balanceWei: -1n });
    expect(result.status).toBe("zero-balance");
  });

  it("estimates against `to` when provided, using a nominal 1-wei value (not the real balance)", async () => {
    const seen: { to: string | undefined; value: string | undefined; account: string | undefined }[] = [];
    const client = createPublicClient({
      chain: pepuMainnet,
      transport: custom({
        async request({ method, params }: { method: string; params?: unknown[] }) {
          if (method === "eth_call") {
            const call = (params as [{ to: string; data: `0x${string}` }])[0];
            const { functionName } = decodeFunctionData({ abi: arbGasInfoAbi, data: call.data });
            if (functionName === "getPricesInWei") {
              return encodeFunctionResult({ abi: arbGasInfoAbi, functionName, result: LIVE_PRICES });
            }
            if (functionName === "getL1BaseFeeEstimate") {
              return encodeFunctionResult({ abi: arbGasInfoAbi, functionName, result: 0n });
            }
            throw new Error(`unexpected eth_call function ${functionName}`);
          }
          if (method === "eth_estimateGas") {
            const call = params?.[0] as { to?: string; value?: string; from?: string };
            seen.push({ to: call.to, value: call.value, account: call.from });
            return "0x5208"; // 21_000
          }
          throw new Error(`unexpected RPC method ${method}`);
        },
      }),
    });

    // Balance far above the reserved amount so this resolves "ok".
    const result = await maxSendableAmount({
      client,
      from: FROM,
      to: TO,
      balanceWei: 10_000_000_000_000_000_000n,
    });

    expect(result.status).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.to?.toLowerCase()).toBe(TO.toLowerCase());
    expect(seen[0]?.value).toBe("0x1"); // nominal placeholder, never the real balance
  });

  it("falls back to a self-transfer (to: from) when `to` is omitted", async () => {
    const seen: { to: string | undefined }[] = [];
    const client = createPublicClient({
      chain: pepuMainnet,
      transport: custom({
        async request({ method, params }: { method: string; params?: unknown[] }) {
          if (method === "eth_call") {
            const call = (params as [{ to: string; data: `0x${string}` }])[0];
            const { functionName } = decodeFunctionData({ abi: arbGasInfoAbi, data: call.data });
            if (functionName === "getPricesInWei") {
              return encodeFunctionResult({ abi: arbGasInfoAbi, functionName, result: LIVE_PRICES });
            }
            return encodeFunctionResult({ abi: arbGasInfoAbi, functionName: "getL1BaseFeeEstimate", result: 0n });
          }
          if (method === "eth_estimateGas") {
            const call = params?.[0] as { to?: string };
            seen.push({ to: call.to });
            return "0x5208";
          }
          throw new Error(`unexpected RPC method ${method}`);
        },
      }),
    });

    await maxSendableAmount({ client, from: FROM, balanceWei: 10_000_000_000_000_000_000n });

    expect(seen[0]?.to?.toLowerCase()).toBe(FROM.toLowerCase());
  });

  it("returns insufficient-for-gas when balance exactly equals the reserved amount (no dust left)", async () => {
    const client = makeMockClient({ estimateGasResult: 21_000n });
    const result = await maxSendableAmount({
      client,
      from: FROM,
      to: TO,
      balanceWei: DEFAULT_TOTAL_RESERVED_WEI,
    });

    expect(result.status).toBe("insufficient-for-gas");
    if (result.status === "insufficient-for-gas") {
      expect(result.totalReservedWei).toBe(DEFAULT_TOTAL_RESERVED_WEI);
      expect(result.reason).toContain("Add more PEPU");
    }
  });

  it("returns insufficient-for-gas when balance is 1 wei short of covering gas + margin", async () => {
    const client = makeMockClient({ estimateGasResult: 21_000n });
    const result = await maxSendableAmount({
      client,
      from: FROM,
      to: TO,
      balanceWei: DEFAULT_TOTAL_RESERVED_WEI - 1n,
    });
    expect(result.status).toBe("insufficient-for-gas");
  });

  it("returns ok with a positive, never-negative amount once balance clears the reserved amount", async () => {
    const client = makeMockClient({ estimateGasResult: 21_000n });
    const balanceWei = DEFAULT_TOTAL_RESERVED_WEI + 1n;

    const result = await maxSendableAmount({ client, from: FROM, to: TO, balanceWei });

    expect(result).toEqual({
      status: "ok",
      amountWei: 1n,
      estimate: {
        gas: 21_000n,
        gasPriceWei: 12_500_000_000_000n,
        costWei: RAW_COST_WEI,
        costFormatted: formatPepu(RAW_COST_WEI),
      },
      marginWei: DEFAULT_MARGIN_WEI,
      totalReservedWei: DEFAULT_TOTAL_RESERVED_WEI,
    });
  });

  it("amountWei + totalReservedWei always reconstructs the original balance", async () => {
    const client = makeMockClient({ estimateGasResult: 21_000n });
    const balanceWei = 5_000_000_000_000_000_000n; // 5 PEPU
    const result = await maxSendableAmount({ client, from: FROM, to: TO, balanceWei });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.amountWei + result.totalReservedWei).toBe(balanceWei);
      expect(result.amountWei).toBeGreaterThan(0n);
    }
  });

  it("honors a custom marginBps (0 means no margin — cost only)", async () => {
    const client = makeMockClient({ estimateGasResult: 21_000n });
    const balanceWei = RAW_COST_WEI + 1n;

    const result = await maxSendableAmount({
      client,
      from: FROM,
      to: TO,
      balanceWei,
      marginBps: 0,
    });

    expect(result).toMatchObject({ status: "ok", amountWei: 1n, marginWei: 0n, totalReservedWei: RAW_COST_WEI });
  });

  it("rejects an out-of-range marginBps before touching the network", async () => {
    const client = createPublicClient({
      chain: pepuMainnet,
      transport: custom({
        async request() {
          throw new Error("network should never be called for an invalid marginBps");
        },
      }),
    });

    await expect(
      maxSendableAmount({ client, from: FROM, to: TO, balanceWei: 1_000n, marginBps: -1 }),
    ).rejects.toThrow(/marginBps/);
    await expect(
      maxSendableAmount({ client, from: FROM, to: TO, balanceWei: 1_000n, marginBps: 10_001 }),
    ).rejects.toThrow(/marginBps/);
    await expect(
      maxSendableAmount({ client, from: FROM, to: TO, balanceWei: 1_000n, marginBps: 1.5 }),
    ).rejects.toThrow(/marginBps/);
  });

  it("propagates an estimateGas failure instead of silently falling back to a guess", async () => {
    const client = createPublicClient({
      chain: pepuMainnet,
      transport: custom({
        async request({ method, params }: { method: string; params?: unknown[] }) {
          if (method === "eth_call") {
            const call = (params as [{ to: string; data: `0x${string}` }])[0];
            const { functionName } = decodeFunctionData({ abi: arbGasInfoAbi, data: call.data });
            if (functionName === "getPricesInWei") {
              return encodeFunctionResult({ abi: arbGasInfoAbi, functionName, result: LIVE_PRICES });
            }
            return encodeFunctionResult({ abi: arbGasInfoAbi, functionName: "getL1BaseFeeEstimate", result: 0n });
          }
          if (method === "eth_estimateGas") {
            throw new Error("execution reverted: recipient rejected the transfer");
          }
          throw new Error(`unexpected RPC method ${method}`);
        },
      }, { retryCount: 0 }),
    });

    await expect(
      maxSendableAmount({ client, from: FROM, to: TO, balanceWei: 10_000_000_000_000_000_000n }),
    ).rejects.toThrow(/recipient rejected the transfer/);
  });
});

describe("formatUnitsCompact", () => {
  it("formats any decimals, truncating and trimming zeros", () => {
    expect(formatUnitsCompact(1_234_567n, 6)).toBe("1.2345");
    expect(formatUnitsCompact(5n * 10n ** 18n, 18)).toBe("5");
    expect(formatUnitsCompact(1_500_000n, 6, 1)).toBe("1.5");
    expect(formatUnitsCompact(0n, 18)).toBe("0");
    expect(formatUnitsCompact(7n, 0)).toBe("7");
  });
  it("handles sub-resolution fractions and negatives", () => {
    expect(formatUnitsCompact(1n, 18)).toBe("0");
    expect(formatUnitsCompact(-1_500_000n, 6)).toBe("-1.5");
    expect(formatUnitsCompact(-1n, 18)).toBe("0");
  });
});
