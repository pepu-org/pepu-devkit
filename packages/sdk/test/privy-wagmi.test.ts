// @vitest-environment jsdom
import { cleanup, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pepuMainnet } from "../src/chains.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const EXT = "0x9999999999999999999999999999999999999999";

const state = {
  active: EXT as string | undefined,
  wallets: [{ address: ADDR, walletClientType: "privy", connectorType: "embedded", imported: false }],
  setActiveWallet: vi.fn(async () => {}),
};
let wagmiProviderConfig: unknown;

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: { children?: unknown }) => createElement("div", null, props.children as never),
  usePrivy: () => ({ ready: true, authenticated: true, getAccessToken: async () => "t" }),
  useUser: () => ({ refreshUser: async () => {} }),
  useWallets: () => ({ wallets: state.wallets, ready: true }),
  getEmbeddedConnectedWallet: (w: typeof state.wallets) => w[0] ?? null,
}));
vi.mock("wagmi", async (orig) => ({
  ...(await orig<typeof import("wagmi")>()),
  useAccount: () => ({ address: state.active }),
}));
vi.mock("@privy-io/wagmi", async (orig) => {
  const real = await orig<typeof import("@privy-io/wagmi")>();
  return {
    ...real,
    useSetActiveWallet: () => ({ setActiveWallet: state.setActiveWallet }),
    WagmiProvider: (props: { config: unknown; children?: unknown }) => {
      wagmiProviderConfig = props.config;
      return createElement("div", { "data-testid": "wagmi" }, props.children as never);
    },
  };
});

import {
  EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT,
  PepuPrivyWagmiProvider,
  pepuWagmiConfig,
  useActiveWalletPin,
} from "../src/privy/wagmi.js";

afterEach(() => {
  cleanup();
  state.active = EXT;
  state.setActiveWallet.mockClear();
});

describe("pepuWagmiConfig", () => {
  it("is PEPU mainnet only with multicall3 already on the chain", () => {
    const config = pepuWagmiConfig();
    expect(config.chains.map((c) => c.id)).toEqual([97741]);
    expect(config.chains[0]?.contracts?.multicall3?.address).toBe(pepuMainnet.contracts.multicall3.address);
    expect(config.chains[0]?.contracts?.multicall3?.address.toLowerCase()).not.toBe(
      "0xca11bde05977b3631167028862be2a173976ca11",
    );
  });

  it("accepts a custom rpc url", () => {
    expect(pepuWagmiConfig({ rpcUrl: "https://rpc.example.com" }).chains).toHaveLength(1);
  });
});

describe("useActiveWalletPin", () => {
  it("is on by default", () => {
    expect(EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT).toBe(true);
  });

  it("pins the embedded wallet when an extension is active, once", () => {
    const { rerender } = renderHook(() => useActiveWalletPin());
    rerender();
    expect(state.setActiveWallet).toHaveBeenCalledTimes(1);
  });

  it("does not loop once the embedded wallet is active", () => {
    state.active = ADDR;
    const { rerender } = renderHook(() => useActiveWalletPin());
    rerender();
    expect(state.setActiveWallet).not.toHaveBeenCalled();
  });

  it("can be opted out", () => {
    renderHook(() => useActiveWalletPin({ enabled: false }));
    expect(state.setActiveWallet).not.toHaveBeenCalled();
  });
});

describe("PepuPrivyWagmiProvider", () => {
  it("nests wagmi inside Privy, renders children and mounts the pin", () => {
    const { getByTestId, getByText } = render(
      createElement(PepuPrivyWagmiProvider, { appId: "app1", wagmiConfig: pepuWagmiConfig(), queryClient: new QueryClient() }, "kid"),
    );
    expect(getByTestId("wagmi")).toBeTruthy();
    expect(getByText("kid")).toBeTruthy();
    expect(state.setActiveWallet).toHaveBeenCalled();
  });

  it("skips the pin with pinEmbeddedWallet={false}", () => {
    render(createElement(PepuPrivyWagmiProvider, { appId: "app1", pinEmbeddedWallet: false }, "kid"));
    expect(state.setActiveWallet).not.toHaveBeenCalled();
  });

  it("uses a stable wagmi config by default and a custom one when given", () => {
    render(createElement(PepuPrivyWagmiProvider, { appId: "app1" }, "a"));
    const first = wagmiProviderConfig;
    cleanup();
    render(createElement(PepuPrivyWagmiProvider, { appId: "app1" }, "b"));
    expect(wagmiProviderConfig).toBe(first);
    cleanup();
    const custom = pepuWagmiConfig();
    render(createElement(PepuPrivyWagmiProvider, { appId: "app1", wagmiConfig: custom }, "c"));
    expect(wagmiProviderConfig).toBe(custom);
  });

  it("renders the fallback when appId is missing", () => {
    const { getByText } = render(
      createElement(PepuPrivyWagmiProvider, { appId: undefined, fallback: createElement("p", null, "none") }, "kid"),
    );
    expect(getByText("none")).toBeTruthy();
  });
});
