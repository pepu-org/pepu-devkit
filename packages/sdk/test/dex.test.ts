import { describe, expect, it } from "vitest";

import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import { isDeployed } from "../src/contracts.js";
import {
  getPepuSwapContract,
  listPepuSwapContracts,
  pepuSwapContracts,
} from "../src/dex.js";

const ALL_NAMES = [
  "v3Factory",
  "swapRouter02",
  "universalRouter",
  "positionManager",
  "quoterV2",
  "tickLens",
  "v3Migrator",
  "v3Staker",
  "multicallNonCanonical",
  "permit2NonCanonical",
] as const;

describe("pepuSwapContracts", () => {
  it("is mainnet-only — PepuSwap has no testnet deployment", () => {
    expect(pepuSwapContracts[pepuMainnet.id]).toBeDefined();
    expect(pepuSwapContracts[pepuTestnet.id]).toBeUndefined();
  });

  it("lists every registered PepuSwap contract on mainnet, all deployed", () => {
    const entries = listPepuSwapContracts(pepuMainnet.id);
    expect(entries.length).toBe(ALL_NAMES.length);
    for (const entry of entries) {
      expect(entry.status).toBe("deployed");
    }
  });

  it("returns an empty list for a chain with no PepuSwap deployment", () => {
    expect(listPepuSwapContracts(pepuTestnet.id)).toEqual([]);
    expect(listPepuSwapContracts(1)).toEqual([]);
  });

  it("has the verified v3Factory address", () => {
    const entry = getPepuSwapContract(pepuMainnet.id, "v3Factory");
    expect(isDeployed(entry)).toBe(true);
    expect(isDeployed(entry) && entry.address).toBe(
      "0x5984B8BF2d4dB9C0aCB1d7924762e4474D80C807",
    );
  });

  it("has the verified swapRouter02 address", () => {
    const entry = getPepuSwapContract(pepuMainnet.id, "swapRouter02");
    expect(isDeployed(entry) && entry.address).toBe(
      "0x150c3F0f16C3D9EB34351d7af9c961FeDc97A0fb",
    );
  });

  it("has multicallNonCanonical and permit2NonCanonical distinct from the canonical registry addresses", () => {
    const multicall = getPepuSwapContract(pepuMainnet.id, "multicallNonCanonical");
    const permit2 = getPepuSwapContract(pepuMainnet.id, "permit2NonCanonical");
    expect(isDeployed(multicall) && multicall.address).toBe(
      "0x927af2a6B76d2d8206d93004463F8C122701383B",
    );
    expect(isDeployed(permit2) && permit2.address).toBe(
      "0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B",
    );
    // Never confused with Multicall3 or canonical Permit2.
    expect(isDeployed(multicall) && multicall.address.toLowerCase()).not.toBe(
      "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd".toLowerCase(),
    );
    expect(isDeployed(permit2) && permit2.address.toLowerCase()).not.toBe(
      "0x000000000022D473030F116dDEE9F6B43aC78BA3".toLowerCase(),
    );
  });

  it("returns undefined for an unregistered contract name lookup on an unknown chain", () => {
    expect(getPepuSwapContract(1, "v3Factory")).toBeUndefined();
  });

  it("re-exports isDeployed identical to the one in contracts.ts, for convenience", async () => {
    const dexModule = await import("../src/dex.js");
    const contractsModule = await import("../src/contracts.js");
    expect(dexModule.isDeployed).toBe(contractsModule.isDeployed);
  });
});
