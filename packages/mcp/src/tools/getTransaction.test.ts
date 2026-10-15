import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const HASH = "0x22d69e6adf9d8a846834c03d3e8943a0228c5c8c7c2479f4c0b2b75c73597c6a";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SAMPLE_TX = {
  hash: HASH,
  status: "ok",
  result: "success",
  block_number: 10327037,
  timestamp: "2026-02-24T16:55:39.000000Z",
  from: { hash: "0xFrom", name: null, is_contract: false },
  to: { hash: "0xTo", name: "Sponsors", is_contract: true },
  created_contract: null,
  value: "10000000000000000000",
  fee: { type: "actual", value: "3357075000000000000" },
  gas_used: "268566",
  gas_limit: "299052",
  gas_price: "12500000000000",
  method: "setSponsor",
  decoded_input: {
    method_call: "setSponsor(string _url)",
    method_id: "6bbd3eec",
    parameters: [{ name: "_url", type: "string", value: "https://example.com" }],
  },
  revert_reason: null,
  nonce: 185,
  transaction_types: ["coin_transfer", "contract_call"],
  arbitrum: { batch_number: 12619, batch_data_container: "in_anytrust", status: "Confirmed on base" },
};

describe("pepu_get_transaction", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a malformed hash without a network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_transaction", arguments: { hash: "0xnothash" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a valid transaction hash/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("converts value/fee to PEPU and surfaces decoded input in concise mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(SAMPLE_TX)));
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_get_transaction", arguments: { hash: HASH } })) as {
      value: { pepu: string };
      fee: { pepu: string };
      decodedInput: { signature: string };
      gas?: unknown;
    };
    expect(result.value.pepu).toBe("10");
    expect(result.fee.pepu).toBe("3.357075");
    expect(result.decodedInput.signature).toContain("setSponsor");
    expect(result.gas).toBeUndefined();
  });

  it("adds gas breakdown and Arbitrum batch info in detailed mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(SAMPLE_TX)));
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_get_transaction", arguments: { hash: HASH, response_format: "detailed" } })
    ) as { arbitrumBatch: { l1SettlementStatus: string }; gas: { limit: string } };
    expect(result.arbitrumBatch.l1SettlementStatus).toBe("Confirmed on base");
    expect(result.gas.limit).toBe("299052");
  });

  it("gives an actionable error when the transaction is not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Not found" }, 404)));
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_transaction", arguments: { hash: HASH } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no transaction found/i);
  });
});
