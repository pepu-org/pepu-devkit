import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, isError, jsonOf } from "../test-helpers.js";

function rpc(handlers: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = handlers[body.method];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: result ?? null }), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

describe("pepu_explain_error", () => {
  it("explains a paymaster reason code through mapPaymasterReason", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_explain_error", arguments: { error: "project_not_claimed_onchain" } })) as Record<string, unknown>;
    expect(out["code"]).toBe("PAYMASTER_PROJECT_NOT_CLAIMED");
    expect(out["kind"]).toBe("reason-code");
    expect(String(out["fix"])).toMatch(/claim/i);
  });

  it("explains a message from the shared catalog", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_explain_error", arguments: { error: "Unsupported chain with id eip155:97741 not supported" } })) as Record<string, unknown>;
    expect(out["code"]).toBe("PRIVY_CHAIN_REJECTED_97741");
  });

  it("explains an AA failure and revert data, and falls back to UNKNOWN with a next step", async () => {
    const client = await createTestClient();
    const aa = jsonOf(await client.callTool({ name: "pepu_explain_error", arguments: { error: "FailedOp(0, AA23 reverted)" } })) as Record<string, unknown>;
    expect(aa["code"]).toBe("BUNDLER_AA_FAILED");
    const unknown = jsonOf(await client.callTool({ name: "pepu_explain_error", arguments: { error: "something odd happened" } })) as Record<string, unknown>;
    expect(unknown["code"]).toBe("UNKNOWN");
    expect(String(unknown["next"])).toMatch(/pepu_known_gotchas/);
  });

  it("never echoes its input", async () => {
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_explain_error", arguments: { error: "nonce too low CANARY-SECRET-123" } });
    expect(JSON.stringify(res)).not.toContain("CANARY-SECRET-123");
  });
});

describe("pepu_explain_tx", () => {
  afterEach(() => vi.unstubAllGlobals());
  const hash = "0x" + "11".repeat(32);

  it("rejects a malformed hash", async () => {
    const client = await createTestClient();
    expect(isError(await client.callTool({ name: "pepu_explain_tx", arguments: { hash: "0x12" } }))).toBe(true);
  });

  it("reports not found without a bundler configured", async () => {
    rpc({});
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_explain_tx", arguments: { hash } })) as Record<string, unknown>;
    expect(out["found"]).toBe(false);
  });

  it("explains a plain EOA transaction: sender pays, fee in PEPU, explorer links", async () => {
    const from = "0x1111111111111111111111111111111111111111";
    const to = "0x2222222222222222222222222222222222222222";
    rpc({
      eth_getTransactionByHash: { hash, from, to, value: "0xde0b6b3a7640000", input: "0x", nonce: "0x1", gas: "0x5208", gasPrice: "0x1", blockNumber: "0x10", blockHash: "0x" + "22".repeat(32), transactionIndex: "0x0", type: "0x0", v: "0x1c", r: "0x1", s: "0x1" },
      eth_getTransactionReceipt: { transactionHash: hash, from, to, status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", blockNumber: "0x10", blockHash: "0x" + "22".repeat(32), transactionIndex: "0x0", logs: [], cumulativeGasUsed: "0x5208", logsBloom: "0x" + "00".repeat(256), type: "0x0", contractAddress: null },
    });
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_explain_tx", arguments: { hash } })) as { kind: string; status: string; valuePepu: string; links: { tx: string }; userOps: unknown[] };
    expect(out.kind).toBe("eoa-transaction");
    expect(out.status).toBe("success");
    expect(out.valuePepu).toBe("1 PEPU");
    expect(out.links.tx).toBe(`https://pepuscan.com/tx/${hash}`);
    expect(out.userOps).toEqual([]);
  });
});
