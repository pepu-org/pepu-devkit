import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const OWNER = "0x000000000000000000000000000000000000dEaD";
const OWNER_2 = "0x000000000000000000000000000000000000bEEF";
const COUNTERFACTUAL = "0x9400286bC91d1a55369a09f61874792884FeD4B3"; // live-computed for OWNER, salt 0, mainnet — see verification notes

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * Stubs eth_call (dispatched by which address is being called: the factory
 * for getAddress, anything else for a plain "no code" answer) and
 * eth_getCode, so the tool's two-step (compute address, then check code) flow
 * can be exercised deterministically.
 */
function stubFactory(opts: { deployedAddresses?: string[]; getAddressFails?: boolean; getAddressReturns?: string }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
    if (body.method === "eth_call") {
      if (opts.getAddressFails) {
        return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted" } });
      }
      const addr = (opts.getAddressReturns ?? COUNTERFACTUAL).slice(2).toLowerCase().padStart(64, "0");
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: "0x" + addr });
    }
    if (body.method === "eth_getCode") {
      const [address] = body.params as [string];
      const hasCode = (opts.deployedAddresses ?? []).some((a) => a.toLowerCase() === address.toLowerCase());
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: hasCode ? "0x6080604052" : "0x" });
    }
    throw new Error(`unexpected RPC method in test: ${body.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("pepu_smart_account_info", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("computes the counterfactual address via the factory's own getAddress and reports not-deployed", async () => {
    stubFactory({ deployedAddresses: [] });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER } })) as {
      owner: string;
      counterfactualAddress: string;
      isDeployed: boolean;
      factory: string;
      guidance: string;
    };
    expect(result.owner.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(result.counterfactualAddress.toLowerCase()).toBe(COUNTERFACTUAL.toLowerCase());
    expect(result.isDeployed).toBe(false);
    expect(result.factory).toBe("0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419");
    expect(result.guidance).toMatch(/never signs transactions/);
  });

  it("reports isDeployed true when eth_getCode finds bytecode at the computed address", async () => {
    stubFactory({ deployedAddresses: [COUNTERFACTUAL] });
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER } })) as { isDeployed: boolean; guidance: string };
    expect(result.isDeployed).toBe(true);
    expect(result.guidance).toMatch(/already deployed/);
  });

  it("defaults salt to 0 and accepts a plain integer salt string", async () => {
    stubFactory({ deployedAddresses: [] });
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER, salt: "1" } })
    ) as { salt: string };
    expect(result.salt).toBe("0x0000000000000000000000000000000000000000000000000000000000000001");
  });

  it("accepts a full 0x-prefixed 32-byte salt unchanged", async () => {
    stubFactory({ deployedAddresses: [] });
    const fullSalt = "0x" + "ab".repeat(32);
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER, salt: fullSalt } })
    ) as { salt: string };
    expect(result.salt).toBe(fullSalt);
  });

  it("includes initData and rootValidatorPacked only in detailed mode", async () => {
    stubFactory({ deployedAddresses: [] });
    const client = await createTestClient();
    const concise = jsonOf(await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER } })) as Record<string, unknown>;
    expect(concise["initData"]).toBeUndefined();

    const detailed = jsonOf(
      await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER, response_format: "detailed" } })
    ) as { initData: string; rootValidatorPacked: string };
    expect(detailed.initData.startsWith("0x3c3b752b")).toBe(true); // Kernel initialize() selector
    expect(detailed.rootValidatorPacked.toLowerCase()).toBe("0x01845adb2c711129d4f3966735ed98a9f09fc4ce57");
  });

  it("rejects an invalid owner address before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: "not-an-address" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a valid EVM address/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed salt before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER, salt: "not-a-number" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a valid salt/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects testnet with an explanation, before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER, network: "testnet" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not deployed on PEPU testnet/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("computes a different address for a different owner (sanity check on the encoding)", async () => {
    stubFactory({ deployedAddresses: [], getAddressReturns: "0x30B4A0cA6bFbFb3971C4562dE569c1720Da3c193" });
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER_2 } })
    ) as { counterfactualAddress: string };
    expect(result.counterfactualAddress.toLowerCase()).not.toBe(COUNTERFACTUAL.toLowerCase());
  });

  it("wraps a factory getAddress RPC failure as an actionable error", async () => {
    stubFactory({ getAddressFails: true });
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_smart_account_info", arguments: { owner: OWNER } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Calling getAddress/);
  });
});
