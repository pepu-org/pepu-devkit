import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBlockscoutNetwork, getAddress, getStats, getToken, search } from "./blockscout.js";
import { PepuToolError } from "./errors.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("assertBlockscoutNetwork", () => {
  it("does not throw for mainnet", () => {
    expect(() => assertBlockscoutNetwork("mainnet")).not.toThrow();
  });

  it("throws a PepuToolError with actionable guidance for testnet", () => {
    try {
      assertBlockscoutNetwork("testnet");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PepuToolError);
      expect((err as Error).message).toMatch(/pepu_read_contract/);
      expect((err as Error).message).toMatch(/no registered Blockscout instance/i);
    }
  });
});

describe("blockscoutFetch (via getAddress/search)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null on a 404 instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Not found" }, 404)));
    const result = await getAddress("0x0000000000000000000000000000000000dEaD");
    expect(result).toBeNull();
  });

  it("throws an actionable error including Blockscout's own message on a non-2xx, non-404 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Something went wrong" }, 500)));
    await expect(getAddress("0x0000000000000000000000000000000000dEaD")).rejects.toThrow(/HTTP 500/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Something went wrong" }, 500)));
    await expect(getAddress("0x0000000000000000000000000000000000dEaD")).rejects.toThrow(/Something went wrong/);
  });

  it("gives 422-specific guidance about malformed input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ errors: [{ detail: "Invalid value" }] }, 422)));
    await expect(getAddress("bad")).rejects.toThrow(/checksummed/);
  });

  it("surfaces network-level fetch failures as an actionable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"))
    );
    await expect(search("wpepu")).rejects.toThrow(/Could not reach pepuscan/);
  });

  it("parses a successful search response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [{ type: "token", name: "Wrapped PEPU", symbol: "WPEPU", address_hash: "0xabc" }],
          next_page_params: null,
        })
      )
    );
    const result = await search("wpepu");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.symbol).toBe("WPEPU");
  });

  it("parses a successful token response and never carries a real coin/exchange price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          address_hash: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
          name: "Wrapped PEPU",
          symbol: "WPEPU",
          decimals: "18",
          type: "ERC-20",
          total_supply: "714603885699030405419988367",
          holders_count: "1327",
          exchange_rate: null,
          circulating_market_cap: null,
          icon_url: null,
          reputation: "ok",
        })
      )
    );
    const result = await getToken("0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8");
    expect(result?.symbol).toBe("WPEPU");
    expect(result?.exchange_rate).toBeNull();
  });

  it("returns null for a token address pepuscan has never indexed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Not found" }, 404)));
    const result = await getToken("0x0000000000000000000000000000000000dEaD");
    expect(result).toBeNull();
  });

  it("parses a successful stats response with a null coin_price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          total_blocks: "10521067",
          total_transactions: "24687451",
          total_addresses: "30208",
          gas_prices: { slow: 10937.51, average: 10937.51, fast: 10937.51 },
          gas_used_today: "47567016",
          coin_price: null,
        })
      )
    );
    const result = await getStats();
    expect(result.coin_price).toBeNull();
    expect(result.gas_prices?.average).toBeCloseTo(10937.51);
  });
});
