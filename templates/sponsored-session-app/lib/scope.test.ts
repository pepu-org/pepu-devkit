import { describeKernelSessionScope, isCallInScope } from "@pepu-chain/sdk/session/kernel";
import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { scope, TAPSCORE_ADDRESS } from "./scope";
import { tapScoreAbi } from "./tapscore";

describe("the template's session scope", () => {
  const described = describeKernelSessionScope({ calls: scope.calls, validUntil: 1_000 });

  it("is one function on TapScore with zero value, from the SDK registry", () => {
    expect(TAPSCORE_ADDRESS).toBe("0x261eA5971B93237a56990206A46Bc80318e4d078");
    expect(described.calls).toEqual([
      {
        target: TAPSCORE_ADDRESS,
        functionName: "tap",
        signature: "tap()",
        selector: "0xfd221031",
        maxValueWei: "0",
      },
    ]);
  });

  it("allows tap() and nothing else on the same contract", () => {
    const tap = { to: TAPSCORE_ADDRESS, data: encodeFunctionData({ abi: tapScoreAbi, functionName: "tap" }) };
    const scores = {
      to: TAPSCORE_ADDRESS,
      data: encodeFunctionData({ abi: tapScoreAbi, functionName: "scores", args: [TAPSCORE_ADDRESS] }),
    };
    expect(isCallInScope(described, tap)).toBe(true);
    expect(isCallInScope(described, { ...tap, value: 1n })).toBe(false);
    expect(isCallInScope(described, scores)).toBe(false);
  });
});
