import { describe, expect, it } from "vitest";
import { formatPepu, paginate } from "./format.js";

describe("formatPepu", () => {
  it("converts a wei string to a decimal PEPU string", () => {
    expect(formatPepu("1000000000000000000")).toBe("1");
    expect(formatPepu("1875000000000000000")).toBe("1.875");
    expect(formatPepu("0")).toBe("0");
  });

  it("returns null for null/undefined input instead of throwing", () => {
    expect(formatPepu(null)).toBeNull();
    expect(formatPepu(undefined)).toBeNull();
  });

  it("returns null for a non-numeric string instead of throwing", () => {
    expect(formatPepu("not-a-number")).toBeNull();
  });
});

describe("paginate", () => {
  it("returns everything with no note when under the limit", () => {
    const { items, note } = paginate([1, 2, 3], 5);
    expect(items).toEqual([1, 2, 3]);
    expect(note).toBeNull();
  });

  it("truncates and attaches an actionable guidance note when over the limit", () => {
    const { items, note } = paginate([1, 2, 3, 4, 5], 2);
    expect(items).toEqual([1, 2]);
    expect(note).toContain("Showing 2 of 5");
    expect(note).toMatch(/narrow/i);
  });
});
