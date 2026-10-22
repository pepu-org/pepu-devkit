import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf } from "../test-helpers.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const STATS_BODY = {
  total_blocks: "10521067",
  total_transactions: "24687451",
  total_addresses: "30208",
  gas_prices: { slow: 10937.51, average: 10937.51, fast: 10937.51 },
  gas_used_today: "47567016",
  coin_price: null,
};

// The hosted bundler and paymaster service are probed by default, so the stub answers them too.
const SPONSORSHIP_HANDLERS: Record<string, (id: number) => unknown> = {
  eth_supportedEntryPoints: () => ({ result: ["0x0000000071727De22E5E9d8BAf0edAc6f37da032"] }),
  // The required UserOperation methods exist: a bad-params call answers "invalid params", never "method not found".
  eth_sendUserOperation: () => ({ error: { code: -32602, message: "invalid params" } }),
  eth_estimateUserOperationGas: () => ({ error: { code: -32602, message: "invalid params" } }),
  eth_getUserOperationReceipt: () => ({ error: { code: -32602, message: "invalid params" } }),
  eth_getUserOperationByHash: () => ({ error: { code: -32602, message: "invalid params" } }),
  pimlico_getUserOperationGasPrice: () => ({ result: {} }),
  zd_getUserOperationGasPrice: () => ({ error: { code: -32601, message: "Method not found" } }),
  pm_getPaymasterStubData: () => ({ result: { paymaster: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" } }),
};

function stubMixed(rpcHandlers: Record<string, (id: number) => unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.body) {
        const body = JSON.parse(String(init.body)) as { id: number; method: string };
        const handler = rpcHandlers[body.method] ?? SPONSORSHIP_HANDLERS[body.method];
        if (!handler) throw new Error(`unexpected RPC method in test: ${body.method}`);
        return rpcResponse({ jsonrpc: "2.0", id: body.id, ...(handler(body.id) as object) });
      }
      if (url.includes("/stats")) return jsonResponse(STATS_BODY);
      if (url.endsWith("/health")) return jsonResponse({ status: "ok" });
      if (url.endsWith("/v2/free-tier")) return jsonResponse({});
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

describe("pepu_health_check", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports healthy when RPC (both networks) and Blockscout are all reachable with matching chain ids", async () => {
    stubMixed({
      eth_chainId: () => ({ result: "0x17dcd" }), // mainnet — will also be returned for testnet call below via same handler map keyed by method only
      eth_blockNumber: () => ({ result: "0x64" }),
    });
    // Note: since both mainnet and testnet clients call the same JSON-RPC method names,
    // and our stub keys only on method, this exercises the "chain id looks right" path for
    // whichever network is checked first; deeper per-network chain-id mismatch is covered below.
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_health_check", arguments: { network: "mainnet" } })) as {
      overall: string;
      checks: Array<{ check: string; reachable: boolean | null }>;
    };
    expect(result.overall).toBe("healthy");
    const rpcCheck = result.checks.find((c) => c.check === "mainnet RPC");
    expect(rpcCheck?.reachable).toBe(true);
    const blockscoutCheck = result.checks.find((c) => c.check === "mainnet Blockscout (pepuscan)");
    expect(blockscoutCheck?.reachable).toBe(true);
  });

  it("marks testnet Blockscout as not-applicable (null), not a failure", async () => {
    stubMixed({
      eth_chainId: () => ({ result: "0x17dcc" }),
      eth_blockNumber: () => ({ result: "0x1" }),
    });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_health_check", arguments: { network: "testnet" } })) as {
      overall: string;
      checks: Array<{ check: string; reachable: boolean | null; note?: string }>;
    };
    expect(result.overall).toBe("healthy");
    const testnetBlockscout = result.checks.find((c) => c.check === "testnet Blockscout");
    expect(testnetBlockscout?.reachable).toBeNull();
    expect(testnetBlockscout?.note).toMatch(/no Blockscout instance is registered/i);
  });

  it("reports degraded and surfaces the error when the RPC is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT")));
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_health_check", arguments: { network: "mainnet" } })) as {
      overall: string;
      checks: Array<{ check: string; reachable: boolean; error?: string }>;
    };
    expect(result.overall).toBe("degraded");
    const rpcCheck = result.checks.find((c) => c.check === "mainnet RPC");
    expect(rpcCheck?.reachable).toBe(false);
    expect(rpcCheck?.error).toMatch(/ETIMEDOUT/);
  });

  it("flags a chain-id mismatch as unreachable/misconfigured rather than silently passing", async () => {
    stubMixed({
      eth_chainId: () => ({ result: "0x1" }), // wrong chain id
      eth_blockNumber: () => ({ result: "0x64" }),
    });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_health_check", arguments: { network: "mainnet" } })) as {
      overall: string;
      checks: Array<{ check: string; reachable: boolean; error?: string }>;
    };
    expect(result.overall).toBe("degraded");
    const rpcCheck = result.checks.find((c) => c.check === "mainnet RPC");
    expect(rpcCheck?.reachable).toBe(false);
    expect(rpcCheck?.error).toMatch(/expected 97741/);
  });
});
