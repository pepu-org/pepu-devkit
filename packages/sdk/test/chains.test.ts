import { describe, expect, it } from "vitest";

import {
  isPepuChain,
  pepuChains,
  pepuMainnet,
  pepuTestnet,
} from "../src/chains.js";

describe("pepuMainnet", () => {
  it("has the verified chain id", () => {
    expect(pepuMainnet.id).toBe(97741);
  });

  it("has the verified name", () => {
    expect(pepuMainnet.name).toBe("Pepe Unchained V2");
  });

  it("has the verified native currency", () => {
    expect(pepuMainnet.nativeCurrency).toEqual({
      name: "Pepe Unchained",
      symbol: "PEPU",
      decimals: 18,
    });
  });

  it("has the verified RPC URL as its default transport", () => {
    expect(pepuMainnet.rpcUrls.default.http).toEqual([
      "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz",
    ]);
  });

  it("has the verified Blockscout explorer with an API URL", () => {
    expect(pepuMainnet.blockExplorers?.default.url).toBe(
      "https://pepuscan.com",
    );
    expect(pepuMainnet.blockExplorers?.default.apiUrl).toBe(
      "https://pepuscan.com/api",
    );
  });

  it("is not flagged as a testnet", () => {
    expect(pepuMainnet.testnet).toBe(false);
  });

  it("registers the PEPU-specific multicall3, never the canonical address", () => {
    const mc = pepuMainnet.contracts?.multicall3;
    expect(mc?.address).toBe("0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd");
    // The canonical address is structurally unreachable on this Nitro
    // chain. Pointing here would make every batched read call an address
    // with no code, so guard against it explicitly.
    expect(mc?.address?.toLowerCase()).not.toBe(
      "0xcA11bde05977b3631167028862bE2a173976CA11".toLowerCase(),
    );
  });
});

describe("pepuTestnet", () => {
  it("has the verified chain id", () => {
    expect(pepuTestnet.id).toBe(97740);
  });

  it("has the verified native currency", () => {
    expect(pepuTestnet.nativeCurrency).toEqual({
      name: "Pepe Unchained",
      symbol: "PEPU",
      decimals: 18,
    });
  });

  it("has the verified RPC URL as its default transport", () => {
    expect(pepuTestnet.rpcUrls.default.http).toEqual([
      "https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz",
    ]);
  });

  it("is flagged as a testnet", () => {
    expect(pepuTestnet.testnet).toBe(true);
  });

  it("does not claim mainnet's Blockscout explorer (unverified for this chain)", () => {
    expect(pepuTestnet.blockExplorers).toBeUndefined();
  });

  it("registers no multicall3 — nothing has been deployed to testnet", () => {
    expect(pepuTestnet.contracts?.multicall3).toBeUndefined();
  });
});

describe("pepuChains", () => {
  it("exports both chains, mainnet first", () => {
    expect(pepuChains).toEqual([pepuMainnet, pepuTestnet]);
  });

  it("has two distinct chain ids", () => {
    const ids = new Set(pepuChains.map((chain) => chain.id));
    expect(ids.size).toBe(2);
  });
});

describe("isPepuChain", () => {
  it("is true for mainnet and testnet ids", () => {
    expect(isPepuChain(pepuMainnet.id)).toBe(true);
    expect(isPepuChain(pepuTestnet.id)).toBe(true);
  });

  it("is false for an unrelated chain id (e.g. Ethereum mainnet)", () => {
    expect(isPepuChain(1)).toBe(false);
  });
});
