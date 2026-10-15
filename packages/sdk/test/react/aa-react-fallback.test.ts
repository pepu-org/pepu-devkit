// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const OWNER = "0x00000000000000000000000000000000000000aa";
const FROM_CHAIN = "0x00000000000000000000000000000000000000cc";

const getClientForChain = vi.fn();
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => "tok" }),
  useWallets: () => ({ wallets: [{ walletClientType: "privy", address: OWNER, getEthereumProvider: async () => ({}) }] }),
}));
vi.mock("@privy-io/react-auth/smart-wallets", () => ({
  // `client` is unset: the case the fallback exists for.
  useSmartWallets: () => ({ client: undefined, getClientForChain }),
}));
vi.mock("../../src/client.js", () => ({ getPublicClient: () => ({}) }));

import { usePepuSmartAccount } from "../../src/aa/react.js";

afterEach(() => {
  cleanup();
  getClientForChain.mockReset();
});

describe("usePepuSmartAccount fallback", () => {
  it("resolves the smart account through getClientForChain(97741) when client is unset", async () => {
    getClientForChain.mockResolvedValue({ account: { address: FROM_CHAIN } });
    const { result } = renderHook(() => usePepuSmartAccount());
    await waitFor(() => expect(result.current.smartAccount).toBe(FROM_CHAIN));
    expect(getClientForChain).toHaveBeenCalledWith({ id: 97741 });
    expect(result.current.ready).toBe(true);
    expect(result.current.owner).toBe(OWNER);
  });

  it("stays not ready (and never loads ZeroDev) when getClientForChain has nothing or throws", async () => {
    getClientForChain.mockRejectedValue(new Error("chain not configured"));
    const { result } = renderHook(() => usePepuSmartAccount());
    await waitFor(() => expect(getClientForChain).toHaveBeenCalled());
    expect(result.current.smartAccount).toBeUndefined();
    expect(result.current.ready).toBe(false);
    expect(result.current.owner).toBe(OWNER);
  });
});
