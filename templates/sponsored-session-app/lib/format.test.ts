import { describe, expect, it } from "vitest";
import { formatCountdown, truncateHex } from "./format";

describe("format", () => {
  it("truncates hex and counts down without going negative", () => {
    expect(truncateHex("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(formatCountdown(125)).toBe("2:05");
    expect(formatCountdown(-4)).toBe("0:00");
  });
});
