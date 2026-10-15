import { describe, expect, it, vi } from "vitest";
import { createTestClient, jsonOf, textOf } from "../test-helpers.js";

describe("pepu_verify_contract_guide", () => {
  it("returns the confirmed-working Foundry command with the right verifier flags, with no network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_verify_contract_guide", arguments: { tool: "foundry" } })) as {
      foundry: { confirmedWorking: boolean; command: string };
      hardhat?: unknown;
    };
    expect(result.foundry.confirmedWorking).toBe(true);
    expect(result.foundry.command).toContain("--verifier blockscout");
    expect(result.foundry.command).toContain("--verifier-url https://pepuscan.com/api");
    expect(result.foundry.command).toContain("--chain 97741");
    expect(result.hardhat).toBeUndefined();
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("returns the Hardhat config snippet marked as not independently confirmed", async () => {
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_verify_contract_guide", arguments: { tool: "hardhat" } })) as {
      hardhat: { confirmedWorking: boolean; confirmedWorkingNote: string; configSnippetHardhat2: string };
      foundry?: unknown;
    };
    expect(result.hardhat.confirmedWorking).toBe(false);
    expect(result.hardhat.confirmedWorkingNote).toMatch(/not independently re-driven/);
    expect(result.hardhat.configSnippetHardhat2).toContain("https://pepuscan.com/api");
    expect(result.hardhat.configSnippetHardhat2).toContain("97741");
    expect(result.foundry).toBeUndefined();
  });

  it("returns both by default", async () => {
    const client = await createTestClient();
    const result = jsonOf(await client.callTool({ name: "pepu_verify_contract_guide", arguments: {} })) as {
      foundry: unknown;
      hardhat: unknown;
    };
    expect(result.foundry).toBeDefined();
    expect(result.hardhat).toBeDefined();
  });

  it("adds notes, hardhat 3 config, and the proxy caveat only in detailed mode", async () => {
    const client = await createTestClient();
    const concise = jsonOf(await client.callTool({ name: "pepu_verify_contract_guide", arguments: {} })) as Record<string, unknown>;
    expect(concise["proxyNote"]).toBeUndefined();

    const detailed = jsonOf(await client.callTool({ name: "pepu_verify_contract_guide", arguments: { response_format: "detailed" } })) as {
      proxyNote: string;
      foundry: { notes: string[] };
      hardhat: { configSnippetHardhat3: string; notes: string[] };
    };
    expect(detailed.proxyNote).toMatch(/proxy/i);
    expect(detailed.foundry.notes.length).toBeGreaterThan(0);
    expect(detailed.hardhat.configSnippetHardhat3).toContain("blockscout");
    expect(detailed.hardhat.notes.length).toBeGreaterThan(0);
  });

  it("rejects testnet with the shared Blockscout-availability explanation, before any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = await createTestClient();
    const result = await client.callTool({ name: "pepu_verify_contract_guide", arguments: { network: "testnet" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no registered Blockscout instance/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
