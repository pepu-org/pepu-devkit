import { http } from "viem";
import { describe, expect, it } from "vitest";

import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import { getPublicClient } from "../src/client.js";

// These tests only inspect the client's static configuration (chain,
// transport type, resolved RPC URL). They never call `.request()` or any
// public action, so no network access happens.

describe("getPublicClient", () => {
  it("configures an http transport pointed at the chain's default RPC URL", () => {
    const client = getPublicClient(pepuMainnet);
    expect(client.chain).toBe(pepuMainnet);
    expect(client.transport.type).toBe("http");
    expect((client.transport as { url?: string }).url).toBe(
      "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz",
    );
  });

  it("works for the testnet definition too", () => {
    const client = getPublicClient(pepuTestnet);
    expect(client.chain).toBe(pepuTestnet);
    expect((client.transport as { url?: string }).url).toBe(
      "https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz",
    );
  });

  it("accepts a custom transport override", () => {
    const client = getPublicClient(pepuMainnet, {
      transport: http("https://custom-rpc.example.com"),
    });
    expect((client.transport as { url?: string }).url).toBe(
      "https://custom-rpc.example.com",
    );
  });
});
