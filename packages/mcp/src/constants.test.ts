import { describe, expect, it } from "vitest";
import { CANONICAL_CONTRACTS, KNOWN_GOTCHAS, MAINNET, TESTNET, getNetworkInfo } from "./constants.js";

describe("network facts", () => {
  it("mainnet is chain 97741, testnet is 97740 — never confuse with legacy V1 (3409)", () => {
    expect(MAINNET.chainId).toBe(97741);
    expect(TESTNET.chainId).toBe(97740);
    expect(MAINNET.chainId).not.toBe(3409);
  });

  it("getNetworkInfo returns the matching static record", () => {
    expect(getNetworkInfo("mainnet")).toBe(MAINNET);
    expect(getNetworkInfo("testnet")).toBe(TESTNET);
  });

  it("only mainnet has a known Blockscout explorer", () => {
    expect(MAINNET.blockscoutExplorerUrl).toBe("https://pepuscan.com");
    expect(TESTNET.blockscoutExplorerUrl).toBeNull();
  });
});

describe("canonical contract status", () => {
  it("flags Multicall3 as NOT deployed — the single most important fact in this table", () => {
    const multicall3 = CANONICAL_CONTRACTS.find((c) => c.name === "Multicall3");
    expect(multicall3).toBeDefined();
    expect(multicall3?.deployed).toBe(false);
    expect(multicall3?.canonicalAddress).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
  });

  it("flags the CREATE2 deployer as deployed", () => {
    const deployer = CANONICAL_CONTRACTS.find((c) => c.name.includes("CREATE2"));
    expect(deployer?.deployed).toBe(true);
  });

  it("reports both EntryPoint versions as deployed (ZeroDev install, mainnet only)", () => {
    const entryPoints = CANONICAL_CONTRACTS.filter((c) => c.name.startsWith("EntryPoint"));
    expect(entryPoints.length).toBeGreaterThanOrEqual(2);
    for (const ep of entryPoints) {
      expect(ep.deployed).toBe(true);
      // A deployed EntryPoint is not the same as working sponsorship, and
      // an agent reading this must not conflate them.
      expect(ep.note).toMatch(/MAINNET \(97741\) only/);
    }
  });

  it("says sponsorship is hosted by PEPU and needs a project, with v1 marked retired, never one half alone", () => {
    const ep07 = CANONICAL_CONTRACTS.find((c) => c.name === "EntryPoint v0.7");
    expect(ep07?.note).toMatch(/bundler/i);
    expect(ep07?.note).toMatch(/paymaster/i);
    expect(ep07?.note).toMatch(/bundler\.pepeunchained\.com/);
    const gotcha = KNOWN_GOTCHAS.find((g) => /PEPU HOSTS THE BUNDLER/.test(g));
    expect(gotcha).toBeDefined();
    // v1 is retired.
    expect(gotcha).toMatch(/RETIRED/);
    // Token behaviour and stable v2 facts, and nothing about withdrawals being possible.
    expect(gotcha).toMatch(/project_origin_not_allowed/);
    expect(gotcha).toMatch(/100 PEPU\/day and 50 PEPU\/hour/);
    expect(gotcha).toMatch(/[Dd]eposits are one-way/);
    // The stale "has never worked" claim must not come back.
    expect(KNOWN_GOTCHAS.join(" ")).not.toMatch(/ever completed for a real user/);
  });

  it("documents the Privy sign-and-broadcast pattern, the two-address model and the setup gotchas", () => {
    const all = KNOWN_GOTCHAS.join("\n");
    expect(all).toMatch(/eth_signTransaction/);
    expect(all).toMatch(/Unsupported chain with id 97741/);
    expect(all).toMatch(/Two-address model/);
    expect(all).toMatch(/http:\/\/localhost:3000/);
    expect(all).toMatch(/eoaOnly/);
  });

  it("documents self-hosting facts: Alto safe-mode and CORS, duplicate paymaster calls, stub data, error reasons", () => {
    const g = KNOWN_GOTCHAS.find((x) => /SELF-HOSTING THE SPONSORSHIP STACK/.test(x));
    expect(g).toBeDefined();
    expect(g).toMatch(/safe-mode false/);
    expect(g).toMatch(/enable-cors true/);
    expect(g).toMatch(/filtering proxy/);
    expect(g).toMatch(/more than once/);
    expect(g).toMatch(/idempotent by userOpHash/);
    expect(g).toMatch(/unauthenticated/);
    expect(g).toMatch(/data\.reason/);
  });

  it("states the Privy policy name limit precisely as 49, never 'under 50' or 'up to 50'", () => {
    const g = KNOWN_GOTCHAS.find((x) => /PRIVY POLICY NAME LIMIT/.test(x));
    expect(g).toBeDefined();
    expect(g).toMatch(/at most 49 characters/);
    expect(g).toMatch(/50 or more/);
    expect(g).not.toMatch(/up to 50|maximum of 50 characters/i);
  });

  it("explains how to debug denied session-signer transactions", () => {
    const g = KNOWN_GOTCHAS.find((x) => /SESSION SIGNER TRANSACTIONS DENIED/.test(x));
    expect(g).toBeDefined();
    expect(g).toMatch(/eth_signTransaction/);
    expect(g).toMatch(/expired/);
    expect(g).toMatch(/49 characters/);
    expect(g).toMatch(/key quorum/);
    expect(g).toMatch(/removeSigners/);
  });

  it("documents wallet provisioning and active-wallet pinning", () => {
    const g = KNOWN_GOTCHAS.find((x) => /WALLET PROVISIONING AND ACTIVE WALLET/.test(x));
    expect(g).toBeDefined();
    expect(g).toMatch(/Dashboard/);
    expect(g).toMatch(/PRIVY_APP_SECRET/);
    expect(g).toMatch(/useSetActiveWallet/);
    expect(g).toMatch(/browser extension/);
  });

  it("records the scope decisions: no Telegram Mini App template, Global Wallet deferred", () => {
    const g = KNOWN_GOTCHAS.find((x) => /SCOPE DECISIONS/.test(x));
    expect(g).toBeDefined();
    expect(g).toMatch(/Telegram/);
    expect(g).toMatch(/TON/);
    expect(g).toMatch(/Global Wallet/);
    expect(g).toMatch(/deferred/);
  });

  it("describes the v2 paymaster as deployed and v1 as retired", () => {
    const paymaster = CANONICAL_CONTRACTS.find((c) => c.name.includes("Paymaster v2"));
    const v1 = CANONICAL_CONTRACTS.find((c) => c.name.includes("Paymaster v1"));
    expect(v1?.canonicalAddress).toBe("0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0");
    expect(v1?.note).toMatch(/RETIRED/);
    expect(paymaster).toBeDefined();
    expect(paymaster?.deployed).toBe(true);
    expect(paymaster?.canonicalAddress).toBe("0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
    expect(paymaster?.deployedOnTestnet).toBe(false);
    expect(paymaster?.note).toMatch(/hosted policy service/);
    expect(paymaster?.note).toMatch(/Deposits are one-way/);
  });

  it("does not claim Permit2 is undeployed — it is live at the canonical address", () => {
    const permit2 = CANONICAL_CONTRACTS.find((c) => c.name === "Permit2");
    expect(permit2?.deployed).toBe(true);
    expect(permit2?.canonicalAddress).toBe("0x000000000022D473030F116dDEE9F6B43aC78BA3");
  });

  it("points Multicall3 at the PEPU-specific address, never the canonical one", () => {
    const mc = CANONICAL_CONTRACTS.find((c) => c.name === "Multicall3");
    // The canonical address still has no code and never can have any here.
    expect(mc?.deployed).toBe(false);
    expect(mc?.pepuAddress).toBe("0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd");
    expect(mc?.pepuAddress?.toLowerCase()).not.toBe(
      mc?.canonicalAddress.toLowerCase(),
    );
  });
});
