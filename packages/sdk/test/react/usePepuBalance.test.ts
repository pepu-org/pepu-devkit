// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createPublicClient, custom, encodeFunctionResult, erc20Abi, numberToHex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { pepuMainnet } from "../../src/chains.js";
import { usePepuBalance } from "../../src/react/usePepuBalance.js";

afterEach(cleanup);

const ADDRESS = "0x0000000000000000000000000000000000000001" as const;
const TOKEN = "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8" as const;

function makeMockClient(
  handler: (args: { method: string; params?: unknown[] }) => unknown,
) {
  return createPublicClient({
    chain: pepuMainnet,
    // `retryCount: 0` — otherwise viem retries a failing request a few
    // times with backoff, which would make the "surfaces an error" test
    // below race `waitFor`'s default timeout instead of failing fast.
    transport: custom({ request: async (args) => handler(args) }, { retryCount: 0 }),
  });
}

describe("usePepuBalance", () => {
  it("fetches the native PEPU balance for an address", async () => {
    const client = makeMockClient(({ method }) => {
      if (method === "eth_getBalance") {
        return numberToHex(10_000_000_000_000_000n);
      }
      throw new Error(`unexpected method ${method}`);
    });

    const { result } = renderHook(() => usePepuBalance(client, { address: ADDRESS }));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toBe(10_000_000_000_000_000n);
    expect(result.current.error).toBeUndefined();
  });

  it("reads an ERC-20 balance instead when a token address is given", async () => {
    const client = makeMockClient(({ method }) => {
      if (method === "eth_call") {
        return encodeFunctionResult({
          abi: erc20Abi,
          functionName: "balanceOf",
          result: 42_000_000n,
        });
      }
      throw new Error(`unexpected method ${method}`);
    });

    const { result } = renderHook(() =>
      usePepuBalance(client, { address: ADDRESS, token: TOKEN }),
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toBe(42_000_000n);
  });

  it("leaves data undefined and does not fetch when address is undefined", async () => {
    let requestCount = 0;
    const client = makeMockClient(() => {
      requestCount += 1;
      return numberToHex(1n);
    });

    const { result } = renderHook(() => usePepuBalance(client, { address: undefined }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect(requestCount).toBe(0);
  });

  it("surfaces a failed read as `error`, not a thrown exception", async () => {
    const client = makeMockClient(() => {
      throw new Error("boom");
    });

    const { result } = renderHook(() => usePepuBalance(client, { address: ADDRESS }));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toMatch(/boom/);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("refetch() re-runs the read on demand", async () => {
    let callCount = 0;
    const client = makeMockClient(({ method }) => {
      if (method === "eth_getBalance") {
        callCount += 1;
        return numberToHex(BigInt(callCount));
      }
      throw new Error(`unexpected method ${method}`);
    });

    const { result } = renderHook(() => usePepuBalance(client, { address: ADDRESS }));
    await waitFor(() => expect(result.current.data).toBe(1n));

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.data).toBe(2n));

    expect(callCount).toBe(2);
  });
});
