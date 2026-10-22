import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf } from "../test-helpers.js";

function rpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("pepu_chain_info", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns cached facts for both networks by default, without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_chain_info", arguments: {} })
    ) as Record<string, { chainId: number }>;

    expect(result["mainnet"]?.chainId).toBe(97741);
    expect(result["testnet"]?.chainId).toBe(97740);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flags Multicall3 and EntryPoint as missing in detailed mode", async () => {
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_chain_info", arguments: { network: "mainnet", response_format: "detailed" } })
    ) as { mainnet: { canonicalContracts: Array<{ name: string; deployed: boolean }> } };

    const multicall3 = result.mainnet.canonicalContracts.find((c) => c.name === "Multicall3");
    expect(multicall3?.deployed).toBe(false);
  });

  it("cross-checks against a live RPC call when verify_live is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { method: string; id: number };
        if (body.method === "eth_chainId") return rpcResponse({ jsonrpc: "2.0", id: body.id, result: "0x17dcd" });
        if (body.method === "eth_gasPrice") return rpcResponse({ jsonrpc: "2.0", id: body.id, result: "0xb5e620f4800" });
        throw new Error(`unexpected RPC method in test: ${body.method}`);
      })
    );

    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_chain_info", arguments: { network: "mainnet", verify_live: true } })
    ) as { mainnet: { liveCheck: { reachable: boolean; chainId: number } } };

    expect(result.mainnet.liveCheck.reachable).toBe(true);
    expect(result.mainnet.liveCheck.chainId).toBe(97741);
  });

  it("reports unreachable (not a thrown tool error) when the RPC call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_chain_info", arguments: { network: "mainnet", verify_live: true } });
    expect(result.isError).toBeFalsy();
    const parsed = jsonOf(result) as { mainnet: { liveCheck: { reachable: boolean } } };
    expect(parsed.mainnet.liveCheck.reachable).toBe(false);
  });
});
