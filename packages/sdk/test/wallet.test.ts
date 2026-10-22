import type { EIP1193Provider } from "viem";
import { describe, expect, it, vi } from "vitest";

import { pepuMainnet, pepuTestnet } from "../src/chains.js";
import { switchOrAddPepuChain, toAddEthereumChainParameter } from "../src/wallet.js";

describe("toAddEthereumChainParameter", () => {
  it("builds the full parameter object for mainnet, including the explorer URL", () => {
    expect(toAddEthereumChainParameter(pepuMainnet)).toEqual({
      chainId: "0x17dcd",
      chainName: "Pepe Unchained V2",
      nativeCurrency: { name: "Pepe Unchained", symbol: "PEPU", decimals: 18 },
      rpcUrls: ["https://rpc-pepu-v2-mainnet-0.t.conduit.xyz"],
      blockExplorerUrls: ["https://pepuscan.com"],
    });
  });

  it("omits blockExplorerUrls for testnet — no verified explorer exists", () => {
    const params = toAddEthereumChainParameter(pepuTestnet);
    expect(params.chainId).toBe("0x17dcc");
    expect(params.rpcUrls).toEqual([
      "https://rpc-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz",
    ]);
    expect("blockExplorerUrls" in params).toBe(false);
  });
});

function makeMockProvider(
  requestImpl: (args: { method: string; params?: unknown[] }) => unknown,
): EIP1193Provider {
  return { request: vi.fn(requestImpl) } as unknown as EIP1193Provider;
}

describe("switchOrAddPepuChain", () => {
  it("just switches when the wallet already knows the chain", async () => {
    const request = vi.fn().mockResolvedValue(null);
    const provider = { request } as unknown as EIP1193Provider;

    await switchOrAddPepuChain(provider, pepuMainnet);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x17dcd" }],
    });
  });

  it("falls back to wallet_addEthereumChain on a 4902 unrecognized-chain error", async () => {
    const calls: unknown[] = [];
    const provider = makeMockProvider((args) => {
      calls.push(args);
      if (args.method === "wallet_switchEthereumChain") {
        const error = new Error("Unrecognized chain") as Error & { code: number };
        error.code = 4902;
        throw error;
      }
      return null;
    });

    await switchOrAddPepuChain(provider, pepuMainnet);

    expect(calls).toEqual([
      { method: "wallet_switchEthereumChain", params: [{ chainId: "0x17dcd" }] },
      {
        method: "wallet_addEthereumChain",
        params: [toAddEthereumChainParameter(pepuMainnet)],
      },
    ]);
  });

  it("rethrows any other error without attempting to add the chain", async () => {
    const provider = makeMockProvider(() => {
      const error = new Error("User rejected the request") as Error & { code: number };
      error.code = 4001;
      throw error;
    });

    await expect(switchOrAddPepuChain(provider, pepuMainnet)).rejects.toThrow(
      "User rejected the request",
    );
  });
});
