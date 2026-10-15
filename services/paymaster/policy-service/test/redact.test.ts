import { describe, expect, it } from "vitest";
import { createReadinessChecker } from "../src/ready.js";
import { safeErrorMessage } from "../src/redact.js";

const SECRET_URL = "https://rpc.example.org/SUPER-SECRET-PROVIDER-KEY";

describe("safeErrorMessage", () => {
  it("masks URLs (RPC URLs embed provider keys) and keeps only the first line", () => {
    const err = new Error(`HTTP request failed.\n\nURL: ${SECRET_URL}\nDetails: fetch failed`);
    expect(safeErrorMessage(err)).toBe("HTTP request failed.");
    expect(safeErrorMessage(new Error(`connect to ${SECRET_URL} failed`))).toBe("connect to <url> failed");
  });

  it("prefers viem's shortMessage", () => {
    const err = Object.assign(new Error(`long ${SECRET_URL}`), { shortMessage: "short reason" });
    expect(safeErrorMessage(err)).toBe("short reason");
  });

  it("handles non-Error throwables", () => {
    expect(safeErrorMessage("plain string")).toBe("plain string");
  });
});

describe("readiness output", () => {
  it("never contains the RPC URL even when the underlying error quotes it", async () => {
    const check = createReadinessChecker({
      db: { ping: () => undefined },
      chain: {
        getBlockNumber: async () => {
          throw new Error(`HTTP request failed.\nURL: ${SECRET_URL}`);
        },
        getDeposit: async () => 1n,
      },
      paymaster: "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0",
      minDepositWei: 0n,
      maxDepositWei: 0n,
      cacheMs: 0,
    });
    const report = await check();
    expect(JSON.stringify(report)).not.toContain("SUPER-SECRET");
    expect(report.status).toBe("not_ready");
  });
});
