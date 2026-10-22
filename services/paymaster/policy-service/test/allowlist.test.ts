import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { Allowlist } from "../src/allowlist.js";
import type { RegisteredApp } from "../src/types.js";

const TARGET_A = "0x0000000000000000000000000000000000000001" as Address;
const TARGET_B = "0x0000000000000000000000000000000000000002" as Address;
const NOT_ALLOWED = "0x0000000000000000000000000000000000000009" as Address;

function app(overrides: Partial<RegisteredApp>): RegisteredApp {
  return {
    id: "test-app",
    apiKeyHashHex: "0".repeat(64),
    allowedDestinations: "*",
    dailySpendCapWei: 10n ** 18n,
    lifetimeSpendCapWei: null,
    ...overrides,
  };
}

describe("Allowlist", () => {
  const allowlist = new Allowlist({ destinations: [TARGET_A, TARGET_B] });

  it("isGloballyAllowed is true only for destinations on the global list", () => {
    expect(allowlist.isGloballyAllowed(TARGET_A)).toBe(true);
    expect(allowlist.isGloballyAllowed(TARGET_B)).toBe(true);
    expect(allowlist.isGloballyAllowed(NOT_ALLOWED)).toBe(false);
  });

  it("isGloballyAllowed is case-insensitive", () => {
    expect(allowlist.isGloballyAllowed(TARGET_A.toUpperCase() as Address)).toBe(true);
  });

  it("an app with allowedDestinations '*' defers entirely to the global allowlist", () => {
    const wildcardApp = app({ allowedDestinations: "*" });
    expect(allowlist.isAllowedForApp(wildcardApp, TARGET_A)).toBe(true);
    expect(allowlist.isAllowedForApp(wildcardApp, TARGET_B)).toBe(true);
    // '*' still does not escape the global allowlist -- the global list is
    // the hard backstop no app can exceed.
    expect(allowlist.isAllowedForApp(wildcardApp, NOT_ALLOWED)).toBe(false);
  });

  it("an app scoped to a subset is rejected for a globally-allowed destination outside its own list (AND, not OR)", () => {
    const scopedApp = app({ allowedDestinations: [TARGET_A] });
    expect(allowlist.isAllowedForApp(scopedApp, TARGET_A)).toBe(true);
    // TARGET_B is globally allowed, but NOT in this app's own scoped list --
    // must still be denied. This is the core "AND relationship" the module
    // doc comment describes.
    expect(allowlist.isAllowedForApp(scopedApp, TARGET_B)).toBe(false);
  });

  it("an app's own list can never widen beyond the global allowlist", () => {
    // Even if a misconfigured app lists a destination NOT on the global
    // allowlist, isAllowedForApp must still deny it -- the global check
    // happens unconditionally first.
    const misconfiguredApp = app({ allowedDestinations: [NOT_ALLOWED] });
    expect(allowlist.isAllowedForApp(misconfiguredApp, NOT_ALLOWED)).toBe(false);
  });

  it("globalDestinations exposes the configured list for inspection", () => {
    expect(allowlist.globalDestinations).toEqual([TARGET_A, TARGET_B]);
  });
});
