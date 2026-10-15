import { toFunctionSelector } from "viem";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import {
  CALL_POLICY_V0_0_4_ADDRESS,
  SESSION_GAS_RESERVATION_PEPU,
  TIMESTAMP_POLICY_ADDRESS,
  buildKernelSessionPolicies,
  checkApproval,
  createMemoryStore,
  describeKernelSessionScope,
  generateSessionKey,
  isCallInScope,
  isLive,
  parseApproval,
} from "../src/session/kernel.js";
import type { SessionRecord } from "../src/session/kernel.js";

// Ported from templates/sponsored-session-app/lib/{approval,session-policy,session-store}.test.ts.

const TAPSCORE = "0x261eA5971B93237a56990206A46Bc80318e4d078" as Address;
const tapAbi = [
  { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "scores",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
const calls = [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }];
const TAP_SELECTOR = "0xfd221031";

type CallParams = {
  type: "call";
  policyVersion: string;
  permissions: { target: string; valueLimit: string | bigint; selector: string; functionName: string; rules: unknown[] }[];
};
type TimestampParams = { type: "timestamp"; validAfter: number; validUntil: number };

describe("buildKernelSessionPolicies", () => {
  const policies = buildKernelSessionPolicies({ calls, validUntil: 1_900 });

  it("has exactly a call policy and a timestamp policy", () => {
    expect(policies.map((p) => p.policyParams.type)).toEqual(["call", "timestamp"]);
  });

  it("pins call policy v0.0.4 (v0.0.5 is not deployed on PEPU)", () => {
    const params = policies[0]?.policyParams as unknown as CallParams;
    expect(params.policyVersion).toBe("0.0.4");
    expect(policies[0]?.getPolicyInfoInBytes().toLowerCase()).toContain(
      CALL_POLICY_V0_0_4_ADDRESS.slice(2).toLowerCase(),
    );
    expect(policies[1]?.getPolicyInfoInBytes().toLowerCase()).toContain(
      TIMESTAMP_POLICY_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it("call policy allows one target, one selector, zero value, no argument rules", () => {
    const params = policies[0]?.policyParams as unknown as CallParams;
    expect(params.permissions).toHaveLength(1);
    const permission = params.permissions[0];
    expect(permission?.target.toLowerCase()).toBe(TAPSCORE.toLowerCase());
    expect(permission?.selector).toBe(TAP_SELECTOR);
    expect(String(permission?.valueLimit)).toBe("0");
    expect(permission?.rules).toEqual([]);
  });

  it("only the named function fragment goes into the policy (scores is not allowed)", () => {
    const params = policies[0]?.policyParams as unknown as CallParams;
    expect(params.permissions.map((p) => p.functionName)).toEqual(["tap"]);
  });

  it("timestamp policy expires at validUntil and honours validAfter", () => {
    const params = policies[1]?.policyParams as unknown as TimestampParams;
    expect(params).toMatchObject({ validUntil: 1_900, validAfter: 0 });
    const later = buildKernelSessionPolicies({ calls, validUntil: 9, validAfter: 5 })[1]
      ?.policyParams as unknown as TimestampParams;
    expect(later).toMatchObject({ validUntil: 9, validAfter: 5 });
  });

  it("supports several calls and a value limit", () => {
    const p = buildKernelSessionPolicies({
      calls: [...calls, { target: TAPSCORE, abi: tapAbi, functionName: "scores", valueLimit: 7n }],
      validUntil: 1,
    });
    const params = p[0]?.policyParams as unknown as CallParams;
    expect(params.permissions).toHaveLength(2);
    expect(String(params.permissions[1]?.valueLimit)).toBe("7");
  });

  it("is deterministic", () => {
    const a = buildKernelSessionPolicies({ calls, validUntil: 1_900 });
    const b = buildKernelSessionPolicies({ calls, validUntil: 1_900 });
    expect(a.map((p) => p.getPolicyInfoInBytes())).toEqual(b.map((p) => p.getPolicyInfoInBytes()));
  });

  it("rejects empty scope, bad target and unknown function", () => {
    expect(() => buildKernelSessionPolicies({ calls: [], validUntil: 1 })).toThrow(/at least one/);
    expect(() =>
      buildKernelSessionPolicies({ calls: [{ target: "0x12" as Address, abi: tapAbi, functionName: "tap" }], validUntil: 1 }),
    ).toThrow(/valid 0x target/);
    expect(() =>
      buildKernelSessionPolicies({ calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "nope" }], validUntil: 1 }),
    ).toThrow(/no function named/);
  });
});

describe("describeKernelSessionScope and isCallInScope", () => {
  it("mirrors the policy for the consent screen", () => {
    expect(describeKernelSessionScope({ calls, validUntil: 1_900 })).toEqual({
      calls: [{ target: TAPSCORE, functionName: "tap", signature: "tap()", selector: TAP_SELECTOR, maxValueWei: "0" }],
      validAfter: 0,
      validUntil: 1_900,
    });
    expect(TAP_SELECTOR).toBe(toFunctionSelector("tap()"));
  });

  it("accepts only the allowed target, selector and value", () => {
    const scope = describeKernelSessionScope({ calls, validUntil: 1 });
    expect(isCallInScope(scope, { to: TAPSCORE, data: TAP_SELECTOR })).toBe(true);
    expect(isCallInScope(scope, { to: TAPSCORE.toLowerCase() as Address, data: TAP_SELECTOR })).toBe(true);
    expect(isCallInScope(scope, { to: TAPSCORE, data: "0x70a08231" })).toBe(false);
    expect(isCallInScope(scope, { to: "0x0000000000000000000000000000000000000001", data: TAP_SELECTOR })).toBe(false);
    expect(isCallInScope(scope, { to: TAPSCORE, data: TAP_SELECTOR, value: 1n })).toBe(false);
  });
});

describe("generateSessionKey", () => {
  it("returns a key and its address", () => {
    const a = generateSessionKey();
    expect(a.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(generateSessionKey().privateKey).not.toBe(a.privateKey);
  });
});

const kernel = "0x1d9a59701E5bd3A10244D94ec398eed997Ba4264" as const;
const expected = { kernelAddress: kernel, permissionId: "0xb5018da6" };
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const approval = (overrides: Record<string, unknown> = {}): string =>
  encode({
    permissionParams: { permissionId: "0xb5018da6", policies: [] },
    accountParams: { accountAddress: kernel, initCode: "0x" },
    enableSignature: "0x00",
    isPreInstalled: false,
    ...overrides,
  });

describe("parseApproval and checkApproval", () => {
  it("rejects garbage", () => {
    expect(parseApproval("not base64 json!!")).toBeNull();
    expect(parseApproval(encode("a string"))).toBeNull();
  });

  it("accepts an approval for this account, scope and key", () => {
    expect(checkApproval(approval(), expected)).toEqual({ ok: true });
  });

  it("is case-insensitive on addresses and ids", () => {
    const lower = approval({
      accountParams: { accountAddress: kernel.toLowerCase(), initCode: "0x" },
      permissionParams: { permissionId: "0xB5018DA6" },
    });
    expect(checkApproval(lower, expected)).toEqual({ ok: true });
  });

  it("rejects an approval that carries a private key, without echoing it", () => {
    const secret = `0x${"11".repeat(32)}`;
    const result = checkApproval(approval({ privateKey: secret }), expected);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects a different smart account", () => {
    const other = approval({
      accountParams: { accountAddress: "0x000000000000000000000000000000000000dEaD", initCode: "0x" },
    });
    expect(checkApproval(other, expected)).toMatchObject({ ok: false });
  });

  it("rejects a different scope, key or expiry (permission id mismatch)", () => {
    expect(checkApproval(approval({ permissionParams: { permissionId: "0xdeadbeef" } }), expected)).toMatchObject({
      ok: false,
    });
  });

  it("rejects a pre-installed (non enable-mode) approval", () => {
    expect(checkApproval(approval({ isPreInstalled: true }), expected)).toMatchObject({ ok: false });
  });

  it("rejects empty and oversized input", () => {
    expect(checkApproval("", expected)).toMatchObject({ ok: false });
    expect(checkApproval("A".repeat(20_001), expected)).toMatchObject({ ok: false });
  });
});

const record: SessionRecord = {
  userId: "did:privy:abc",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  kernelAddress: "0x0000000000000000000000000000000000000002",
  sessionPrivateKey: `0x${"22".repeat(32)}`,
  sessionKeyAddress: "0x0000000000000000000000000000000000000003",
  permissionId: "0xb5018da6",
  validUntil: 1_000,
  approval: "approval",
  actions: 0,
};

describe("session store", () => {
  it("stores, reads and deletes by user", async () => {
    const store = createMemoryStore();
    expect(await store.get(record.userId)).toBeUndefined();
    await store.set(record);
    expect(await store.get(record.userId)).toEqual(record);
    await store.delete(record.userId);
    expect(await store.get(record.userId)).toBeUndefined();
  });

  it("allows one action at a time per user", async () => {
    const store = createMemoryStore();
    expect(await store.tryLock("a")).toBe(true);
    expect(await store.tryLock("a")).toBe(false);
    expect(await store.tryLock("b")).toBe(true);
    await store.unlock("a");
    expect(await store.tryLock("a")).toBe(true);
  });

  it("isLive is true only with an approval and before expiry", () => {
    expect(isLive(record, 999)).toBe(true);
    expect(isLive(record, 1_000)).toBe(false);
    expect(isLive({ ...record, approval: null }, 0)).toBe(false);
  });
});

describe("constants", () => {
  it("documents the measured gas reservations", () => {
    expect(SESSION_GAS_RESERVATION_PEPU).toEqual({ firstOperation: 20.5, laterOperation: 6.9 });
  });
});
