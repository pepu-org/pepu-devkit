import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";

// Importing the pure helpers must never reach the optional @zerodev/* peers.
vi.mock("@zerodev/permissions", () => {
  throw new Error("pure scope helpers must not import @zerodev/permissions");
});
vi.mock("@zerodev/sdk", () => {
  throw new Error("pure scope helpers must not import @zerodev/sdk");
});

import * as session from "../src/session/index.js";
import { checkApproval, describeKernelSessionScope, isCallInScope, parseApproval } from "../src/session/scope.js";

const TAP = "0x261eA5971B93237a56990206A46Bc80318e4d078" as Address;
const KERNEL = "0x1d9a59701E5bd3A10244D94ec398eed997Ba4264" as Address;
const tapAbi = [{ type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;

describe("session/scope (no zerodev)", () => {
  it("describes the scope and checks calls", () => {
    const scope = describeKernelSessionScope({ calls: [{ target: TAP, abi: tapAbi, functionName: "tap" }], validUntil: 100 });
    expect(scope.calls[0]?.signature).toBe("tap()");
    const data = scope.calls[0]?.selector ?? "0x";
    expect(isCallInScope(scope, { to: TAP, data })).toBe(true);
    expect(isCallInScope(scope, { to: KERNEL, data })).toBe(false);
    expect(isCallInScope(scope, { to: TAP, data, value: 1n })).toBe(false);
  });

  it("rejects an invalid target", () => {
    expect(() => describeKernelSessionScope({ calls: [{ target: "0x1" as Address, abi: tapAbi, functionName: "tap" }], validUntil: 1 })).toThrow();
  });

  it("parses and checks approvals", () => {
    const approval = Buffer.from(
      JSON.stringify({ permissionParams: { permissionId: "0xb5018da6" }, accountParams: { accountAddress: KERNEL }, isPreInstalled: false }),
    ).toString("base64");
    expect(parseApproval(approval)?.permissionId).toBe("0xb5018da6");
    expect(parseApproval("not base64 json")).toBeNull();
    expect(checkApproval(approval, { kernelAddress: KERNEL, permissionId: "0xb5018da6" })).toEqual({ ok: true });
    expect(checkApproval(approval, { kernelAddress: KERNEL, permissionId: "0xdeadbeef" }).ok).toBe(false);
  });

  it("is available from the /session entry too", () => {
    expect(session.describeKernelSessionScope).toBe(describeKernelSessionScope);
    expect(session.isCallInScope).toBe(isCallInScope);
    expect(session.parseApproval).toBe(parseApproval);
    expect(session.checkApproval).toBe(checkApproval);
  });
});
