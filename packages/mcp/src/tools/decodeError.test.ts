import { describe, expect, it } from "vitest";
import { encodeErrorResult, type Abi } from "viem";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const SOLIDITY_ERROR_ABI = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }] as const satisfies Abi;
const SOLIDITY_PANIC_ABI = [{ type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] }] as const satisfies Abi;
const ENTRYPOINT_ABI = [
  { type: "error", name: "FailedOp", inputs: [{ name: "opIndex", type: "uint256" }, { name: "reason", type: "string" }] },
] as const satisfies Abi;
const ARBSYS_ABI = [
  { type: "error", name: "InvalidBlockNumber", inputs: [{ name: "requested", type: "uint256" }, { name: "current", type: "uint256" }] },
] as const satisfies Abi;
const ARB_RETRYABLE_ABI = [{ type: "error", name: "NoTicketWithID", inputs: [] }] as const satisfies Abi;
const CUSTOM_ABI = [{ type: "error", name: "Unauthorized", inputs: [{ name: "caller", type: "address" }] }] as const satisfies Abi;

describe("pepu_decode_error", () => {
  it("decodes a standard Error(string) revert without needing any abi", async () => {
    const data = encodeErrorResult({ abi: SOLIDITY_ERROR_ABI, errorName: "Error", args: ["insufficient balance"] });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_decode_error", arguments: { data } })) as {
      matched: boolean;
      errorName: string;
      kind: string;
      reason: string;
    };
    expect(result.matched).toBe(true);
    expect(result.errorName).toBe("Error");
    expect(result.kind).toMatch(/Solidity built-in revert string/);
    expect(result.reason).toBe("insufficient balance");
  });

  it("decodes a Panic(uint256) and explains the code", async () => {
    const data = encodeErrorResult({ abi: SOLIDITY_PANIC_ABI, errorName: "Panic", args: [0x11n] });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_decode_error", arguments: { data } })) as {
      errorName: string;
      panicCode: string;
      meaning: string;
    };
    expect(result.errorName).toBe("Panic");
    expect(result.panicCode).toBe("0x11");
    expect(result.meaning).toMatch(/overflow or underflow/i);
  });

  it("decodes EntryPoint's FailedOp and explains the AA-code phase", async () => {
    const data = encodeErrorResult({ abi: ENTRYPOINT_ABI, errorName: "FailedOp", args: [0n, "AA21 didn't pay prefund"] });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_decode_error", arguments: { data } })) as {
      errorName: string;
      kind: string;
      erc4337Phase: string;
      args: [string, string];
    };
    expect(result.errorName).toBe("FailedOp");
    expect(result.kind).toMatch(/EntryPoint/);
    expect(result.args[1]).toBe("AA21 didn't pay prefund");
    expect(result.erc4337Phase).toMatch(/sender\/account validation/);
  });

  it("decodes ArbSys's InvalidBlockNumber (the selector this table was live-verified against)", async () => {
    const data = encodeErrorResult({ abi: ARBSYS_ABI, errorName: "InvalidBlockNumber", args: [999999999999n, 12345n] });
    expect(data.slice(0, 10)).toBe("0xd5dc642d"); // live-confirmed against PEPU mainnet's ArbSys precompile
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_decode_error", arguments: { data } })) as {
      errorName: string;
      kind: string;
      args: [string, string];
    };
    expect(result.errorName).toBe("InvalidBlockNumber");
    expect(result.kind).toMatch(/ArbOS precompile/);
    expect(result.args[0]).toBe("999999999999");
  });

  it("decodes a zero-argument ArbOS error passed as a bare selector", async () => {
    const data = encodeErrorResult({ abi: ARB_RETRYABLE_ABI, errorName: "NoTicketWithID" });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_decode_error", arguments: { data } })) as { errorName: string };
    expect(result.errorName).toBe("NoTicketWithID");
  });

  it("decodes a caller-supplied custom error via the abi parameter", async () => {
    const data = encodeErrorResult({ abi: CUSTOM_ABI, errorName: "Unauthorized", args: ["0x000000000000000000000000000000000000dEaD"] });
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_decode_error", arguments: { data, abi: CUSTOM_ABI as unknown as Record<string, unknown>[] } })
    ) as { errorName: string; kind: string; args: [string] };
    expect(result.errorName).toBe("Unauthorized");
    expect(result.kind).toMatch(/your supplied `abi`/);
    expect(result.args[0].toLowerCase()).toBe("0x000000000000000000000000000000000000dead");
  });

  it("reports no match (not a thrown error) for an unrecognized selector, and suggests passing abi", async () => {
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_decode_error", arguments: { data: "0xdeadbeef" } })) as {
      matched: boolean;
      selector: string;
      guidance: string;
    };
    expect(result.matched).toBe(false);
    expect(result.selector).toBe("0xdeadbeef");
    expect(result.guidance).toMatch(/pass its ABI/i);
  });

  it("rejects non-hex input", async () => {
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_decode_error", arguments: { data: "not-hex" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not valid hex/);
  });

  it("rejects data too short to contain a selector", async () => {
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_decode_error", arguments: { data: "0x1234" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/too short/);
  });

  it("includes matchedFrom and the raw abiItem only in detailed mode", async () => {
    const data = encodeErrorResult({ abi: SOLIDITY_PANIC_ABI, errorName: "Panic", args: [0x01n] });
    const client = await createTestClient();
    const concise = jsonOf(await client.callTool({ name: "pepu_decode_error", arguments: { data } })) as Record<string, unknown>;
    expect(concise["matchedFrom"]).toBeUndefined();
    expect(concise["abiItem"]).toBeUndefined();

    const detailed = jsonOf(
      await client.callTool({ name: "pepu_decode_error", arguments: { data, response_format: "detailed" } })
    ) as { matchedFrom: string; abiItem: unknown };
    expect(detailed.matchedFrom).toMatch(/Solidity built-in/);
    expect(detailed.abiItem).toBeDefined();
  });
});
