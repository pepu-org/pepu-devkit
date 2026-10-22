// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { pepuMainnet, pepuTestnet } from "../../src/chains.js";
import { usePepuChain } from "../../src/react/usePepuChain.js";

afterEach(cleanup);

describe("usePepuChain", () => {
  it("resolves mainnet's chain id to the mainnet definition", () => {
    const { result } = renderHook(() => usePepuChain(pepuMainnet.id));
    expect(result.current.chain).toBe(pepuMainnet);
    expect(result.current.isPepuChain).toBe(true);
  });

  it("resolves testnet's chain id to the testnet definition", () => {
    const { result } = renderHook(() => usePepuChain(pepuTestnet.id));
    expect(result.current.chain).toBe(pepuTestnet);
    expect(result.current.isPepuChain).toBe(true);
  });

  it("returns an undefined chain and false for an unrelated chain id", () => {
    const { result } = renderHook(() => usePepuChain(1));
    expect(result.current.chain).toBeUndefined();
    expect(result.current.isPepuChain).toBe(false);
  });

  it("returns an undefined chain when chainId itself is undefined (e.g. wallet not connected)", () => {
    const { result } = renderHook(() => usePepuChain(undefined));
    expect(result.current.chain).toBeUndefined();
    expect(result.current.isPepuChain).toBe(false);
  });

  it("updates when chainId changes", () => {
    const { result, rerender } = renderHook(
      ({ chainId }: { chainId: number | undefined }) => usePepuChain(chainId),
      { initialProps: { chainId: pepuMainnet.id as number | undefined } },
    );
    expect(result.current.chain).toBe(pepuMainnet);

    rerender({ chainId: pepuTestnet.id });
    expect(result.current.chain).toBe(pepuTestnet);
  });
});
