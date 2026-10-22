import { afterEach, describe, expect, it, vi } from "vitest";

import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import { createPepuscanClient } from "../src/pepuscan.js";

// All `fetch` calls are stubbed in every test below — no real network
// access happens in this file.

function mockFetchOnce(response: { status: number; body?: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    json: async () => response.body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPepuscanClient", () => {
  it("throws immediately for a chain with no configured Blockscout API URL", () => {
    expect(() => createPepuscanClient(pepuTestnet)).toThrow(
      /no Blockscout API URL configured/i,
    );
  });

  it("does not call fetch just from being constructed", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    createPepuscanClient(pepuMainnet);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("getVerifiedAbi", () => {
  it("returns the ABI for a verified contract", async () => {
    const abi = [{ type: "function", name: "decimals", inputs: [], outputs: [] }];
    const fetchSpy = mockFetchOnce({ status: 200, body: { abi } });

    const client = createPepuscanClient(pepuMainnet);
    const result = await client.getVerifiedAbi(
      "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
    );

    expect(result).toEqual(abi);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pepuscan.com/api/v2/smart-contracts/0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
    );
  });

  it("returns null for a 404 (not verified), rather than throwing", async () => {
    mockFetchOnce({ status: 404 });
    const client = createPepuscanClient(pepuMainnet);
    const result = await client.getVerifiedAbi(
      "0x927af2a6B76d2d8206d93004463F8C122701383B",
    );
    expect(result).toBeNull();
  });

  it("returns null if the response has no abi field", async () => {
    mockFetchOnce({ status: 200, body: { abi: null } });
    const client = createPepuscanClient(pepuMainnet);
    const result = await client.getVerifiedAbi(
      "0x0000000000000000000000000000000000000001",
    );
    expect(result).toBeNull();
  });

  it("throws on a non-404 error status", async () => {
    mockFetchOnce({ status: 500 });
    const client = createPepuscanClient(pepuMainnet);
    await expect(
      client.getVerifiedAbi("0x0000000000000000000000000000000000000001"),
    ).rejects.toThrow(/500/);
  });
});

describe("getTokenMetadata", () => {
  it("maps a Blockscout token response, converting decimals to a number", async () => {
    mockFetchOnce({
      status: 200,
      body: {
        name: "Wrapped PEPU",
        symbol: "WPEPU",
        decimals: "18",
        total_supply: "712708080421401518123460639",
        type: "ERC-20",
      },
    });

    const client = createPepuscanClient(pepuMainnet);
    const result = await client.getTokenMetadata(
      "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
    );

    expect(result).toEqual({
      address: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
      name: "Wrapped PEPU",
      symbol: "WPEPU",
      decimals: 18,
      totalSupply: "712708080421401518123460639",
      type: "ERC-20",
    });
  });

  it("returns null for a 404 (not a known token)", async () => {
    mockFetchOnce({ status: 404 });
    const client = createPepuscanClient(pepuMainnet);
    const result = await client.getTokenMetadata(
      "0x0000000000000000000000000000000000000001",
    );
    expect(result).toBeNull();
  });
});
