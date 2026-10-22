// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "0xAbC0000000000000000000000000000000000001" as Address;
const KERNEL = "0x1d9a59701E5bd3A10244D94ec398eed997Ba4264" as Address;
const SESSION_KEY = "0x0000000000000000000000000000000000000003" as Address;
const TAPSCORE = "0x261eA5971B93237a56990206A46Bc80318e4d078" as Address;

const privyState = { authenticated: true, ready: true, hasWallet: true };
const getEthereumProvider = vi.fn(async () => ({ request: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ authenticated: privyState.authenticated, ready: privyState.ready }),
  useSigners: () => ({}),
}));
const pepuAuthFetch = vi.fn();
vi.mock("../src/privy/react.js", () => ({
  usePepuAuthFetch: () => pepuAuthFetch,
  useEmbeddedWallet: () =>
    privyState.hasWallet
      ? { ready: true, wallet: { address: OWNER, getEthereumProvider }, address: OWNER, external: [] }
      : { ready: true, wallet: null, external: [] },
}));
const approveKernelSession = vi.fn(async (_p: unknown) => ({ approval: "APPROVAL", kernelAddress: KERNEL }));
const getKernelAddress = vi.fn(async (..._a: unknown[]) => KERNEL);
vi.mock("../src/session/kernel.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/session/kernel.js")>()),
  approveKernelSession: (p: unknown) => approveKernelSession(p),
  getKernelAddress: (...a: unknown[]) => getKernelAddress(...a),
}));

import { deriveSessionPhase, grantKernelSession, useSponsoredSession } from "../src/combo/react.js";
import { buildKernelSessionPolicies } from "../src/session/kernel.js";

const tapAbi = [{ type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;
const scope = { calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }] };
const publicClient = {} as never;

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const future = () => Math.floor(Date.now() / 1000) + 600;
const prepared = (validUntil = future()) => ({
  ownerAddress: OWNER,
  kernelAddress: KERNEL,
  sessionKeyAddress: SESSION_KEY,
  validUntil,
  minutes: 15,
  scope: { calls: [], validAfter: 0, validUntil },
});

beforeEach(() => {
  privyState.authenticated = true;
  privyState.ready = true;
  privyState.hasWallet = true;
});
afterEach(() => {
  cleanup();
  pepuAuthFetch.mockReset();
  approveKernelSession.mockClear();
  getKernelAddress.mockClear();
});

describe("deriveSessionPhase", () => {
  const base = { authenticated: true, hasWallet: true, nowSeconds: 100 };
  it("walks the phases", () => {
    expect(deriveSessionPhase({ ...base, authenticated: false })).toBe("signed-out");
    expect(deriveSessionPhase({ ...base, hasWallet: false })).toBe("provisioning");
    expect(deriveSessionPhase(base)).toBe("ready");
    expect(deriveSessionPhase({ ...base, granting: true })).toBe("granting");
    expect(deriveSessionPhase({ ...base, validUntil: 200 })).toBe("active");
    expect(deriveSessionPhase({ ...base, validUntil: 100 })).toBe("expired");
    expect(deriveSessionPhase({ ...base, hasError: true })).toBe("error");
  });
  it("an error does not hide an active session", () => {
    expect(deriveSessionPhase({ ...base, validUntil: 200, hasError: true })).toBe("active");
  });
});

describe("grantKernelSession", () => {
  it("prepares, signs once with policies rebuilt from the scope, then activates", async () => {
    const p = prepared(1_900);
    const authFetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("prepare") ? jsonRes(p) : jsonRes({ active: true }),
    );
    const owner = { account: OWNER } as never;
    const out = await grantKernelSession({ authFetch, publicClient, owner, scope });
    expect(out).toEqual(p);
    expect(authFetch.mock.calls.map((c) => c[0])).toEqual(["/api/session/prepare", "/api/session/activate"]);
    expect(approveKernelSession).toHaveBeenCalledTimes(1);
    const arg = approveKernelSession.mock.calls[0]?.[0] as { sessionKeyAddress: string; policies: unknown[]; owner: unknown };
    expect(arg.sessionKeyAddress).toBe(SESSION_KEY);
    expect(arg.owner).toBe(owner);
    const expected = buildKernelSessionPolicies({ calls: scope.calls, validUntil: 1_900 });
    expect(arg.policies.map((x) => (x as { getPolicyInfoInBytes(): string }).getPolicyInfoInBytes())).toEqual(
      expected.map((x) => x.getPolicyInfoInBytes()),
    );
    const activate = authFetch.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(activate.body))).toEqual({ approval: "APPROVAL" });
  });

  it("honours custom endpoints and never reaches the owner prompt when prepare fails", async () => {
    const authFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonRes({ error: { code: "AUTH_INVALID_TOKEN", message: "no" } }, 401),
    );
    await expect(
      grantKernelSession({ authFetch, publicClient, owner: {} as never, scope, endpoints: { prepare: "/x/prepare" } }),
    ).rejects.toMatchObject({ code: "AUTH_INVALID_TOKEN" });
    expect(authFetch.mock.calls[0]?.[0]).toBe("/x/prepare");
    expect(approveKernelSession).not.toHaveBeenCalled();
  });

  it("surfaces SESSION_APPROVAL_MISMATCH from activate", async () => {
    const authFetch = vi.fn(async (url: string) =>
      url.endsWith("prepare")
        ? jsonRes(prepared())
        : jsonRes({ error: { code: "SESSION_APPROVAL_MISMATCH", message: "mismatch" } }, 400),
    );
    await expect(grantKernelSession({ authFetch, publicClient, owner: {} as never, scope })).rejects.toMatchObject({
      code: "SESSION_APPROVAL_MISMATCH",
    });
  });
});

describe("useSponsoredSession", () => {
  it("shows the smart account before any session and is ready", async () => {
    pepuAuthFetch.mockResolvedValue(jsonRes({ active: false }));
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient }));
    await waitFor(() => expect(result.current.smartAccount).toBe(KERNEL));
    expect(result.current.owner).toBe(OWNER);
    expect(result.current.phase).toBe("ready");
    expect(pepuAuthFetch.mock.calls[0]?.[0]).toBe("/api/session/status");
  });

  it("statusLoading is true until the first status response, then false", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    pepuAuthFetch.mockImplementation(async () => {
      await gate;
      return jsonRes({ active: false });
    });
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient }));
    expect(result.current.statusLoading).toBe(true);
    release();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    expect(result.current.phase).toBe("ready");
  });

  it("statusLoading clears when the status request fails, and is false when signed out", async () => {
    pepuAuthFetch.mockResolvedValue(jsonRes({ error: { code: "UNKNOWN", message: "boom" } }, 502));
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient }));
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    cleanup();
    privyState.authenticated = false;
    expect(renderHook(() => useSponsoredSession({ scope, publicClient })).result.current.statusLoading).toBe(false);
  });

  it("is signed-out without a user and provisioning without a wallet", () => {
    privyState.authenticated = false;
    expect(renderHook(() => useSponsoredSession({ scope, publicClient })).result.current.phase).toBe("signed-out");
    cleanup();
    privyState.authenticated = true;
    privyState.hasWallet = false;
    expect(renderHook(() => useSponsoredSession({ scope, publicClient })).result.current.phase).toBe("provisioning");
  });

  it("reports an active session from the status route", async () => {
    const validUntil = future();
    pepuAuthFetch.mockResolvedValue(
      jsonRes({ active: true, validUntil, kernelAddress: KERNEL, ownerAddress: OWNER, sessionKeyAddress: SESSION_KEY, actions: 3 }),
    );
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient }));
    await waitFor(() => expect(result.current.phase).toBe("active"));
    expect(result.current.expiresAt).toBe(validUntil);
    expect(result.current.actions).toBe(3);
    expect(result.current.scope?.calls[0]?.signature).toBe("tap()");
  });

  it("grant: one owner approval, then active; act and revoke follow", async () => {
    pepuAuthFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("status")) return jsonRes({ active: false });
      if (url.endsWith("prepare")) return jsonRes(prepared());
      if (url.endsWith("activate")) return jsonRes({ active: true });
      if (url.endsWith("act")) return jsonRes({ transactionHash: "0xbb", body: init?.body });
      if (url.endsWith("revoke")) return jsonRes({ active: false });
      return jsonRes({}, 404);
    });
    const { result } = renderHook(() =>
      useSponsoredSession<{ n: number }, { transactionHash: string }>({ scope, publicClient }),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => {
      await result.current.grant();
    });
    expect(approveKernelSession).toHaveBeenCalledTimes(1);
    expect(getEthereumProvider).toHaveBeenCalled();
    expect(result.current.phase).toBe("active");

    let out: { transactionHash: string } | undefined;
    await act(async () => {
      out = await result.current.act({ n: 2 });
    });
    expect(out?.transactionHash).toBe("0xbb");
    expect(approveKernelSession).toHaveBeenCalledTimes(1); // no second owner prompt
    const actCall = pepuAuthFetch.mock.calls.find((c) => String(c[0]).endsWith("/act"));
    expect(JSON.parse(String((actCall?.[1] as RequestInit).body))).toEqual({ n: 2 });

    await act(async () => {
      await result.current.revoke();
    });
    expect(result.current.phase).toBe("ready");
  });

  it("a failed grant becomes an error phase with a typed error", async () => {
    pepuAuthFetch.mockImplementation(async (url: string) =>
      url.endsWith("status")
        ? jsonRes({ active: false })
        : jsonRes({ error: { code: "CONFIG_MISSING_ENV", message: "Missing X" } }, 500),
    );
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient }));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => {
      await result.current.grant();
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error?.code).toBe("CONFIG_MISSING_ENV");
  });

  it("act: a 409 means the session is gone, any other failure keeps it", async () => {
    const validUntil = future();
    const status = { active: true, validUntil, kernelAddress: KERNEL, ownerAddress: OWNER, sessionKeyAddress: SESSION_KEY, actions: 0 };
    let actStatus = 502;
    pepuAuthFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("status")) return jsonRes(status);
      return jsonRes(
        { error: { code: actStatus === 409 ? "SESSION_NONE" : "PAYMASTER_CAP", message: "m" } },
        actStatus,
      );
    });
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient }));
    await waitFor(() => expect(result.current.phase).toBe("active"));

    await act(async () => {
      await expect(result.current.act()).rejects.toMatchObject({ code: "PAYMASTER_CAP" });
    });
    expect(result.current.phase).toBe("active");

    actStatus = 409;
    await act(async () => {
      await expect(result.current.act()).rejects.toMatchObject({ code: "SESSION_NONE" });
    });
    expect(result.current.phase).not.toBe("active");
  });

  it("uses a custom authFetch when given", async () => {
    const authFetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonRes({ active: false }));
    renderHook(() => useSponsoredSession({ scope, publicClient, authFetch }));
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(pepuAuthFetch).not.toHaveBeenCalled();
  });
});

describe("a just-created wallet the server cannot see yet (fresh Google account)", () => {
  const notYet = () => jsonRes({ error: { code: "WALLET_NOT_PROVISIONED", message: "still being set up" } }, 409);

  it("status 'provisioning' keeps the loading state, never shows an error, and settles when the wallet appears", async () => {
    pepuAuthFetch
      .mockResolvedValueOnce(jsonRes({ active: false, provisioning: true }))
      .mockResolvedValueOnce(notYet())
      .mockResolvedValue(jsonRes({ active: false }));
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient, provisioningRetryDelaysMs: [1, 1, 1] }));
    await waitFor(() => expect(pepuAuthFetch).toHaveBeenCalledTimes(1));
    expect(result.current.statusLoading).toBe(true);
    expect(result.current.error).toBeUndefined();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    expect(pepuAuthFetch).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeUndefined();
    expect(result.current.phase).toBe("ready");
  });

  it("gives up quietly after the bounded retries: ready (the grant retries too), not a red error", async () => {
    pepuAuthFetch.mockImplementation(async () => jsonRes({ active: false, provisioning: true }));
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient, provisioningRetryDelaysMs: [1, 1] }));
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    expect(pepuAuthFetch).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeUndefined();
    expect(result.current.phase).toBe("ready");
  });

  it("a status failure that is not provisioning still surfaces as an error", async () => {
    pepuAuthFetch.mockResolvedValue(jsonRes({ error: { code: "UNKNOWN", message: "boom" } }, 502));
    const { result } = renderHook(() => useSponsoredSession({ scope, publicClient, provisioningRetryDelaysMs: [1] }));
    await waitFor(() => expect(result.current.error).toBeDefined());
  });

  it("grantKernelSession retries prepare while WALLET_NOT_PROVISIONED, then succeeds", async () => {
    let n = 0;
    const authFetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("prepare")) return n++ < 2 ? notYet() : jsonRes(prepared());
      return jsonRes({ active: true });
    });
    const out = await grantKernelSession({ authFetch, publicClient, owner: {} as never, scope, provisioningRetryDelaysMs: [1, 1, 1] });
    expect(out.kernelAddress).toBe(KERNEL);
    expect(authFetch.mock.calls.filter((c) => String(c[0]).endsWith("prepare"))).toHaveLength(3);
  });

  it("grantKernelSession surfaces WALLET_NOT_PROVISIONED once the retries run out", async () => {
    const authFetch = vi.fn(async (_url: string, _init?: RequestInit) => notYet());
    await expect(
      grantKernelSession({ authFetch, publicClient, owner: {} as never, scope, provisioningRetryDelaysMs: [1] }),
    ).rejects.toMatchObject({ code: "WALLET_NOT_PROVISIONED" });
    expect(approveKernelSession).not.toHaveBeenCalled();
  });
});
