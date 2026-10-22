/**
 * Cross-check of the v2 signed-prefix layout against the Solidity contract's getHash(1, userOp) for a frozen
 * vector. Counterpart: contracts/test/PepuSponsoredHashCrossCheck.t.sol asserts the SAME EXPECTED_GOLDEN_HASH.
 */
import { describe, expect, it } from "vitest";
import { getUserOperationHash } from "viem/account-abstraction";
import { encodeAbiParameters, keccak256, toBytes } from "viem";
import { computeFinalHash, computeUserOpHash } from "../../src/userOpHash.js";
import {
  FREE_POOL_ID,
  SPONSORED_PREFIX_LENGTH,
  buildSponsoredHashPrefix,
  buildSponsoredPaymasterData,
  computeEntryPointUserOpHash,
  projectIdOf,
} from "../../src/sponsorship/paymasterData.js";

const EXPECTED_GOLDEN_HASH = "0x894082470c2e9df7c6c444d50734c8360c7d92510512b57a3e1a16bf07562258";
const SPONSOR = "0x000000000000000000000000000000000000000000000000000000000000abcd" as const;
const PAYMASTER = "0x0000000000000000000000000000000000001234" as const;

const USER_OP = {
  sender: "0x1111111111111111111111111111111111111111",
  nonce: 7n,
  factory: undefined,
  factoryData: undefined,
  callData: "0x1234567890abcdef1234567890abcdef12345678",
  callGasLimit: 222_222n,
  verificationGasLimit: 111_111n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
} as const;

const GAS = {
  paymaster: PAYMASTER,
  paymasterVerificationGasLimit: 3_000_000n,
  paymasterPostOpGasLimit: 1_000_000n,
} as const;
const WINDOW = { validUntil: 2_000_000_000, validAfter: 1_000_000_000 } as const;

describe("v2 paymasterAndData layout", () => {
  const prefix = buildSponsoredHashPrefix(GAS, WINDOW, SPONSOR);

  it("builds a 97-byte signed prefix with mode byte 0x02 and the sponsorId inside it", () => {
    expect((prefix.length - 2) / 2).toBe(SPONSORED_PREFIX_LENGTH);
    expect(prefix.slice(2 + 52 * 2, 2 + 53 * 2)).toBe("02");
    expect(prefix.endsWith(SPONSOR.slice(2))).toBe(true);
  });

  it("matches the Solidity contract's getHash(1, userOp) for the frozen golden vector", () => {
    const userOpHash = computeUserOpHash(USER_OP, prefix);
    expect(computeFinalHash(userOpHash, 31337)).toBe(EXPECTED_GOLDEN_HASH);
  });

  it("changing the sponsorId changes the signed hash (a swapped sponsor invalidates the signature)", () => {
    const other = buildSponsoredHashPrefix(GAS, WINDOW, FREE_POOL_ID);
    expect(computeFinalHash(computeUserOpHash(USER_OP, other), 31337)).not.toBe(EXPECTED_GOLDEN_HASH);
  });

  it("paymasterData = mode|validUntil|validAfter|sponsorId|signature", () => {
    const sig = `0x${"ab".repeat(65)}` as const;
    const data = buildSponsoredPaymasterData(WINDOW, SPONSOR, sig);
    expect(data).toBe(`0x02${"77359400".padStart(12, "0")}${"3b9aca00".padStart(12, "0")}${SPONSOR.slice(2)}${sig.slice(2)}`);
    expect(() => buildSponsoredPaymasterData(WINDOW, SPONSOR, "0x1234")).toThrow();
    expect(() => buildSponsoredPaymasterData(WINDOW, "0x12", sig)).toThrow();
  });

  it("projectIdOf is keccak256(bytes(appId)): one canonical project per Privy app id", () => {
    expect(projectIdOf("cm-app-a")).toBe(keccak256(toBytes("cm-app-a")));
    expect(projectIdOf("cm-app-a")).not.toBe(projectIdOf("cm-app-b"));
  });

  it("EntryPoint userOpHash includes the full paymasterAndData (signature too) and equals viem's v0.7 hash", () => {
    const common = {
      userOp: USER_OP,
      paymaster: PAYMASTER,
      paymasterVerificationGasLimit: 3_000_000n,
      paymasterPostOpGasLimit: 1_000_000n,
      entryPointAddress: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      chainId: 97741,
    } as const;
    const sigA = `0x${"aa".repeat(65)}` as const;
    const sigB = `0x${"bb".repeat(65)}` as const;
    const dataA = buildSponsoredPaymasterData({ validUntil: 10, validAfter: 1 }, SPONSOR, sigA);
    const dataB = buildSponsoredPaymasterData({ validUntil: 10, validAfter: 1 }, SPONSOR, sigB);
    const hA = computeEntryPointUserOpHash({ ...common, paymasterData: dataA });
    const hB = computeEntryPointUserOpHash({ ...common, paymasterData: dataB });
    expect(hA).not.toBe(hB);
    const viemHash = getUserOperationHash({
      chainId: 97741,
      entryPointAddress: common.entryPointAddress,
      entryPointVersion: "0.7",
      userOperation: {
        ...USER_OP,
        paymaster: PAYMASTER,
        paymasterData: dataA,
        paymasterVerificationGasLimit: 3_000_000n,
        paymasterPostOpGasLimit: 1_000_000n,
        signature: "0x",
      },
    });
    expect(hA).toBe(viemHash);
  });
});

describe("mode byte (delta review M1)", () => {
  it("the encoder emits ONLY modeByte 0x02 (allowAllBundlers = 0); the contract rejects every other byte", () => {
    const sig = `0x${"11".repeat(65)}` as const;
    const w = { validUntil: 2_000_000_000, validAfter: 1_000_000_000 };
    const prefix = buildSponsoredHashPrefix({ paymaster: PAYMASTER, paymasterVerificationGasLimit: 1n, paymasterPostOpGasLimit: 1n }, w, SPONSOR);
    expect(prefix.slice(2 + 2 * 52, 2 + 2 * 53)).toBe("02");
    expect(buildSponsoredPaymasterData(w, SPONSOR, sig).slice(2, 4)).toBe("02");
  });
});
