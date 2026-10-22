import { describe, expect, it } from "vitest";
import { computeTopUpWei } from "../src/depositMonitor.js";

const BASE = {
  lowWaterMarkWei: 20_000_000_000_000_000n, // 0.02
  targetWei: 50_000_000_000_000_000n, // 0.05
  maxCeilingWei: 100_000_000_000_000_000n, // 0.1
};

describe("computeTopUpWei", () => {
  it("does nothing when the deposit is at or above the low-water mark", () => {
    const result = computeTopUpWei({ ...BASE, currentDepositWei: BASE.lowWaterMarkWei });
    expect(result.isLow).toBe(false);
    expect(result.topUpWei).toBe(0n);
  });

  it("does nothing when the deposit is comfortably above the low-water mark, even if below target", () => {
    const result = computeTopUpWei({ ...BASE, currentDepositWei: 30_000_000_000_000_000n });
    expect(result.isLow).toBe(false);
    expect(result.topUpWei).toBe(0n);
  });

  it("tops up to the target when the deposit is below the low-water mark", () => {
    const current = 5_000_000_000_000_000n; // 0.005
    const result = computeTopUpWei({ ...BASE, currentDepositWei: current });
    expect(result.isLow).toBe(true);
    expect(result.topUpWei).toBe(BASE.targetWei - current);
  });

  it("tops up from a zero deposit to the full target", () => {
    const result = computeTopUpWei({ ...BASE, currentDepositWei: 0n });
    expect(result.topUpWei).toBe(BASE.targetWei);
  });

  it("clamps an over-ceiling target down to the ceiling and caps the top-up accordingly", () => {
    // targetWei is deliberately set above maxCeilingWei to prove the
    // ceiling wins unconditionally, rather than the top-up being refused
    // outright or overshooting the ceiling.
    const result = computeTopUpWei({
      currentDepositWei: 1_000_000_000_000_000n, // 0.001, below low-water mark
      lowWaterMarkWei: 2_000_000_000_000_000n, // 0.002
      targetWei: 200_000_000_000_000_000n, // 0.2 -- above the ceiling on purpose
      maxCeilingWei: 100_000_000_000_000_000n, // 0.1
    });
    expect(result.isLow).toBe(true);
    expect(result.topUpWei).toBe(100_000_000_000_000_000n - 1_000_000_000_000_000n);
    expect(result.reason).toMatch(/clamped down to ceiling/);
  });

  it("refuses to top up further when the deposit is already at or above the ceiling", () => {
    const result = computeTopUpWei({
      currentDepositWei: 150_000_000_000_000_000n, // above ceiling
      lowWaterMarkWei: 200_000_000_000_000_000n, // artificially raised above current, so isLow=true
      targetWei: 50_000_000_000_000_000n,
      maxCeilingWei: 100_000_000_000_000_000n,
    });
    expect(result.isLow).toBe(true);
    expect(result.topUpWei).toBe(0n);
  });

  it("refuses to act on inconsistent configuration (ceiling below low-water mark)", () => {
    const result = computeTopUpWei({
      currentDepositWei: 0n,
      lowWaterMarkWei: 50_000_000_000_000_000n,
      targetWei: 10_000_000_000_000_000n,
      maxCeilingWei: 20_000_000_000_000_000n, // below lowWaterMarkWei
    });
    expect(result.topUpWei).toBe(0n);
    expect(result.reason).toMatch(/inconsistent/);
  });

  it("never returns a negative top-up (target already below current, but still below low-water mark is impossible -- guards the arithmetic anyway)", () => {
    // currentDepositWei < lowWaterMarkWei but >= targetWei would be a weird
    // config (target below low-water mark); the function must still never
    // return negative wei.
    const result = computeTopUpWei({
      currentDepositWei: 15_000_000_000_000_000n,
      lowWaterMarkWei: 20_000_000_000_000_000n,
      targetWei: 10_000_000_000_000_000n, // below current
      maxCeilingWei: 100_000_000_000_000_000n,
    });
    expect(result.topUpWei).toBe(0n);
    expect(result.topUpWei >= 0n).toBe(true);
  });
});
