import {
  createPublicClient,
  custom,
  encodeFunctionResult,
} from "viem";
import { describe, expect, it } from "vitest";

import { kernelFactoryAbi } from "../src/abi/kernelFactory.js";
import {
  getKernelAccountAddress,
  getPepuKernelStack,
  getSponsorshipStatus,
} from "../src/aa/status.js";
import { pepuMainnet, pepuTestnet } from "../src/chains.js";

describe("getPepuKernelStack", () => {
  it("returns the full deployed AA stack on mainnet", () => {
    const stack = getPepuKernelStack(pepuMainnet.id);
    expect(stack).toBeDefined();
    expect(stack?.entryPoint07.address).toBe(
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    );
    expect(stack?.kernelFactory.address).toBe(
      "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
    );
  });

  it("returns undefined on testnet — nothing is deployed there", () => {
    expect(getPepuKernelStack(pepuTestnet.id)).toBeUndefined();
  });

  it("returns undefined for an unknown chain id", () => {
    expect(getPepuKernelStack(1)).toBeUndefined();
  });
});

describe("getSponsorshipStatus", () => {
  it("always reports unavailable, with a reason", () => {
    const status = getSponsorshipStatus();
    expect(status.available).toBe(false);
    expect(status.reason.length).toBeGreaterThan(0);
    expect(status.bundlerUrl).toBeUndefined();
  });

  it("still reports unavailable even when a bundlerUrl extension point is passed", () => {
    const status = getSponsorshipStatus({ bundlerUrl: "https://future-bundler.example.com" });
    expect(status.available).toBe(false);
    expect(status.bundlerUrl).toBe("https://future-bundler.example.com");
  });
});

describe("getKernelAccountAddress", () => {
  it("passes data/salt through to the factory's getAddress and returns its result", async () => {
    const expectedAddress = "0x5Ed9Cf6659Abb92fa7f3347BE87A71f4979976ec" as const;
    const client = createPublicClient({
      chain: pepuMainnet,
      transport: custom({
        async request({ method }: { method: string }) {
          if (method === "eth_call") {
            return encodeFunctionResult({
              abi: kernelFactoryAbi,
              functionName: "getAddress",
              result: expectedAddress,
            });
          }
          throw new Error(`test mock: unexpected RPC method ${method}`);
        },
      }),
    });

    const address = await getKernelAccountAddress(
      client,
      { address: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419" },
      {
        data: "0x",
        salt: `0x${"0".repeat(64)}` as `0x${string}`,
      },
    );
    expect(address.toLowerCase()).toBe(expectedAddress.toLowerCase());
  });
});
