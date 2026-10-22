// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const OWNER = "0x00000000000000000000000000000000000000aa";
const DERIVED = "0x00000000000000000000000000000000000000dd";
const { sendSponsored } = vi.hoisted(() => ({ sendSponsored: vi.fn() }));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => "tok" }),
  useWallets: () => ({
    wallets: [{ walletClientType: "privy", address: OWNER, getEthereumProvider: async () => ({ request: async () => null }) }],
  }),
}));
vi.mock("../../src/client.js", () => ({ getPublicClient: () => ({}) }));
vi.mock("../../src/aa/kernel.js", () => ({
  getKernelAddress: vi.fn(async () => DERIVED),
  toPepuKernelAccount: vi.fn(async () => ({})),
  createPepuSponsoredClient: vi.fn(() => ({})),
  sendSponsored,
}));

import { useDirectSmartAccount, useDirectSponsoredSend } from "../../src/aa/react-direct.js";

afterEach(() => {
  cleanup();
  sendSponsored.mockReset();
});

describe("aa/react-direct hooks", () => {
  it("useDirectSmartAccount derives the Kernel address from the embedded wallet", async () => {
    const { result } = renderHook(() => useDirectSmartAccount());
    await waitFor(() => expect(result.current.smartAccount).toBe(DERIVED));
    expect(result.current.owner).toBe(OWNER);
    expect(result.current.ready).toBe(true);
  });

  it("useDirectSponsoredSend sends through the Kernel client and confirms", async () => {
    const out = { userOpHash: "0x1", transactionHash: "0x2", success: true, paymaster: null, actualGasCostWei: 0n, explorerUrl: "u" };
    sendSponsored.mockResolvedValue(out);
    const { result } = renderHook(() => useDirectSponsoredSend());
    await act(async () => {
      await result.current.send([{ to: "0x0000000000000000000000000000000000000002", data: "0x1234" }]);
    });
    expect(result.current.status).toBe("confirmed");
    expect(result.current.result).toEqual(out);
  });

  it("useDirectSponsoredSend maps failures to a PepuError", async () => {
    sendSponsored.mockRejectedValue(new Error("AA21 didn't pay prefund"));
    const { result } = renderHook(() => useDirectSponsoredSend());
    await act(async () => {
      await expect(result.current.send([{ to: "0x0000000000000000000000000000000000000002" }])).rejects.toMatchObject({
        code: "BUNDLER_AA_FAILED",
      });
    });
    expect(result.current.status).toBe("error");
  });
});
