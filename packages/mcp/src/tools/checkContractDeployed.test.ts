import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";
import { findMatches } from "./checkContractDeployed.js";

const MULTICALL3_CANONICAL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_PEPU = "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd";

function rpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Stubs eth_getCode: returns non-empty code for any address in `withCode`, "0x" otherwise. */
function stubGetCode(withCode: string[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { id: number; method: string; params: [string, string] };
      if (body.method !== "eth_getCode") throw new Error(`unexpected RPC method in test: ${body.method}`);
      const [address] = body.params;
      const hasCode = withCode.some((a) => a.toLowerCase() === address.toLowerCase());
      return rpcResponse({ jsonrpc: "2.0", id: body.id, result: hasCode ? "0x6080" : "0x" });
    })
  );
}

describe("findMatches (name resolution)", () => {
  it("resolves an alias to the full display name via substring match, not exact equality", () => {
    const matches = findMatches("multicall");
    expect(matches.map((m) => m.name)).toEqual(["Multicall3"]);
  });

  it("resolves a bare alias key that isn't itself a real contract name (entrypoint -> both versions)", () => {
    const matches = findMatches("entrypoint");
    expect(matches.map((m) => m.name).sort()).toEqual(["EntryPoint v0.6", "EntryPoint v0.7"]);
  });

  it("narrows to one EntryPoint version when the version is included in the query", () => {
    const matches = findMatches("EntryPoint v0.7");
    expect(matches.map((m) => m.name)).toEqual(["EntryPoint v0.7"]);
  });

  it("resolves WPEPU and TapScore aliases to exactly one match each", () => {
    expect(findMatches("wpepu").map((m) => m.name)).toEqual(["WPEPU (Wrapped PEPU)"]);
    expect(findMatches("tapscore").map((m) => m.name)).toEqual(["TapScore (demo contract)"]);
  });

  it("returns nothing for a nonsense query", () => {
    expect(findMatches("totally-unrelated-string")).toEqual([]);
  });
});

describe("pepu_check_contract_deployed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("redirects a query for the canonical Multicall3 address to the working PEPU address", async () => {
    stubGetCode([]); // canonical address has no code anywhere
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_check_contract_deployed", arguments: { query: MULTICALL3_CANONICAL } })
    ) as { hasBytecodeRightNow: boolean; useThisAddressInstead: string; guidance: string };
    expect(result.hasBytecodeRightNow).toBe(false);
    expect(result.useThisAddressInstead).toBe(MULTICALL3_PEPU);
    expect(result.guidance).toMatch(/Multicall3/);
  });

  it("confirms the PEPU-specific Multicall3 address has code", async () => {
    stubGetCode([MULTICALL3_PEPU]);
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_check_contract_deployed", arguments: { query: MULTICALL3_PEPU } })
    ) as { hasBytecodeRightNow: boolean; matchedKnownContract: string };
    expect(result.hasBytecodeRightNow).toBe(true);
    expect(result.matchedKnownContract).toBe("Multicall3");
  });

  it("looks up a well-known contract by name and live-checks it", async () => {
    stubGetCode([MULTICALL3_PEPU]);
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_check_contract_deployed", arguments: { query: "multicall" } })) as {
      matches: Array<{ name: string; useThisAddress: string; hasBytecodeRightNow: boolean }>;
    };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.useThisAddress).toBe(MULTICALL3_PEPU);
    expect(result.matches[0]?.hasBytecodeRightNow).toBe(true);
  });

  it("reports an unrecognized address as having no known-contract match", async () => {
    const RANDOM = "0x1111111111111111111111111111111111111111";
    stubGetCode([RANDOM]);
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_check_contract_deployed", arguments: { query: RANDOM } })) as {
      hasBytecodeRightNow: boolean;
      matchedKnownContract?: string;
      guidance: string;
    };
    expect(result.hasBytecodeRightNow).toBe(true);
    expect(result.matchedKnownContract).toBeUndefined();
    expect(result.guidance).toMatch(/Not one of this server's known named contracts/);
  });

  it("rejects a query that is neither a valid address nor a known name, before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_check_contract_deployed", arguments: { query: "not-a-real-thing-at-all" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/doesn't match a valid address or a known contract name/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flags a stale cached fact when a live check disagrees with constants.ts", async () => {
    // Cached fact says EntryPoint v0.7 is NOT deployed on testnet — simulate it suddenly having code there.
    stubGetCode(["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]);
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_check_contract_deployed", arguments: { query: "EntryPoint v0.7", network: "testnet" } })
    ) as { matches: Array<{ staleWarning?: string; hasBytecodeRightNow: boolean }> };
    expect(result.matches[0]?.hasBytecodeRightNow).toBe(true);
    expect(result.matches[0]?.staleWarning).toMatch(/live check just returned true/);
  });
});
