import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("pepu_search", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps a token match to a suggested next tool", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              type: "token",
              name: "Wrapped PEPU",
              symbol: "WPEPU",
              address_hash: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
              is_smart_contract_verified: true,
            },
          ],
          next_page_params: null,
        })
      )
    );

    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_search", arguments: { query: "WPEPU" } })) as {
      matches: Array<{ type: string; nextTool: string }>;
    };
    expect(result.matches[0]?.type).toBe("token");
    expect(result.matches[0]?.nextTool).toMatch(/pepu_get_address_overview/);
  });

  it("maps a transaction match to pepu_get_transaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ items: [{ type: "transaction", transaction_hash: "0xabc123" }], next_page_params: null })
      )
    );
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_search", arguments: { query: "0xabc123" } })) as {
      matches: Array<{ nextTool: string; hash: string }>;
    };
    expect(result.matches[0]?.nextTool).toBe("pepu_get_transaction");
    expect(result.matches[0]?.hash).toBe("0xabc123");
  });

  it("gives an actionable error when there are no matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [], next_page_params: null })));
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_search", arguments: { query: "zzz-nonexistent" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no matches found/i);
  });

  it("caps results to 5 in concise mode with a note", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: Array.from({ length: 9 }, (_, i) => ({ type: "address", address_hash: `0x${i}` })),
          next_page_params: null,
        })
      )
    );
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_search", arguments: { query: "0x" } })) as {
      matches: unknown[];
      note: string;
      matchCount: number;
    };
    expect(result.matchCount).toBe(9);
    expect(result.matches).toHaveLength(5);
    expect(result.note).toMatch(/Showing 5 of 9/);
  });
});
