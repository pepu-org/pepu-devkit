import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const WPEPU = "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === null ? JSON.stringify({ message: "Not found" }) : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubPepuscan(routes: { address?: unknown; counters?: unknown; tokenBalances?: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/token-balances")) return jsonResponse(routes.tokenBalances ?? []);
      if (url.includes("/counters")) return jsonResponse(routes.counters ?? null, routes.counters ? 200 : 404);
      if (url.includes("/addresses/")) return jsonResponse(routes.address ?? null, routes.address ? 200 : 404);
      throw new Error(`unexpected fetch in test: ${url}`);
    })
  );
}

describe("pepu_get_address_overview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a malformed address without making any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_address_overview", arguments: { address: "not-an-address" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a valid EVM address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects testnet with an actionable explanation instead of a generic schema error", async () => {
    stubPepuscan({});
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_address_overview", arguments: { address: WPEPU, network: "testnet" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no registered Blockscout instance/i);
  });

  it("composes address + counters + token-balances into one overview, for a verified contract", async () => {
    stubPepuscan({
      address: {
        hash: WPEPU,
        is_contract: true,
        is_verified: true,
        is_scam: false,
        name: "WETH9",
        coin_balance: "1000000000000000000",
        creator_address_hash: "0xabc",
        creation_transaction_hash: "0xdef",
        proxy_type: null,
        implementations: [],
        token: null,
        has_tokens: false,
        has_token_transfers: false,
      },
      counters: { transactions_count: "42", token_transfers_count: "0", gas_usage_count: "0", validations_count: "0" },
      tokenBalances: [],
    });

    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_get_address_overview", arguments: { address: WPEPU } })) as {
      type: string;
      balance: { pepu: string };
      transactionCount: number;
      guidance: string;
    };

    expect(result.type).toBe("contract");
    expect(result.balance.pepu).toBe("1");
    expect(result.transactionCount).toBe(42);
    expect(result.guidance).toMatch(/verify_contract_status/);
  });

  it("caps token holdings to 5 in concise mode with a pagination note", async () => {
    const tokens = Array.from({ length: 8 }, (_, i) => ({
      token: { address_hash: `0x${i}`, name: `Token ${i}`, symbol: `T${i}`, decimals: "18", type: "ERC-20", holders_count: "1", total_supply: "1" },
      token_id: null,
      value: "1",
    }));
    stubPepuscan({
      address: {
        hash: WPEPU,
        is_contract: false,
        is_verified: null,
        is_scam: false,
        name: null,
        coin_balance: "0",
        creator_address_hash: null,
        creation_transaction_hash: null,
        proxy_type: null,
        implementations: [],
        token: null,
        has_tokens: true,
        has_token_transfers: true,
      },
      counters: { transactions_count: "1", token_transfers_count: "1", gas_usage_count: "0", validations_count: "0" },
      tokenBalances: tokens,
    });

    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_get_address_overview", arguments: { address: WPEPU } })) as {
      tokenHoldings: unknown[];
      tokenHoldingsNote: string;
      tokenHoldingsCount: number;
    };

    expect(result.tokenHoldingsCount).toBe(8);
    expect(result.tokenHoldings).toHaveLength(5);
    expect(result.tokenHoldingsNote).toMatch(/Showing 5 of 8/);
  });

  it("gives an actionable error for an address pepuscan has never seen", async () => {
    stubPepuscan({});
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_address_overview", arguments: { address: WPEPU } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no record of this address/i);
  });
});
