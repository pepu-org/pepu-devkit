import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const TO = "0xa427305648aD5227098812EdA6FF82D980b2DbBD";

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

describe("pepu_estimate_gas_cost", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prices a supplied gas_limit against the live gas price without calling eth_estimateGas", async () => {
    stubRpc({ eth_gasPrice: () => ({ result: "0xb5e620f4800" }) }); // 12,500,000,000,000 wei
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_estimate_gas_cost", arguments: { gas_limit: 21000 } })
    ) as { costPepu: string; gasSource: string };
    expect(result.gasSource).toMatch(/not live-simulated/);
    expect(result.costPepu).toBe("0.2625");
  });

  it("live-simulates via eth_estimateGas when `to` is given", async () => {
    stubRpc({
      eth_gasPrice: () => ({ result: "0xb5e620f4800" }),
      eth_estimateGas: () => ({ result: "0x5208" }), // 21000
    });
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_estimate_gas_cost", arguments: { to: TO } })
    ) as { gasUnits: string; gasSource: string };
    expect(result.gasUnits).toBe("21000");
    expect(result.gasSource).toMatch(/live eth_estimateGas/);
  });

  it("requires `to`, `data`, or `gas_limit`, and fails before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_estimate_gas_cost", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Need `to`.*`gas_limit`/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live-simulates a contract deployment when `data` is given with no `to`", async () => {
    stubRpc({
      eth_gasPrice: () => ({ result: "0xb5e620f4800" }),
      eth_estimateGas: () => ({ result: "0xf4240" }), // 1,000,000
    });
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_estimate_gas_cost", arguments: { data: "0x600a600c600039600a6000f300603760005260206000f3" } })
    ) as { gasUnits: string; gasSource: string };
    expect(result.gasUnits).toBe("1000000");
    expect(result.gasSource).toMatch(/contract deployment/);
  });

  it("rejects malformed calldata before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_estimate_gas_cost", arguments: { to: TO, data: "not-hex" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not valid calldata/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wraps an eth_estimateGas failure (e.g. a reverting call) as an actionable error", async () => {
    stubRpc({
      eth_gasPrice: () => ({ result: "0xb5e620f4800" }),
      eth_estimateGas: () => ({ error: { code: 3, message: "execution reverted" } }),
    });
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_estimate_gas_cost", arguments: { to: TO } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/eth_estimateGas failed/);
    expect(textOf(result)).toMatch(/gas_limit/); // suggests the workaround
  });

  it("never fabricates a USD figure", async () => {
    stubRpc({ eth_gasPrice: () => ({ result: "0xb5e620f4800" }) });
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_estimate_gas_cost", arguments: { gas_limit: 21000, response_format: "detailed" } })
    ) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toMatch(/\$/);
    expect(result["usdConversionNote"]).toMatch(/no on-chain price oracle/i);
  });
});
