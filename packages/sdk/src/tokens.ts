import type { Address } from "viem";

import { pepuMainnet } from "./chains.js";

/**
 * Shape mirrors the `TokenInfo` definition in the Uniswap Token List
 * schema (https://uniswap.org/tokenlist.schema.json). Kept as a local
 * type (rather than importing one from `@uniswap/token-lists`) so
 * consumers of `@pepu-chain/sdk` never need that package installed just to
 * typecheck.
 */
export interface PepuTokenInfo {
  readonly chainId: number;
  readonly address: Address;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly logoURI?: string;
  readonly tags?: readonly string[];
}

/** Shape mirrors the top-level Uniswap Token List schema. */
export interface PepuTokenList {
  readonly name: string;
  readonly timestamp: string;
  readonly version: {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
  };
  readonly tokens: readonly PepuTokenInfo[];
  readonly keywords?: readonly string[];
}

/**
 * Canonical Pepe Unchained V2 token list, conforming to the Uniswap Token
 * List schema (see `test/tokens.test.ts` for schema validation against a
 * vendored copy of https://uniswap.org/tokenlist.schema.json).
 *
 * Deliberately minimal: every entry below is a token address independently
 * verified on-chain (see each entry's inline note), not copied from docs or
 * a third-party list without cross-checking. No other token address met
 * that bar at the time this list was written, and none are included here
 * as placeholders. See the README's "Known gaps" section.
 *
 * There is no verified token address for testnet (chain 97740) yet, so
 * this list currently only covers mainnet.
 */
export const pepuTokenList: PepuTokenList = {
  name: "Pepe Unchained",
  timestamp: "2026-10-03T00:00:00.000Z",
  version: { major: 1, minor: 2, patch: 0 },
  tokens: [
    {
      chainId: pepuMainnet.id,
      address: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
      name: "Wrapped Pepe Unchained",
      symbol: "WPEPU",
      decimals: 18,
      // Cross-verified across the project's own docs, Blockscout's token
      // list, and PepuSwap's deployment config, plus an on-chain
      // `eth_getCode` call and Blockscout's "verified as WETH9" source
      // match. See `wpepuAbi` in `./abi/wpepu.ts` for the ABI-level
      // verification (deposit/withdraw/decimals/symbol/name all confirmed
      // live).
    },
    {
      chainId: pepuMainnet.id,
      address: "0x06f69A40C33C5A4Cd038BBE1DA689D4D636Ec448",
      name: "Tether USD",
      symbol: "USDT",
      decimals: 6,
      // Verified live on 2026-09-24: discovered as the non-WPEPU leg of
      // PepuSwap's WPEPU/USDT 0.3% pool (`0x4bE3Af53800AADE09201654CD76D55063c7bdE70`,
      // itself returned by the independently-verified `pepuSwapV3FactoryAbi`
      // `getPool(WPEPU, USDT, 3000)` — see `../dex.ts`), then confirmed
      // directly against this address via `eth_call`: `name()` ->
      // "Tether USD", `symbol()` -> "USDT", `decimals()` -> `6`. Note the
      // 6 decimals (standard for USDT, unlike the 18-decimal PEPU/WPEPU) —
      // don't reuse `formatPepu`/`formatUnits(x, 18)` for this token.
    },
    {
      chainId: pepuMainnet.id,
      address: "0x20fB684Bfc1aBAaD3AceC5712f2Aa30bd494dF74",
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
      // Verified live on 2026-10-03 (read-only): `eth_getCode` returns 835
      // bytes of code, and `eth_call` gives `name()` -> "USD Coin",
      // `symbol()` -> "USDC", `decimals()` -> `6`. One of the tokens PepuSwap
      // trades. 6 decimals, like USDT.
    },
    {
      chainId: pepuMainnet.id,
      address: "0x7CCC51754216C04D4Bb1210630cCA16e5430Aa70",
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: 18,
      // Verified live on 2026-10-03 (read-only): `eth_getCode` returns 835
      // bytes of code, and `eth_call` gives `name()` -> "Wrapped Ether",
      // `symbol()` -> "WETH", `decimals()` -> `18`. One of the tokens
      // PepuSwap trades.
    },
  ],
};
