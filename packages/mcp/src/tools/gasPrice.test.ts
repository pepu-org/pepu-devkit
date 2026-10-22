import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf } from "../test-helpers.js";

function rpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function stubRpc(handlers: Record<string, (id: number) => unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id: number; method: string };
      const handler = handlers[body.method];
      if (!handler) throw new Error(`unexpected RPC method in test: ${body.method}`);
      return rpcResponse({ jsonrpc: "2.0", id: body.id, ...(handler(body.id) as object) });
    })
  );
}

describe("pepu_gas_price", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the current gas price and a reference cost table in concise mode", async () => {
    stubRpc({ eth_gasPrice: () => ({ result: "0xb5e620f4800" }) }); // 12,500 gwei
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_gas_price", arguments: {} })) as {
      gasPriceGwei: string;
      referenceCosts: Array<{ label: string; costPepu: string }>;
    };
    expect(result.gasPriceGwei).toBe("12,500");
    expect(result.referenceCosts.length).toBeGreaterThanOrEqual(4);
    const transfer = result.referenceCosts.find((c) => /native PEPU transfer/.test(c.label));
    expect(transfer?.costPepu).toBe("0.2625");
  });

  it("adds raw wei and block number only in detailed mode", async () => {
    stubRpc({
      eth_gasPrice: () => ({ result: "0xb5e620f4800" }),
      eth_blockNumber: () => ({ result: "0x64" }),
    });
    const client = await createTestClient();
    const concise = jsonOf(await client.callTool({ name: "pepu_gas_price", arguments: {} })) as Record<string, unknown>;
    expect(concise["gasPriceWei"]).toBeUndefined();

    const detailed = jsonOf(
      await client.callTool({ name: "pepu_gas_price", arguments: { response_format: "detailed" } })
    ) as { gasPriceWei: string; blockNumber: string };
    expect(detailed.gasPriceWei).toBe("12500000000000");
    expect(detailed.blockNumber).toBe("100");
  });

  it("never fabricates a USD figure", async () => {
    stubRpc({ eth_gasPrice: () => ({ result: "0xb5e620f4800" }) });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_gas_price", arguments: {} })) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toMatch(/\$/);
    expect(result["usdConversionNote"]).toMatch(/no on-chain price oracle/i);
  });
});
