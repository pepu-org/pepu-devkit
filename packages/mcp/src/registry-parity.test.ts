import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getContract, isDeployed, pepuMainnet, pepuTestnet } from "@pepu-chain/sdk";
import { CANONICAL_CONTRACTS, ENTRYPOINT_V07_ADDRESS, KERNEL_FACTORY_ADDRESS, MAINNET, PAYMASTER_ADDRESS, TESTNET, TAPSCORE_ADDRESS, WPEPU_ADDRESS, listPendingMainnetContracts } from "./constants.js";
import { SERVER_VERSION } from "./server.js";
import { DOC_PAGES, TEMPLATE_REGISTRY } from "./snapshots.js";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..", "..");

function addr(key: Parameters<typeof getContract>[1]): string {
  const e = getContract(pepuMainnet.id, key);
  if (!isDeployed(e)) throw new Error(key);
  return e.address;
}

describe("registry parity (constants.ts is built on the SDK)", () => {
  it("chain facts come from the SDK chain objects", () => {
    expect(MAINNET.chainId).toBe(pepuMainnet.id);
    expect(MAINNET.rpcUrl).toBe(pepuMainnet.rpcUrls.default.http[0]);
    expect(TESTNET.chainId).toBe(pepuTestnet.id);
  });

  it("named address exports equal the registry", () => {
    expect(KERNEL_FACTORY_ADDRESS).toBe(addr("kernelFactory"));
    expect(ENTRYPOINT_V07_ADDRESS).toBe(addr("entryPoint07"));
    expect(PAYMASTER_ADDRESS).toBe(addr("paymaster"));
    expect(TAPSCORE_ADDRESS).toBe(addr("tapScore"));
    expect(WPEPU_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("every canonical contract address is a registry address, except the unreachable canonical Multicall3", () => {
    const known = new Set<string>();
    for (const k of ["create2Factory", "multicall3", "permit2", "entryPoint06", "entryPoint07", "kernelFactory", "kernelMetaFactory", "ecdsaValidator", "paymaster", "paymasterV1", "paymasterV2", "kernelImplementation", "kernelEcdsaSignerModule", "kernelCallPolicyV004", "kernelTimestampPolicy", "tapScore"] as const) {
      known.add(addr(k).toLowerCase());
    }
    known.add(WPEPU_ADDRESS.toLowerCase());
    for (const c of CANONICAL_CONTRACTS) {
      const a = (c.pepuAddress ?? c.canonicalAddress).toLowerCase();
      expect(known.has(a), c.name).toBe(true);
    }
  });

  it("includes the Kernel policy modules and reports paymaster v2 as deployed, not pending", () => {
    expect(CANONICAL_CONTRACTS.some((c) => c.name.includes("Call Policy"))).toBe(true);
    expect(CANONICAL_CONTRACTS.some((c) => c.name.includes("Timestamp Policy"))).toBe(true);
    expect(listPendingMainnetContracts().some((p) => p.key === "paymasterV2")).toBe(false);
  });

  it("constants.ts has no address literal in code lines (prose notes are exempt)", () => {
    const lines = fs.readFileSync(path.join(root, "src", "constants.ts"), "utf8").split("\n");
    const bad = lines.filter((l) => /(canonicalAddress|pepuAddress|_ADDRESS\s*=)/.test(l) && /"0x[0-9a-fA-F]{40}"/.test(l));
    // The canonical Multicall3 address is the one deliberate literal: it is the trap, not a registry value.
    expect(bad.filter((l) => !l.includes("0xcA11bde05977b3631167028862bE2a173976CA11"))).toEqual([]);
  });
});

describe("versions and snapshots", () => {
  it("server.json, package.json and SERVER_VERSION agree", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
    const server = JSON.parse(fs.readFileSync(path.join(root, "server.json"), "utf8")) as { version: string; packages: { version: string }[] };
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0]?.version).toBe(pkg.version);
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(pkg.version).toBe("0.2.5");
  });

  it("the templates snapshot equals create-pepu-app templates.json", () => {
    const src = path.join(repo, "packages", "create-pepu-app", "src", "templates.json");
    if (!fs.existsSync(src)) return;
    expect(TEMPLATE_REGISTRY).toEqual(JSON.parse(fs.readFileSync(src, "utf8")));
  });

  it("the docs snapshot covers every markdown page in docs/", () => {
    const docs = path.join(repo, "docs");
    if (!fs.existsSync(docs)) return;
    const count = (dir: string): number =>
      fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : e.name.endsWith(".md") ? 1 : 0), 0);
    expect(DOC_PAGES.length).toBe(count(docs));
  });
});
