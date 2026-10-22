import { describe, expect, it } from "vitest";

import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import {
  addressUrl,
  blockUrl,
  explorerUrl,
  tokenUrl,
  txUrl,
} from "../src/explorer.js";

describe("explorerUrl", () => {
  it("builds a transaction URL", () => {
    expect(explorerUrl(pepuMainnet, "tx", "0xabc")).toBe(
      "https://pepuscan.com/tx/0xabc",
    );
  });

  it("builds an address URL", () => {
    expect(explorerUrl(pepuMainnet, "address", "0xdef")).toBe(
      "https://pepuscan.com/address/0xdef",
    );
  });

  it("builds a token URL", () => {
    expect(
      explorerUrl(
        pepuMainnet,
        "token",
        "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
      ),
    ).toBe(
      "https://pepuscan.com/token/0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
    );
  });

  it("builds a block URL by number", () => {
    expect(explorerUrl(pepuMainnet, "block", 12345)).toBe(
      "https://pepuscan.com/block/12345",
    );
  });

  it("builds a block URL by hash", () => {
    expect(explorerUrl(pepuMainnet, "block", "0xblockhash")).toBe(
      "https://pepuscan.com/block/0xblockhash",
    );
  });

  it("throws for a chain with no configured explorer (e.g. testnet)", () => {
    expect(() => explorerUrl(pepuTestnet, "tx", "0xabc")).toThrow(
      /no block explorer is configured/i,
    );
  });
});

describe("named shorthands", () => {
  it("txUrl matches explorerUrl(chain, 'tx', value)", () => {
    expect(txUrl(pepuMainnet, "0xabc")).toBe(explorerUrl(pepuMainnet, "tx", "0xabc"));
  });

  it("addressUrl matches explorerUrl(chain, 'address', value)", () => {
    expect(addressUrl(pepuMainnet, "0xdef")).toBe(
      explorerUrl(pepuMainnet, "address", "0xdef"),
    );
  });

  it("tokenUrl matches explorerUrl(chain, 'token', value)", () => {
    expect(tokenUrl(pepuMainnet, "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8")).toBe(
      explorerUrl(pepuMainnet, "token", "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8"),
    );
  });

  it("blockUrl matches explorerUrl(chain, 'block', value)", () => {
    expect(blockUrl(pepuMainnet, 12345)).toBe(explorerUrl(pepuMainnet, "block", 12345));
  });
});
