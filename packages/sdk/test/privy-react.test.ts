// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PepuAuthError } from "../src/errors.js";

// Shorten the default "wallet never appeared" wait so the WalletGate stalled slot is testable.
vi.mock("../src/privy/ensure-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/privy/ensure-client.js")>()),
  DEFAULT_ENSURE_APPEAR_TIMEOUT_MS: 400,
}));

const ADDR = "0x1111111111111111111111111111111111111111";
const EXT = "0x9999999999999999999999999999999999999999";

// Mutable fake of @privy-io/react-auth state.
const privy = {
  ready: true,
  authenticated: true,
  walletsReady: true,
  wallets: [] as { address: string; walletClientType: string; connectorType: string; imported: boolean }[],
  getAccessToken: vi.fn(async () => "tok"),
  refreshUser: vi.fn(async () => {}),
};
let providerProps: Record<string, unknown> | undefined;

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: { children?: unknown } & Record<string, unknown>) => {
    providerProps = props;
    return createElement("div", { "data-testid": "privy" }, props.children as never);
  },
  usePrivy: () => ({ ready: privy.ready, authenticated: privy.authenticated, getAccessToken: privy.getAccessToken }),
  useUser: () => ({ refreshUser: privy.refreshUser }),
  useWallets: () => ({ wallets: privy.wallets, ready: privy.walletsReady }),
  // Same discriminator as the real helper (verified against @privy-io/react-auth 3.44).
  getEmbeddedConnectedWallet: (wallets: typeof privy.wallets) =>
    wallets.find((w) => w.walletClientType === "privy" && w.connectorType === "embedded" && !w.imported) ?? null,
}));

import {
  PepuPrivyProvider,
  WalletGate,
  composeProviders,
  shouldPinEmbeddedWallet,
  useEmbeddedWallet,
  useEnsureWallet,
  usePepuAuthFetch,
  usePinEmbeddedWallet,
} from "../src/privy/react.js";

const embedded = (address = ADDR) => ({ address, walletClientType: "privy", connectorType: "embedded", imported: false });
const injected = (address = EXT) => ({ address, walletClientType: "metamask", connectorType: "injected", imported: false });
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  privy.ready = true;
  privy.authenticated = true;
  privy.walletsReady = true;
  privy.wallets = [];
  privy.getAccessToken = vi.fn(async () => "tok");
  privy.refreshUser = vi.fn(async () => {});
  providerProps = undefined;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PepuPrivyProvider", () => {
  it("renders the fallback instead of PrivyProvider when appId is missing", () => {
    render(createElement(PepuPrivyProvider, { appId: undefined, fallback: createElement("p", null, "no app id") }, "child"));
    expect(screen.getByText("no app id")).toBeTruthy();
    expect(providerProps).toBeUndefined();
  });

  it("names the env variable in the default notice", () => {
    render(createElement(PepuPrivyProvider, { appId: "" }));
    expect((screen.getByRole("alert") as unknown as { textContent: string }).textContent).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
  });

  it("passes the PEPU config and merges overrides", () => {
    render(createElement(PepuPrivyProvider, { appId: "app1", config: { loginMethods: ["email"] } }, "child"));
    expect(providerProps?.["appId"]).toBe("app1");
    const config = providerProps?.["config"] as { supportedChains: { id: number }[]; loginMethods: string[] };
    expect(config.supportedChains.map((c) => c.id)).toEqual([97741]);
    expect(config.loginMethods).toEqual(["email"]);
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("composeProviders nests layers outermost first and renders leaves", () => {
    const order: string[] = [];
    const A = ({ children }: { children?: unknown }) => {
      order.push("A");
      return createElement("section", null, children as never);
    };
    const B = ({ children }: { children?: unknown }) => {
      order.push("B");
      return createElement("div", null, children as never);
    };
    const Leaf = () => createElement("i", null, "leaf");
    const Wrapper = composeProviders([[A, {}], [B, {}]], [Leaf as never]);
    render(createElement(Wrapper, null, "kid"));
    expect(order).toEqual(["A", "B"]);
    expect(screen.getByText("leaf")).toBeTruthy();
    expect((screen.getByText("kid") as unknown as { closest(s: string): unknown }).closest("section")).toBeTruthy();
  });
});

describe("useEmbeddedWallet", () => {
  it("separates the embedded wallet from injected ones", () => {
    privy.wallets = [injected(), embedded()];
    const { result } = renderHook(() => useEmbeddedWallet());
    expect(result.current.address).toBe(ADDR);
    expect(result.current.external.map((w) => w.address)).toEqual([EXT]);
  });

  it("reports no wallet when only an injected wallet is connected", () => {
    privy.wallets = [injected()];
    const { result } = renderHook(() => useEmbeddedWallet());
    expect(result.current.wallet).toBeNull();
    expect(result.current.address).toBeUndefined();
    expect(result.current.external).toHaveLength(1);
  });
});

describe("shouldPinEmbeddedWallet / usePinEmbeddedWallet", () => {
  const base = { enabled: true, ready: true, embeddedAddress: ADDR, activeAddress: EXT };
  it("pins only when the active address differs", () => {
    expect(shouldPinEmbeddedWallet(base)).toBe(true);
    expect(shouldPinEmbeddedWallet({ ...base, activeAddress: ADDR.toUpperCase().replace("0X", "0x") })).toBe(false);
    expect(shouldPinEmbeddedWallet({ ...base, enabled: false })).toBe(false);
    expect(shouldPinEmbeddedWallet({ ...base, ready: false })).toBe(false);
    expect(shouldPinEmbeddedWallet({ ...base, embeddedAddress: undefined })).toBe(false);
    expect(shouldPinEmbeddedWallet({ ...base, activeAddress: undefined })).toBe(true);
  });

  it("calls setActiveWallet once for a drifted account and not on re-render", () => {
    privy.wallets = [embedded(), injected()];
    const setActiveWallet = vi.fn();
    const { rerender } = renderHook(() => usePinEmbeddedWallet({ enabled: true, activeAddress: EXT, setActiveWallet }));
    rerender();
    rerender();
    expect(setActiveWallet).toHaveBeenCalledTimes(1);
    expect(setActiveWallet.mock.calls[0]?.[0]).toMatchObject({ address: ADDR });
  });

  it("does nothing when already active, disabled, or there is no embedded wallet", () => {
    const setActiveWallet = vi.fn();
    privy.wallets = [embedded()];
    renderHook(() => usePinEmbeddedWallet({ enabled: true, activeAddress: ADDR, setActiveWallet }));
    renderHook(() => usePinEmbeddedWallet({ enabled: false, activeAddress: EXT, setActiveWallet }));
    privy.wallets = [injected()];
    renderHook(() => usePinEmbeddedWallet({ enabled: true, activeAddress: EXT, setActiveWallet }));
    expect(setActiveWallet).not.toHaveBeenCalled();
  });
});

describe("useEnsureWallet / WalletGate", () => {
  it("is idle until signed in", () => {
    privy.authenticated = false;
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => useEnsureWallet());
    expect(result.current.status).toBe("idle");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is ready without any request when an embedded wallet exists", () => {
    privy.wallets = [embedded()];
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => useEnsureWallet());
    expect(result.current).toMatchObject({ status: "ready", address: ADDR });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not treat an injected wallet as provisioned, and posts once to the endpoint", async () => {
    privy.wallets = [injected()];
    const fetchFn = vi.fn(async () => json({ address: ADDR, created: true }));
    vi.stubGlobal("fetch", fetchFn);
    const { result, rerender } = renderHook(() => useEnsureWallet({ endpoint: "/custom/ensure" }));
    rerender();
    await waitFor(() => expect(privy.refreshUser).toHaveBeenCalled());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("/custom/ensure");
    await waitFor(() => expect(result.current.address).toBe(ADDR));
    expect(result.current.status).toBe("checking");
  });

  it("surfaces a typed error and retries", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? json({ error: { code: "CONFIG_MISSING_ENV", message: "Missing required env: PRIVY_APP_SECRET", hint: "h" } }, 500)
        : json({ address: ADDR, created: true });
    });
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => useEnsureWallet());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.code).toBe("CONFIG_MISSING_ENV");
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.address).toBe(ADDR));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("becomes stalled when the wallet never appears client-side", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ address: ADDR, created: true })));
    const { result } = renderHook(() => useEnsureWallet({ appearTimeoutMs: 20 }));
    await waitFor(() => expect(result.current.status).toBe("stalled"));
    expect(result.current.address).toBe(ADDR);
  });

  it("reports a missing access token as an auth error", async () => {
    privy.getAccessToken = vi.fn(async () => null as unknown as string);
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useEnsureWallet());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(PepuAuthError);
  });

  it("WalletGate renders children when ready, a custom error with retry on failure", async () => {
    privy.wallets = [embedded()];
    const { unmount } = render(createElement(WalletGate, { children: "inside" }));
    expect(screen.getByText("inside")).toBeTruthy();
    unmount();

    privy.wallets = [];
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNKNOWN", message: "nope", hint: "h" } }, 502)));
    render(createElement(WalletGate, { error: (e) => createElement("p", null, `custom:${e.message}`), children: "inside" }));
    await waitFor(() => expect(screen.getByText("custom:nope")).toBeTruthy());
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("WalletGate stalled render prop receives the address and a reload callback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ address: ADDR, created: true })));
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    render(
      createElement(WalletGate, {
        stalled: (address, onReload) => createElement("button", { onClick: onReload }, `stalled:${address}`),
        children: "inside",
      }),
    );
    const btn = await screen.findByText(`stalled:${ADDR}`);
    fireEvent.click(btn);
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("WalletGate shows the loading slot while creating", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(createElement(WalletGate, { loading: createElement("p", null, "spin"), children: "inside" }));
    expect(screen.getByText("spin")).toBeTruthy();
  });
});

describe("usePepuAuthFetch", () => {
  it("attaches the bearer token and preserves other headers", async () => {
    const fetchFn = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => usePepuAuthFetch());
    await result.current("/api/x", { method: "POST", headers: { "x-a": "1" } });
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("x-a")).toBe("1");
    expect(init.method).toBe("POST");
  });

  it("throws PepuAuthError without a token and does not fetch", async () => {
    privy.getAccessToken = vi.fn(async () => null as unknown as string);
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    const { result } = renderHook(() => usePepuAuthFetch());
    await expect(result.current("/api/x")).rejects.toBeInstanceOf(PepuAuthError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
