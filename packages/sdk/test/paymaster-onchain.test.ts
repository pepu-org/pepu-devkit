import { decodeFunctionData, keccak256, stringToBytes } from "viem";
import type { Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import { PepuConfigError, PepuPaymasterError } from "../src/errors.js";
import { pepuSponsoredPaymasterV2Abi as abi } from "../src/paymaster/abi.js";
import {
  computeProjectId,
  configureProject,
  depositFor,
  encodeAcceptProjectOwnership,
  encodeCancelReclaim,
  encodeClaimFromVerification,
  encodeClaimProject,
  encodeDeposit,
  encodeExecuteReclaim,
  encodeProposeProjectOwner,
  encodeReclaimProject,
  encodeSetDailyLimit,
  encodeSetPaused,
  encodeSetSenderDailyLimit,
  encodeSetTargets,
  getProjectId,
  readProject,
  resolvePaymasterV2Address,
  sendPaymasterCalls,
} from "../src/paymaster/onchain.js";

const PM: Address = "0x1111111111111111111111111111111111111111";
const OWNER: Address = "0x2222222222222222222222222222222222222222";
const TARGET: Address = "0x3333333333333333333333333333333333333333";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const APP = "clx0example0app0id";
const ID = keccak256(stringToBytes(APP));
const att = {
  appId: APP,
  newOwner: OWNER,
  nonce: "12345",
  deadline: "1900000000",
  signature: "0xabcdef" as Hex,
};

describe("computeProjectId", () => {
  it("is keccak256(bytes(appId)) and case-sensitive", () => {
    expect(computeProjectId(APP)).toBe(ID);
    expect(getProjectId(APP)).toBe(ID);
    expect(computeProjectId(APP.toUpperCase())).not.toBe(ID);
  });
  it("rejects empty and over-long ids", () => {
    expect(() => computeProjectId("")).toThrow(PepuPaymasterError);
    expect(() => computeProjectId("a".repeat(129))).toThrow(PepuPaymasterError);
  });
});

describe("resolvePaymasterV2Address", () => {
  it("defaults to the deployed v2 paymaster from the registry", () => {
    expect(resolvePaymasterV2Address()).toBe("0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
  });
  it("uses an explicit address and rejects garbage", () => {
    expect(resolvePaymasterV2Address(PM)).toBe(PM);
    expect(() => resolvePaymasterV2Address("0x12" as Address)).toThrow(PepuConfigError);
  });
  it("encoders target the registry paymaster without an explicit address", () => {
    expect(encodeDeposit(ID, 1n).to).toBe("0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
    expect(encodeSetPaused(ID, true).to).toBe("0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
  });
});

describe("encoders", () => {
  it("encodeDeposit builds depositFor with value", () => {
    const tx = encodeDeposit(ID, 5n, { paymaster: PM });
    expect(tx.to).toBe(PM);
    expect(tx.value).toBe(5n);
    expect(decodeFunctionData({ abi, data: tx.data })).toMatchObject({ functionName: "depositFor", args: [ID] });
  });
  it("encodeDeposit validates amount and id", () => {
    expect(() => encodeDeposit(ID, 0n, { paymaster: PM })).toThrow(PepuPaymasterError);
    expect(() => encodeDeposit(ID, 1n << 128n, { paymaster: PM })).toThrow(PepuPaymasterError);
    expect(() => encodeDeposit("0x12", 1n, { paymaster: PM })).toThrow(PepuPaymasterError);
  });
  it("encodeClaimProject and reclaim pass the attestation struct", () => {
    for (const [fn, enc] of [
      ["claimProject", encodeClaimProject],
      ["reclaimProject", encodeReclaimProject],
    ] as const) {
      const tx = enc(att, { paymaster: PM });
      expect(tx.value).toBe(0n);
      const d = decodeFunctionData({ abi, data: tx.data });
      expect(d.functionName).toBe(fn);
      const c = (d.args as readonly [{ appId: string; newOwner: Address; nonce: bigint; deadline: bigint; signature: Hex }])[0];
      expect(c).toMatchObject({ appId: APP, newOwner: OWNER, nonce: 12345n, deadline: 1900000000n, signature: "0xabcdef" });
    }
  });
  it("encodeClaimFromVerification follows the action", () => {
    const c = encodeClaimFromVerification({ action: "claimProject", attestation: att }, { paymaster: PM });
    const r = encodeClaimFromVerification({ action: "reclaimProject", attestation: att }, { paymaster: PM });
    expect(decodeFunctionData({ abi, data: c.data }).functionName).toBe("claimProject");
    expect(decodeFunctionData({ abi, data: r.data }).functionName).toBe("reclaimProject");
  });
  it("rejects a malformed attestation", () => {
    expect(() => encodeClaimProject({ ...att, newOwner: "0x1" as Address }, { paymaster: PM })).toThrow(PepuPaymasterError);
    expect(() => encodeClaimProject({ ...att, signature: "nope" as Hex }, { paymaster: PM })).toThrow(PepuPaymasterError);
  });
  it("encodes reclaim lifecycle, config, pause and ownership calls", () => {
    const o = { paymaster: PM };
    const cases: [string, Hex][] = [
      ["executeReclaim", encodeExecuteReclaim(ID, o).data],
      ["cancelReclaim", encodeCancelReclaim(ID, o).data],
      ["setTargets", encodeSetTargets(ID, [TARGET], true, o).data],
      ["setDailyLimit", encodeSetDailyLimit(ID, 7n, o).data],
      ["setSenderDailyLimit", encodeSetSenderDailyLimit(ID, 3n, o).data],
      ["setPaused", encodeSetPaused(ID, true, o).data],
      ["proposeProjectOwner", encodeProposeProjectOwner(ID, OWNER, o).data],
      ["acceptProjectOwnership", encodeAcceptProjectOwnership(ID, o).data],
    ];
    for (const [name, data] of cases) expect(decodeFunctionData({ abi, data }).functionName).toBe(name);
  });
  it("validates targets and limits", () => {
    const o = { paymaster: PM };
    expect(() => encodeSetTargets(ID, [], true, o)).toThrow(PepuPaymasterError);
    expect(() => encodeSetTargets(ID, Array(51).fill(TARGET) as Address[], true, o)).toThrow(PepuPaymasterError);
    expect(() => encodeSetTargets(ID, ["0x1" as Address], true, o)).toThrow(PepuPaymasterError);
    expect(() => encodeSetDailyLimit(ID, 0n, o)).toThrow(PepuPaymasterError);
    expect(() => encodeSetSenderDailyLimit(ID, 1n << 112n, o)).toThrow(PepuPaymasterError);
    expect(() => encodeProposeProjectOwner(ID, ZERO, o)).toThrow(PepuPaymasterError);
  });
});

describe("configureProject", () => {
  it("returns the three post-claim calls in order, from appId or projectId", () => {
    const r = configureProject({
      appId: APP,
      paymaster: PM,
      targets: [TARGET],
      dailyLimitWei: 100n,
      senderDailyLimitWei: 10n,
    });
    expect(r.projectId).toBe(ID);
    expect(r.calls.map((c) => decodeFunctionData({ abi, data: c.data }).functionName)).toEqual([
      "setTargets",
      "setDailyLimit",
      "setSenderDailyLimit",
    ]);
    expect(decodeFunctionData({ abi, data: r.calls[0]!.data }).args).toEqual([ID, [TARGET], true]);
    expect(r.calls.every((c) => c.to === PM && c.value === 0n)).toBe(true);
    const byId = configureProject({ projectId: ID, paymaster: PM, targets: [TARGET], dailyLimitWei: 1n, senderDailyLimitWei: 1n });
    expect(byId.projectId).toBe(ID);
  });
  it("needs exactly one of appId or projectId", () => {
    const base = { paymaster: PM, targets: [TARGET], dailyLimitWei: 1n, senderDailyLimitWei: 1n };
    expect(() => configureProject(base)).toThrow(PepuPaymasterError);
    expect(() => configureProject({ ...base, appId: APP, projectId: ID })).toThrow(PepuPaymasterError);
  });
});

type ProjectTuple = readonly [Address, boolean, bigint, bigint, bigint, bigint, number];
function fakeClient(project: ProjectTuple, opts: { reclaim?: readonly [Address, number, Address]; pending?: Address } = {}) {
  const readContract = vi.fn(async (a: { functionName: string; args: readonly unknown[] }) => {
    switch (a.functionName) {
      case "getProject":
        return project;
      case "pendingReclaim":
        return opts.reclaim ?? [ZERO, 0, ZERO];
      case "pendingProjectOwner":
        return opts.pending ?? ZERO;
      case "isTargetAllowed":
        return a.args[1] === TARGET;
      default:
        throw new Error(`unexpected ${a.functionName}`);
    }
  });
  return { readContract } as unknown as Parameters<typeof readProject>[0];
}

describe("readProject", () => {
  const today = 20_000;
  const now = () => (today * 86_400 + 5) * 1000;

  it("reads a claimed, configured project", async () => {
    const c = fakeClient([OWNER, false, 10n, 1000n, 100n, 40n, today]);
    const p = await readProject(c, ID, { paymaster: PM, now, checkTargets: [TARGET, OWNER] });
    expect(p).toMatchObject({
      owner: OWNER,
      claimed: true,
      paused: false,
      balance: 1000n,
      dailyLimit: 100n,
      senderDailyLimit: 10n,
      spentToday: 40n,
      limitsConfigured: true,
      pendingReclaim: null,
      pendingOwner: null,
    });
    expect(p.targetsAllowed).toEqual({ [TARGET]: true, [OWNER]: false });
  });
  it("reports unclaimed projects with balance and no owner", async () => {
    const p = await readProject(fakeClient([ZERO, false, 0n, 500n, 0n, 0n, 0]), ID, { paymaster: PM, now });
    expect(p.owner).toBeNull();
    expect(p.claimed).toBe(false);
    expect(p.limitsConfigured).toBe(false);
    expect(p.balance).toBe(500n);
  });
  it("zeroes spentToday on a stale day and reports pending reclaim and owner", async () => {
    const c = fakeClient([OWNER, true, 10n, 1000n, 100n, 99n, today - 1], {
      reclaim: [TARGET, 1_900_000_000, PM],
      pending: PM,
    });
    const p = await readProject(c, ID, { paymaster: PM, now });
    expect(p.spentToday).toBe(0n);
    expect(p.paused).toBe(true);
    expect(p.pendingReclaim).toEqual({ newOwner: TARGET, executableAt: 1_900_000_000, signer: PM });
    expect(p.pendingOwner).toBe(PM);
  });
  it("reports a pending FIRST claim of a funded project: no owner yet, pendingReclaim set (review 3, M-1)", async () => {
    const c = fakeClient([ZERO, false, 0n, 500n, 0n, 0n, 0], { reclaim: [OWNER, 1_900_000_000, PM] });
    const p = await readProject(c, ID, { paymaster: PM, now });
    expect(p.claimed).toBe(false);
    expect(p.owner).toBeNull();
    expect(p.balance).toBe(500n);
    expect(p.pendingReclaim).toEqual({ newOwner: OWNER, executableAt: 1_900_000_000, signer: PM });
  });
  it("reads the registry paymaster without an address", async () => {
    const p = await readProject(fakeClient([ZERO, false, 0n, 0n, 0n, 0n, 0]), ID);
    expect(p.paymaster).toBe("0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
  });
});

describe("sendPaymasterCalls and depositFor", () => {
  const account = { address: OWNER, type: "json-rpc" } as const;
  function wallet() {
    const sendTransaction = vi.fn(async (_args: unknown) => `0x${"ab".repeat(32)}` as Hex);
    return { account, chain: undefined, sendTransaction } as unknown as Parameters<typeof sendPaymasterCalls>[0] & {
      sendTransaction: typeof sendTransaction;
    };
  }
  const configCalls = () =>
    configureProject({ appId: APP, paymaster: PM, targets: [TARGET], dailyLimitWei: 1n, senderDailyLimitWei: 1n }).calls;

  it("sends each call with exactly its own value", async () => {
    const w = wallet();
    const tx = encodeDeposit(ID, 9n, { paymaster: PM });
    const hashes = await sendPaymasterCalls(w, [tx]);
    expect(hashes).toHaveLength(1);
    expect(w.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: PM, value: 9n, data: tx.data }));
  });
  it("stops when a receipt shows a revert", async () => {
    const w = wallet();
    const publicClient = { waitForTransactionReceipt: vi.fn(async () => ({ status: "reverted" })) } as never;
    await expect(sendPaymasterCalls(w, configCalls(), { publicClient })).rejects.toMatchObject({ code: "TX_REVERTED" });
    expect(w.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("requires an account", async () => {
    const w = { sendTransaction: vi.fn() } as never;
    await expect(sendPaymasterCalls(w, configCalls())).rejects.toBeInstanceOf(PepuConfigError);
  });

  it("depositFor refuses unclaimed projects by default", async () => {
    const w = wallet();
    const publicClient = fakeClient([ZERO, false, 0n, 0n, 0n, 0n, 0]);
    await expect(depositFor({ walletClient: w, publicClient, appId: APP, amountWei: 1n, paymaster: PM })).rejects.toMatchObject({
      code: "PAYMASTER_PROJECT_NOT_CLAIMED",
    });
    expect(w.sendTransaction).not.toHaveBeenCalled();
  });
  it("depositFor needs a publicClient unless requireClaimed is false", async () => {
    const w = wallet();
    await expect(depositFor({ walletClient: w, appId: APP, amountWei: 1n, paymaster: PM })).rejects.toBeInstanceOf(PepuConfigError);
    const hash = await depositFor({ walletClient: w, appId: APP, amountWei: 1n, paymaster: PM, requireClaimed: false });
    expect(hash).toMatch(/^0x/);
    expect(w.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("depositFor sends to a claimed project", async () => {
    const w = wallet();
    const publicClient = fakeClient([OWNER, false, 1n, 0n, 1n, 0n, 0]);
    await depositFor({ walletClient: w, publicClient, projectId: ID, amountWei: 3n, paymaster: PM });
    expect(w.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ value: 3n }));
  });
  it("depositFor needs exactly one of appId or projectId", async () => {
    await expect(depositFor({ walletClient: wallet(), amountWei: 1n, paymaster: PM })).rejects.toBeInstanceOf(PepuPaymasterError);
  });
});
