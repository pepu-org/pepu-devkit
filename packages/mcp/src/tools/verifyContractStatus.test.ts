import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

const CONTRACT = "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8";
const EOA = "0xa427305648aD5227098812EdA6FF82D980b2DbBD";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("pepu_verify_contract_status", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ABI summary for a verified contract in concise mode, full ABI in detailed", async () => {
    const contractBody = {
      name: "WETH9",
      is_verified: true,
      is_fully_verified: true,
      is_verified_via_sourcify: true,
      is_verified_via_verifier_alliance: false,
      compiler_version: "v0.4.19+commit.c4cbbb05",
      optimization_enabled: false,
      optimization_runs: null,
      language: "solidity",
      license_type: "none",
      proxy_type: null,
      implementations: [],
      abi: [{ type: "function", name: "symbol" }, { type: "function", name: "decimals" }, { type: "event", name: "Transfer" }],
      verified_at: "2026-01-01T00:00:00Z",
      sourcify_repo_url: "https://repo.sourcify.dev/...",
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse(contractBody)));

    const client = await createTestClient();
    const concise = jsonOf(await client.callTool({ name: "pepu_verify_contract_status", arguments: { address: CONTRACT } })) as {
      isVerified: boolean;
      abiFunctionCount: number;
      abi?: unknown;
    };
    expect(concise.isVerified).toBe(true);
    expect(concise.abiFunctionCount).toBe(2);
    expect(concise.abi).toBeUndefined();

    const detailed = jsonOf(
      await client.callTool({ name: "pepu_verify_contract_status", arguments: { address: CONTRACT, response_format: "detailed" } })
    ) as { abi: unknown[]; sourcifyRepoUrl: string };
    expect(detailed.abi).toHaveLength(3);
    expect(detailed.sourcifyRepoUrl).toContain("sourcify");
  });

  it("distinguishes an unverified contract from a plain EOA when pepuscan 404s the smart-contracts endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/smart-contracts/")) return jsonResponse({ message: "Not found" }, 404);
        if (url.includes(`/addresses/${EOA}`)) {
          return jsonResponse({
            hash: EOA,
            is_contract: false,
            is_verified: false,
            is_scam: false,
            name: null,
            coin_balance: "0",
            creator_address_hash: null,
            creation_transaction_hash: null,
            proxy_type: null,
            implementations: [],
            token: null,
            has_tokens: false,
            has_token_transfers: false,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_verify_contract_status", arguments: { address: EOA } })) as {
      isContract: boolean;
      guidance: string;
    };
    expect(result.isContract).toBe(false);
    expect(result.guidance).toMatch(/externally-owned account/i);
  });

  it("rejects testnet with the shared Blockscout-availability explanation, before making any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_verify_contract_status", arguments: { address: CONTRACT, network: "testnet" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no registered Blockscout instance/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
