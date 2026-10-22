import { describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf } from "../test-helpers.js";

describe("pepu_known_gotchas", () => {
  it("returns the gotchas list without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const client = await createTestClient();
      const result = jsonOf(await client.callTool({ name: "pepu_known_gotchas", arguments: {} })) as {
        gotchas: string[];
      };
      expect(result.gotchas.length).toBeGreaterThan(5);
      expect(result.gotchas.some((g) => /Multicall3/.test(g))).toBe(true);
      expect(result.gotchas.some((g) => /PEPU HOSTS THE BUNDLER/.test(g))).toBe(true);
      for (const marker of [
        /SELF-HOSTING THE SPONSORSHIP STACK/,
        /PRIVY POLICY NAME LIMIT/,
        /SESSION SIGNER TRANSACTIONS DENIED/,
        /WALLET PROVISIONING AND ACTIVE WALLET/,
        /SCOPE DECISIONS/,
      ]) {
        expect(result.gotchas.some((g) => marker.test(g))).toBe(true);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("only includes canonicalContracts in detailed mode", async () => {
    const client = await createTestClient();
    const concise = jsonOf(await client.callTool({ name: "pepu_known_gotchas", arguments: {} })) as Record<string, unknown>;
    expect(concise["canonicalContracts"]).toBeUndefined();

    const detailed = jsonOf(
      await client.callTool({ name: "pepu_known_gotchas", arguments: { response_format: "detailed" } })
    ) as { canonicalContracts: Array<{ name: string }> };
    expect(detailed.canonicalContracts.some((c) => c.name === "Multicall3")).toBe(true);
  });
});
