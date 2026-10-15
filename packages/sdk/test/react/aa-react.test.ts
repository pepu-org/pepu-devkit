// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sendTransaction = vi.fn();
const waitForTransactionReceipt = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => "tok" }),
  useWallets: () => ({
    wallets: [{ walletClientType: "privy", address: "0x00000000000000000000000000000000000000aa", getEthereumProvider: async () => ({}) }],
  }),
}));
vi.mock("@privy-io/react-auth/smart-wallets", () => ({
  useSmartWallets: () => ({
    client: {
      account: { address: "0x00000000000000000000000000000000000000bb" },
      sendTransaction,
    },
    getClientForChain: async () => undefined,
  }),
}));
vi.mock("../../src/client.js", () => ({
  getPublicClient: () => ({ waitForTransactionReceipt }),
}));
vi.mock("../../src/aa/status.js", async (orig) => ({
  ...(await orig<typeof import("../../src/aa/status.js")>()),
  checkSponsorship: vi.fn(async () => ({
    available: true,
    transport: "direct",
    bundler: { configured: true },
    paymaster: { configured: true },
    reason: "ok",
    fixes: [],
  })),
}));

import { usePepuSmartAccount, usePepuSponsorship, useSponsoredSend } from "../../src/aa/react.js";

afterEach(cleanup);

describe("aa/react hooks", () => {
  it("usePepuSmartAccount exposes owner and the provider smart account", () => {
    const { result } = renderHook(() => usePepuSmartAccount());
    expect(result.current.owner).toBe("0x00000000000000000000000000000000000000aa");
    expect(result.current.smartAccount).toBe("0x00000000000000000000000000000000000000bb");
    expect(result.current.ready).toBe(true);
  });

  it("useSponsoredSend (privy-smart-wallets) sends and confirms", async () => {
    sendTransaction.mockResolvedValue(`0x${"ab".repeat(32)}`);
    waitForTransactionReceipt.mockResolvedValue({ status: "success", logs: [] });
    const { result } = renderHook(() => useSponsoredSend());
    expect(result.current.status).toBe("idle");
    await act(async () => {
      await result.current.send([{ to: "0x0000000000000000000000000000000000000002", data: "0x1234" }]);
    });
    expect(result.current.status).toBe("confirmed");
    expect(result.current.result?.success).toBe(true);
    expect(result.current.result?.explorerUrl).toContain(`0x${"ab".repeat(32)}`);
    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ data: "0x1234" }));
  });

  it("useSponsoredSend maps failures to a PepuError and sets status error", async () => {
    sendTransaction.mockRejectedValue(new Error("AA21 didn't pay prefund"));
    const { result } = renderHook(() => useSponsoredSend());
    await act(async () => {
      await expect(
        result.current.send([{ to: "0x0000000000000000000000000000000000000002" }]),
      ).rejects.toMatchObject({ code: "BUNDLER_AA_FAILED" });
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("BUNDLER_AA_FAILED");
  });

  it("usePepuSponsorship loads the live report", async () => {
    const { result } = renderHook(() => usePepuSponsorship({ pollMs: 0 }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.available).toBe(true);
  });
});
