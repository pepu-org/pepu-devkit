import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, hashTypedData, type PublicClient } from "viem";

import { multicall3Abi } from "../src/abi/multicall3.js";
import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import { getContract, getPepuAddressMap, getPepuAddresses, isDeployed } from "../src/contracts.js";
import { PepuError } from "../src/errors.js";
import { explorerLinks } from "../src/explorer.js";
import {
  assertNotCanonicalMulticall3,
  decodeAggregate3Result,
  encodeAggregate3,
  getMulticall3,
  pepuMulticall,
} from "../src/multicall.js";
import {
  buildPermitSingleTypedData,
  buildPermitTransferFromTypedData,
  getPermit2,
  permit2Domain,
  readPermit2Allowance,
} from "../src/permit2.js";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;

describe("registry address pins (verified via eth_getCode 2026-10-02)", () => {
  const pins = {
    create2Factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    multicall3: "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    entryPoint06: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
    entryPoint07: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    kernelFactory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
    kernelMetaFactory: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
    ecdsaValidator: "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57",
    kernelImplementation: "0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d",
    kernelEcdsaSignerModule: "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF",
    kernelCallPolicyV004: "0x9a52283276A0ec8740DF50bF01B28A80D880eaf2",
    kernelTimestampPolicy: "0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F",
    tapScore: "0x261eA5971B93237a56990206A46Bc80318e4d078",
    paymasterV1: "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0",
  } as const;

  const v2 = { paymaster: "0xdb28528C9399C33c9A0297E8A62F39145acbC30D", paymasterV2: "0xdb28528C9399C33c9A0297E8A62F39145acbC30D" } as const;

  for (const [key, addr] of Object.entries(v2)) {
    it(`${key} is the v2 canary, verified 2026-10-14`, () => {
      const e = getContract(pepuMainnet.id, key as keyof typeof v2);
      expect(isDeployed(e) && e.address).toBe(addr);
      expect(isDeployed(e) && e.verifiedAt).toBe("2026-10-14");
    });
  }

  for (const [key, addr] of Object.entries(pins)) {
    it(`${key} is pinned`, () => {
      const e = getContract(pepuMainnet.id, key as keyof typeof pins);
      expect(isDeployed(e) && e.address).toBe(addr);
      expect(isDeployed(e) && e.verifiedAt).toBe("2026-10-02");
    });
  }

  it("paymasterV2 is pending on testnet with no address", () => {
    const e = getContract(pepuTestnet.id, "paymasterV2");
    expect(e?.status).toBe("pending");
    expect(e && "address" in e).toBe(false);
  });

  it("getPepuAddressMap keys the same rows by contract name", () => {
    const rows = getPepuAddresses();
    expect(Array.isArray(rows)).toBe(true);
    const map = getPepuAddressMap();
    expect(Object.keys(map).sort()).toEqual(rows.map((r) => r.key).sort());
    expect(map.paymaster).toEqual(rows.find((r) => r.key === "paymaster"));
    expect(getPepuAddressMap(1)).toEqual({});
  });

  it("getPepuAddresses renders the table", () => {
    const rows = getPepuAddresses();
    expect(rows).toHaveLength(16);
    expect(rows.find((r) => r.key === "tapScore")?.address).toBe(pins.tapScore);
    expect(rows.find((r) => r.key === "paymasterV2")?.address).toBe(v2.paymasterV2);
    expect(rows.find((r) => r.key === "paymasterV1")?.retired).toBe(true);
    expect(getPepuAddresses(1)).toEqual([]);
    expect(getPepuAddresses(pepuTestnet.id).every((r) => r.key === "create2Factory" || r.status === "pending")).toBe(true);
  });
});

describe("multicall", () => {
  it("getMulticall3 returns the PEPU address, never canonical", () => {
    expect(getMulticall3().address).toBe("0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd");
  });

  it("throws for a chain without it", () => {
    expect(() => getMulticall3(pepuTestnet.id)).toThrow(PepuError);
  });

  it("guard maps canonical address to MULTICALL3_CANONICAL_ADDRESS", () => {
    for (const addr of [
      "0xcA11bde05977b3631167028862bE2a173976CA11",
      "0xca11bde05977b3631167028862be2a173976ca11",
    ] as const) {
      try {
        assertNotCanonicalMulticall3(addr);
        expect.unreachable();
      } catch (e) {
        expect((e as PepuError).code).toBe("MULTICALL3_CANONICAL_ADDRESS");
      }
    }
  });

  it("pepuMulticall passes the PEPU multicallAddress", async () => {
    const multicall = vi.fn().mockResolvedValue([{ status: "success", result: 1n }]);
    const client = { chain: pepuMainnet, multicall } as unknown as PublicClient;
    const out = await pepuMulticall(client, [], { blockNumber: 5n });
    expect(out).toEqual([{ status: "success", result: 1n }]);
    expect(multicall.mock.calls[0]?.[0]).toMatchObject({
      multicallAddress: "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd",
      allowFailure: true,
      blockNumber: 5n,
    });
  });

  it("encodes and decodes aggregate3", () => {
    const data = encodeAggregate3([{ target: A, callData: "0x18160ddd" }]);
    const dec = decodeFunctionData({ abi: multicall3Abi, data });
    expect(dec.functionName).toBe("aggregate3");
    expect(dec.args?.[0]).toEqual([{ target: A, allowFailure: false, callData: "0x18160ddd" }]);
  });

  it("decodeAggregate3Result round-trips", async () => {
    const { encodeFunctionResult } = await import("viem");
    const data = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [{ success: true, returnData: "0x01" }, { success: false, returnData: "0x" }],
    });
    expect(decodeAggregate3Result(data)).toEqual([
      { success: true, returnData: "0x01" },
      { success: false, returnData: "0x" },
    ]);
  });

  it("never leaks a secret-looking input into error messages", () => {
    const secret = "sk_live_SECRET123";
    try {
      getMulticall3(secret as unknown as number);
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET123");
    }
  });
});

describe("permit2", () => {
  it("is the canonical address", () => {
    expect(getPermit2().address).toBe("0x000000000022D473030F116dDEE9F6B43aC78BA3");
    expect(permit2Domain()).toEqual({
      name: "Permit2",
      chainId: 97741,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    });
  });

  it("builds hashable PermitSingle typed data", () => {
    const td = buildPermitSingleTypedData({
      token: A, amount: 5n, expiration: 1900000000, nonce: 0, spender: B, sigDeadline: 1900000000n,
    });
    expect(td.primaryType).toBe("PermitSingle");
    expect(hashTypedData(td as never)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("builds hashable PermitTransferFrom typed data", () => {
    const td = buildPermitTransferFromTypedData({
      token: A, amount: 5n, spender: B, nonce: 1n, deadline: 1900000000n,
    });
    expect(td.message.permitted).toEqual({ token: A, amount: 5n });
    expect(hashTypedData(td as never)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("reads allowance from canonical Permit2", async () => {
    const readContract = vi.fn().mockResolvedValue([7n, 99, 3]);
    const client = { chain: pepuMainnet, readContract } as unknown as PublicClient;
    expect(await readPermit2Allowance(client, { owner: A, token: B, spender: A })).toEqual({
      amount: 7n, expiration: 99, nonce: 3,
    });
    expect(readContract.mock.calls[0]?.[0]).toMatchObject({
      address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      functionName: "allowance",
    });
  });
});

describe("explorerLinks", () => {
  it("links tx and sender (no UserOp pages on pepuscan)", () => {
    expect(explorerLinks({ tx: "0xabc", sender: "0xdef", block: 12n })).toEqual({
      tx: "https://pepuscan.com/tx/0xabc",
      sender: "https://pepuscan.com/address/0xdef",
      block: "https://pepuscan.com/block/12",
    });
  });

  it("returns an empty object for no input", () => {
    expect(explorerLinks({})).toEqual({});
  });
});
