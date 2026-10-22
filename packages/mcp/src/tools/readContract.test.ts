import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const ADDRESS = "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8";

const BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

function rpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function encodeUint256(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

describe("pepu_read_contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls a view function and decodes a uint256 result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: number; method: string };
        expect(body.method).toBe("eth_call");
        return rpcResponse({ jsonrpc: "2.0", id: body.id, result: encodeUint256(42n) });
      })
    );

    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({
        name: "pepu_read_contract",
        arguments: { address: ADDRESS, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: ["0xa427305648aD5227098812EdA6FF82D980b2DbBD"] },
      })
    ) as { result: string };

    expect(result.result).toBe("42");
  });

  it("coerces a string uint argument to bigint before encoding, without extra network setup", async () => {
    let capturedData = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: number; method: string; params: [{ data: string }] };
        capturedData = body.params[0].data;
        return rpcResponse({ jsonrpc: "2.0", id: body.id, result: encodeUint256(1n) });
      })
    );

    const client = await createTestClient();
    await client.callTool({
      name: "pepu_read_contract",
      arguments: { address: ADDRESS, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: ["0xa427305648aD5227098812EdA6FF82D980b2DbBD"] },
    });

    // selector for balanceOf(address) is 0x70a08231
    expect(capturedData.startsWith("0x70a08231")).toBe(true);
  });

  it("rejects a functionName not present in the supplied ABI, without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({
      name: "pepu_read_contract",
      arguments: { address: ADDRESS, abi: BALANCE_OF_ABI, functionName: "totalSupply" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No function named "totalSupply"/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-view function before making any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({
      name: "pepu_read_contract",
      arguments: {
        address: ADDRESS,
        abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [], outputs: [] }],
        functionName: "transfer",
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not view\/pure/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wraps an RPC revert as an actionable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: number };
        return rpcResponse({ jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted" } });
      })
    );
    const client = await createTestClient();
    const result = await client.callTool({
      name: "pepu_read_contract",
      arguments: { address: ADDRESS, abi: BALANCE_OF_ABI, functionName: "balanceOf", args: ["0xa427305648aD5227098812EdA6FF82D980b2DbBD"] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/reverted or failed/);
  });

  it("works against testnet too (RPC-direct tools are not Blockscout-gated)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: number };
        return rpcResponse({ jsonrpc: "2.0", id: body.id, result: encodeUint256(7n) });
      })
    );
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({
        name: "pepu_read_contract",
        arguments: {
          address: ADDRESS,
          abi: BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: ["0xa427305648aD5227098812EdA6FF82D980b2DbBD"],
          network: "testnet",
        },
      })
    ) as { result: string; network: string };
    expect(result.network).toBe("testnet");
    expect(result.result).toBe("7");
  });
});
