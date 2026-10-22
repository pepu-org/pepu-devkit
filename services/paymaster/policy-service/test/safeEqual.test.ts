import { describe, expect, it } from "vitest";
import { safeEqual } from "../src/safeEqual.js";

describe("safeEqual", () => {
  it("is true only for identical strings", () => {
    expect(safeEqual("s3cret-token", "s3cret-token")).toBe(true);
    expect(safeEqual("s3cret-token", "s3cret-tokeN")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("does not throw on different lengths (timingSafeEqual alone would)", () => {
    expect(() => safeEqual("short", "a-much-longer-token-value")).not.toThrow();
    expect(safeEqual("short", "a-much-longer-token-value")).toBe(false);
  });

  it("handles non-ASCII input", () => {
    expect(safeEqual("pässword", "pässword")).toBe(true);
    expect(safeEqual("pässword", "passw0rd")).toBe(false);
  });
});
