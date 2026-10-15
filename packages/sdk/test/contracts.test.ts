import { describe, expect, it } from "vitest";

import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import {
  getContract,
  isDeployed,
  listContracts,
  pepuContracts,
} from "../src/contracts.js";

describe("pepuContracts", () => {
  it("has an entry for both known chain ids", () => {
    expect(pepuContracts[pepuMainnet.id]).toBeDefined();
    expect(pepuContracts[pepuTestnet.id]).toBeDefined();
  });

  it("returns undefined for an unknown chain id", () => {
    expect(getContract(1, "create2Factory")).toBeUndefined();
  });

  it("marks the CREATE2 deployer as deployed at the verified address, on both chains", () => {
    for (const chainId of [pepuMainnet.id, pepuTestnet.id]) {
      const entry = getContract(chainId, "create2Factory");
      expect(isDeployed(entry)).toBe(true);
      if (isDeployed(entry)) {
        expect(entry.address).toBe(
          "0x4e59b44847b379578588920cA78FbF26c0B4956C",
        );
      }
    }
  });

  it("has multicall3 deployed on mainnet at the PEPU-specific address", () => {
    const entry = getContract(pepuMainnet.id, "multicall3");
    expect(entry?.status).toBe("deployed");
    expect(isDeployed(entry)).toBe(true);
    expect(isDeployed(entry) && entry.address).toBe(
      "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd",
    );
    // Never the canonical address — unreachable on this Nitro chain.
    expect(
      isDeployed(entry) && entry.address.toLowerCase(),
    ).not.toBe("0xcA11bde05977b3631167028862bE2a173976CA11".toLowerCase());
  });

  it("keeps multicall3 pending on testnet, with no address field", () => {
    const entry = getContract(pepuTestnet.id, "multicall3");
    expect(entry?.status).toBe("pending");
    expect(entry && "address" in entry).toBe(false);
  });

  it("has the AA stack deployed on mainnet and absent on testnet", () => {
    for (const name of [
      "entryPoint06",
      "entryPoint07",
      "kernelFactory",
      "kernelMetaFactory",
      "ecdsaValidator",
    ] as const) {
      expect(getContract(pepuMainnet.id, name)?.status).toBe("deployed");
      // Testnet got none of the ZeroDev deployment.
      const t = getContract(pepuTestnet.id, name);
      expect(t?.status).toBe("pending");
      expect(t && "address" in t).toBe(false);
    }
  });

  it("has the canonical permit2 deployed on mainnet", () => {
    const entry = getContract(pepuMainnet.id, "permit2");
    expect(isDeployed(entry)).toBe(true);
    expect(isDeployed(entry) && entry.address).toBe(
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    );
  });

  it("keeps permit2 pending on testnet", () => {
    const entry = getContract(pepuTestnet.id, "permit2");
    expect(entry?.status).toBe("pending");
    expect(entry && "address" in entry).toBe(false);
  });

  it("points the paymaster alias at the v2 canary and labels its audit status", () => {
    const entry = getContract(pepuMainnet.id, "paymaster");
    expect(isDeployed(entry)).toBe(true);
    expect(isDeployed(entry) && entry.address).toBe("0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
    expect(isDeployed(entry) && entry.verifiedAt).toBe("2026-10-14");
    expect(isDeployed(entry) && entry.notes).toMatch(/audit pending/i);
  });

  it("marks the v1 paymaster retired", () => {
    const entry = getContract(pepuMainnet.id, "paymasterV1");
    expect(isDeployed(entry) && entry.retired).toBe(true);
    expect(isDeployed(entry) && entry.notes).toMatch(/RETIRED/);
    expect(isDeployed(entry) && entry.notes).toMatch(/deposit/i);
  });

  it("keeps the paymaster pending on testnet", () => {
    const entry = getContract(pepuTestnet.id, "paymaster");
    expect(entry?.status).toBe("pending");
    expect(entry && "address" in entry).toBe(false);
  });

  it("lists every registered contract for a chain", () => {
    expect(listContracts(pepuMainnet.id).length).toBe(16);
    expect(listContracts(pepuTestnet.id).length).toBe(16);
    expect(listContracts(1)).toEqual([]);
  });
});
