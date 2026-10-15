import { describe, expect, it, vi } from "vitest";

import { KERNEL_VERSION, sendSponsored } from "../src/aa/kernel.js";
import { PepuBundlerError } from "../src/errors.js";

const to = "0x0000000000000000000000000000000000000002" as const;

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    account: { encodeCalls: vi.fn(async () => "0xdeadbeef") },
    sendUserOperation: vi.fn(async () => `0x${"11".repeat(32)}`),
    waitForUserOperationReceipt: vi.fn(async () => ({
      success: true,
      paymaster: "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0",
      actualGasCost: 5n,
      receipt: { transactionHash: `0x${"22".repeat(32)}` },
    })),
    ...over,
  };
}

describe("sendSponsored", () => {
  it("encodes, sends, waits and reports who paid", async () => {
    const client = fakeClient();
    const r = await sendSponsored({ client: client as never, calls: [{ to, data: "0x12" }] });
    expect(client.account.encodeCalls).toHaveBeenCalledWith([{ to, value: 0n, data: "0x12" }]);
    expect(r.paymaster).toBe("0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0");
    expect(r.actualGasCostWei).toBe(5n);
    expect(r.success).toBe(true);
    expect(r.explorerUrl).toContain(`0x${"22".repeat(32)}`);
  });

  it("maps failures to typed errors", async () => {
    const client = fakeClient({
      sendUserOperation: vi.fn(async () => {
        throw new Error("AA23 reverted");
      }),
    });
    await expect(sendSponsored({ client: client as never, calls: [{ to }] })).rejects.toBeInstanceOf(PepuBundlerError);
  });

  it("rejects empty calls", async () => {
    await expect(sendSponsored({ client: fakeClient() as never, calls: [] })).rejects.toMatchObject({
      code: "POLICY_UNSCOPED",
    });
  });

  it("uses Kernel v3.1", () => {
    expect(KERNEL_VERSION).toBe("0.3.1");
  });
});
