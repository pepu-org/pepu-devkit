import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const WPEPU = "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8";
const OTHER_TOKEN = "0x1234567890123456789012345678901234567890";
const EOA = "0xa427305648aD5227098812EdA6FF82D980b2DbBD";
const CONTRACT_NOT_A_TOKEN = "0x261eA5971B93237a56990206A46Bc80318e4d078";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Dispatches both pepuscan REST calls (GET, plain URL) and JSON-RPC calls
 * (POST, method in the body) from one fetch stub, since pepu_get_token_info
 * hits both concurrently.
 */
function stubCombined(opts: {
  token?: unknown | null;
  address?: unknown | null;
  rpc?: { symbol?: string; decimals?: number; totalSupply?: string; fail?: boolean };
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === undefined && !init?.body) {
      // pepuscan GET request
    }
    if (typeof url === "string" && url.includes("pepuscan.com")) {
      if (url.includes("/tokens/")) {
        return opts.token === undefined ? jsonResponse({ message: "not found" }, 404) : opts.token === null ? jsonResponse({ message: "not found" }, 404) : jsonResponse(opts.token);
      }
      if (url.includes("/addresses/")) {
        return opts.address === undefined || opts.address === null ? jsonResponse({ message: "not found" }, 404) : jsonResponse(opts.address);
      }
      throw new Error(`unexpected pepuscan URL in test: ${url}`);
    }
    // RPC call
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    if (opts.rpc?.fail) {
      return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "rpc down" } });
    }
    const encodeString = (s: string) => {
      const hex = Buffer.from(s, "utf8").toString("hex");
      const offset = (32).toString(16).padStart(64, "0");
      const len = (hex.length / 2).toString(16).padStart(64, "0");
      const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, "0");
      return offset + len + padded;
    };
    if (body.method === "eth_call") {
      // crude selector-based dispatch: symbol()=0x95d89b41, decimals()=0x313ce567, totalSupply()=0x18160ddd
      const params = (JSON.parse(String(init?.body)) as { params: [{ data: string }] }).params[0].data;
      if (params.startsWith("0x95d89b41")) {
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: "0x" + encodeString(opts.rpc?.symbol ?? "TOK") });
      }
      if (params.startsWith("0x313ce567")) {
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: "0x" + (opts.rpc?.decimals ?? 18).toString(16).padStart(64, "0") });
      }
      if (params.startsWith("0x18160ddd")) {
        const supply = BigInt(opts.rpc?.totalSupply ?? "1000000000000000000000");
        return jsonResponse({ jsonrpc: "2.0", id: body.id, result: "0x" + supply.toString(16).padStart(64, "0") });
      }
      return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "unexpected call" } });
    }
    return jsonResponse({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `unexpected method ${body.method}` } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("pepu_get_token_info", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns concise token info and flags WPEPU as the wrapped-native token", async () => {
    stubCombined({
      token: {
        address_hash: WPEPU,
        name: "Wrapped PEPU",
        symbol: "WPEPU",
        decimals: "18",
        type: "ERC-20",
        total_supply: "1000000000000000000000",
        holders_count: "42",
        exchange_rate: null,
        circulating_market_cap: null,
        icon_url: null,
        reputation: "ok",
      },
      rpc: { symbol: "WPEPU", decimals: 18, totalSupply: "1000000000000000000000" },
    });

    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_get_token_info", arguments: { address: WPEPU } })) as {
      symbol: string;
      decimals: number;
      totalSupply: string;
      holdersCount: number;
      isWrappedNative: boolean;
      wrappedNativeNote?: string;
      rpcCrossCheckWarning?: string;
    };
    expect(result.symbol).toBe("WPEPU");
    expect(result.decimals).toBe(18);
    expect(result.totalSupply).toBe("1000");
    expect(result.holdersCount).toBe(42);
    expect(result.isWrappedNative).toBe(true);
    expect(result.wrappedNativeNote).toMatch(/canonical wrapped-native/i);
    expect(result.rpcCrossCheckWarning).toBeUndefined();
  });

  it("does not flag an unrelated token as wrapped-native, and includes the WPEPU address for reference in detailed mode", async () => {
    stubCombined({
      token: {
        address_hash: OTHER_TOKEN,
        name: "Some Token",
        symbol: "TOK",
        decimals: "18",
        type: "ERC-20",
        total_supply: "5000000000000000000000",
        holders_count: "10",
        exchange_rate: null,
        circulating_market_cap: null,
        icon_url: "https://example.com/icon.png",
        reputation: "ok",
      },
      rpc: { symbol: "TOK", decimals: 18, totalSupply: "5000000000000000000000" },
    });

    const client = await createTestClient();
    const concise = jsonOf(
      await client.callTool({ name: "pepu_get_token_info", arguments: { address: OTHER_TOKEN } })
    ) as { isWrappedNative: boolean; wrappedNativeAddressForReference?: string };
    expect(concise.isWrappedNative).toBe(false);
    expect(concise.wrappedNativeAddressForReference).toBeUndefined();

    const detailed = jsonOf(
      await client.callTool({ name: "pepu_get_token_info", arguments: { address: OTHER_TOKEN, response_format: "detailed" } })
    ) as { wrappedNativeAddressForReference?: string; iconUrl?: string; exchangeRateNote?: string; rpcCrossCheck?: unknown };
    expect(detailed.wrappedNativeAddressForReference).toBe(WPEPU);
    expect(detailed.iconUrl).toContain("icon.png");
    expect(detailed.exchangeRateNote).toMatch(/no on-chain price oracle/i);
    expect(detailed.rpcCrossCheck).toBeDefined();
  });

  it("warns when pepuscan's indexed data disagrees with a live RPC read", async () => {
    stubCombined({
      token: {
        address_hash: OTHER_TOKEN,
        name: "Some Token",
        symbol: "STALE",
        decimals: "18",
        type: "ERC-20",
        total_supply: "5000000000000000000000",
        holders_count: "10",
        exchange_rate: null,
        circulating_market_cap: null,
        icon_url: null,
        reputation: "ok",
      },
      rpc: { symbol: "FRESH", decimals: 18, totalSupply: "5000000000000000000000" },
    });

    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_get_token_info", arguments: { address: OTHER_TOKEN } })) as {
      rpcCrossCheckWarning?: string;
      rpcCrossCheck?: { symbol: string };
    };
    expect(result.rpcCrossCheckWarning).toMatch(/disagrees with a live RPC read/i);
    expect(result.rpcCrossCheck?.symbol).toBe("FRESH");
  });

  it("falls back to pepuscan-only data with a note when the live RPC cross-check fails", async () => {
    stubCombined({
      token: {
        address_hash: OTHER_TOKEN,
        name: "Some Token",
        symbol: "TOK",
        decimals: "18",
        type: "ERC-20",
        total_supply: "5000000000000000000000",
        holders_count: "10",
        exchange_rate: null,
        circulating_market_cap: null,
        icon_url: null,
        reputation: "ok",
      },
      rpc: { fail: true },
    });

    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_get_token_info", arguments: { address: OTHER_TOKEN } })) as {
      rpcCrossCheckNote?: string;
      symbol: string;
    };
    expect(result.symbol).toBe("TOK");
    expect(result.rpcCrossCheckNote).toMatch(/Live RPC read failed/i);
  });

  it("distinguishes a verified non-token contract from an unrecognized address", async () => {
    stubCombined({
      token: null,
      address: {
        hash: CONTRACT_NOT_A_TOKEN,
        is_contract: true,
        is_verified: true,
        is_scam: false,
        name: "TapScore",
        coin_balance: "0",
        creator_address_hash: null,
        creation_transaction_hash: null,
        proxy_type: null,
        implementations: [],
        token: null,
        has_tokens: false,
        has_token_transfers: false,
      },
    });

    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_token_info", arguments: { address: CONTRACT_NOT_A_TOKEN } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a token pepuscan recognizes/i);
    expect(textOf(result)).toMatch(/IS a contract/i);
    expect(textOf(result)).toMatch(/pepu_verify_contract_status/);
  });

  it("distinguishes an EOA from a token", async () => {
    stubCombined({
      token: null,
      address: {
        hash: EOA,
        is_contract: false,
        is_verified: false,
        is_scam: false,
        name: null,
        coin_balance: "100",
        creator_address_hash: null,
        creation_transaction_hash: null,
        proxy_type: null,
        implementations: [],
        token: null,
        has_tokens: false,
        has_token_transfers: false,
      },
    });

    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_token_info", arguments: { address: EOA } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/externally-owned account/i);
  });

  it("reports no on-chain history when pepuscan has never seen the address at all", async () => {
    stubCombined({ token: null, address: null });
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_token_info", arguments: { address: OTHER_TOKEN } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no on-chain history/i);
  });

  it("rejects an invalid address before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_token_info", arguments: { address: "not-an-address" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a valid EVM address/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects testnet with the shared Blockscout-availability explanation, before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_get_token_info", arguments: { address: WPEPU, network: "testnet" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no registered Blockscout instance/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never fabricates a USD figure", async () => {
    stubCombined({
      token: {
        address_hash: OTHER_TOKEN,
        name: "Some Token",
        symbol: "TOK",
        decimals: "18",
        type: "ERC-20",
        total_supply: "5000000000000000000000",
        holders_count: "10",
        exchange_rate: null,
        circulating_market_cap: null,
        icon_url: null,
        reputation: "ok",
      },
      rpc: { symbol: "TOK", decimals: 18, totalSupply: "5000000000000000000000" },
    });
    const client = await createTestClient();
    const result = jsonOf(
      await client.callTool({ name: "pepu_get_token_info", arguments: { address: OTHER_TOKEN, response_format: "detailed" } })
    ) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toMatch(/\$\d/);
  });
});
