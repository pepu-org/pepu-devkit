import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import { pepuTokenList } from "../src/tokens.js";

// Vendored verbatim from
// https://github.com/Uniswap/token-lists/blob/main/src/tokenlist.schema.json
// (draft-07). Re-sync this fixture if Uniswap ever revises the schema.
const schemaPath = fileURLToPath(
  new URL("./fixtures/uniswap-tokenlist.schema.json", import.meta.url),
);
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return JSON.stringify(errors, null, 2);
}

describe("pepuTokenList", () => {
  it("validates against the official Uniswap Token List JSON schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const valid = validate(pepuTokenList);
    expect(valid, formatErrors(validate.errors)).toBe(true);
  });

  it("only includes tokens on chains this SDK defines", () => {
    const knownChainIds = new Set<number>([pepuMainnet.id, pepuTestnet.id]);
    for (const token of pepuTokenList.tokens) {
      expect(knownChainIds.has(token.chainId)).toBe(true);
    }
  });

  it("includes the independently-verified WPEPU address on mainnet", () => {
    const wpepu = pepuTokenList.tokens.find(
      (token) => token.symbol === "WPEPU",
    );
    expect(wpepu).toBeDefined();
    expect(wpepu?.chainId).toBe(pepuMainnet.id);
    expect(wpepu?.address).toBe("0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8");
    expect(wpepu?.decimals).toBe(18);
  });

  it("includes the independently-verified USDT address on mainnet", () => {
    const usdt = pepuTokenList.tokens.find((token) => token.symbol === "USDT");
    expect(usdt).toBeDefined();
    expect(usdt?.chainId).toBe(pepuMainnet.id);
    expect(usdt?.address).toBe("0x06f69A40C33C5A4Cd038BBE1DA689D4D636Ec448");
    expect(usdt?.name).toBe("Tether USD");
    // USDT uses 6 decimals, unlike PEPU/WPEPU's 18 — a common source of bugs.
    expect(usdt?.decimals).toBe(6);
  });

  it("includes the on-chain-verified USDC and WETH addresses on mainnet", () => {
    const usdc = pepuTokenList.tokens.find((token) => token.symbol === "USDC");
    expect(usdc?.chainId).toBe(pepuMainnet.id);
    expect(usdc?.address).toBe("0x20fB684Bfc1aBAaD3AceC5712f2Aa30bd494dF74");
    expect(usdc?.decimals).toBe(6);
    const weth = pepuTokenList.tokens.find((token) => token.symbol === "WETH");
    expect(weth?.chainId).toBe(pepuMainnet.id);
    expect(weth?.address).toBe("0x7CCC51754216C04D4Bb1210630cCA16e5430Aa70");
    expect(weth?.decimals).toBe(18);
  });

  it("has no entries for the testnet (no verified token addresses exist yet)", () => {
    const testnetTokens = pepuTokenList.tokens.filter(
      (token) => token.chainId === pepuTestnet.id,
    );
    expect(testnetTokens).toEqual([]);
  });
});
