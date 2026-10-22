// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AbiFunction, Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

const ADDR = "0xAbC0000000000000000000000000000000000001";
const addSigners = vi.fn();
const removeSigners = vi.fn();
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => "tok", user: { wallet: { address: ADDR } } }),
  useSigners: () => ({ addSigners, removeSigners }),
}));

import {
  deriveSessionState,
  errorFromResponse,
  useSessionAct,
  useSessionGrant,
  useSessionRevoke,
  useSessionStatus,
} from "../src/session/react.js";
import {
  DEFAULT_SESSION_MINUTES,
  MAX_SESSION_MINUTES,
  SESSION_TRUST_NOTICE,
  describeSessionScope,
  resolveSessionMinutes,
  sessionExpiry,
} from "../src/session/policy.js";

afterEach(() => {
  cleanup();
  addSigners.mockReset();
  removeSigners.mockReset();
  localStorage.clear();
});

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("pure session helpers", () => {
  it("resolveSessionMinutes defaults, clamps and rejects junk", () => {
    expect(resolveSessionMinutes(undefined)).toBe(DEFAULT_SESSION_MINUTES);
    expect(resolveSessionMinutes("")).toBe(DEFAULT_SESSION_MINUTES);
    expect(resolveSessionMinutes("abc")).toBe(DEFAULT_SESSION_MINUTES);
    expect(resolveSessionMinutes(-5)).toBe(DEFAULT_SESSION_MINUTES);
    expect(resolveSessionMinutes("30")).toBe(30);
    expect(resolveSessionMinutes(99999)).toBe(MAX_SESSION_MINUTES);
  });

  it("sessionExpiry adds whole seconds", () => {
    expect(sessionExpiry(1000, 15)).toBe(1900);
  });

  it("describeSessionScope gives selector and signature, zero value", () => {
    const tap: AbiFunction = { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] };
    const s = describeSessionScope({
      contractAddress: "0x261eA5971B93237a56990206A46Bc80318e4d078" as Address,
      functions: [tap],
      expiresAtUnixSeconds: 5,
    });
    expect(s.functions[0]).toMatchObject({ name: "tap", signature: "tap()", valueWei: "0" });
    expect(s.functions[0]?.selector).toMatch(/^0x[0-9a-f]{8}$/);
    expect(() =>
      describeSessionScope({ contractAddress: "0x1" as Address, functions: [tap], expiresAtUnixSeconds: 5 }),
    ).toThrow();
  });

  it("trust notices are honest about enforcement", () => {
    expect(SESSION_TRUST_NOTICE["privy-offchain"]).toMatch(/not by an on-chain/);
    expect(SESSION_TRUST_NOTICE["kernel-onchain"]).toMatch(/on-chain/);
  });

  it("deriveSessionState", () => {
    expect(deriveSessionState({ delegated: false, nowSeconds: 1 })).toEqual({ state: "none" });
    expect(deriveSessionState({ delegated: true, nowSeconds: 1 })).toEqual({ state: "active" });
    expect(deriveSessionState({ delegated: true, expiresAt: 11, nowSeconds: 1 })).toEqual({
      state: "active",
      secondsLeft: 10,
    });
    expect(deriveSessionState({ delegated: true, expiresAt: 1, nowSeconds: 5 }).state).toBe("expired");
  });

  it("errorFromResponse: only a bare 409 is SESSION_NONE", async () => {
    expect((await errorFromResponse(jsonRes({}, 409))).code).toBe("SESSION_NONE");
    expect((await errorFromResponse(jsonRes({ error: "boom" }, 502))).code).toBe("UNKNOWN");
    expect(
      (await errorFromResponse(jsonRes({ error: { code: "POLICY_NAME_TOO_LONG", message: "m", hint: "h" } }, 400)))
        .code,
    ).toBe("POLICY_NAME_TOO_LONG");
    expect((await errorFromResponse(jsonRes({}, 401))).code).toBe("AUTH_INVALID_TOKEN");
  });
});

describe("hooks", () => {
  it("useSessionGrant posts, then addSigners with the policy", async () => {
    const authFetch = vi.fn(async () =>
      jsonRes({ alreadyGranted: false, policyId: "p1", expiresAt: 9999999999, signerId: "kq" }),
    );
    addSigners.mockResolvedValue({});
    const { result } = renderHook(() => useSessionGrant({ authFetch }));
    await act(async () => {
      await result.current.grant();
    });
    expect(addSigners).toHaveBeenCalledWith({ address: ADDR, signers: [{ signerId: "kq", policyIds: ["p1"] }] });
    expect(result.current.status).toBe("granted");
  });

  it("useSessionGrant skips addSigners when alreadyGranted", async () => {
    const authFetch = vi.fn(async () => jsonRes({ alreadyGranted: true }));
    const { result } = renderHook(() => useSessionGrant({ authFetch }));
    await act(async () => {
      await result.current.grant();
    });
    expect(addSigners).not.toHaveBeenCalled();
    expect(result.current.status).toBe("granted");
  });

  it("useSessionGrant tolerates a duplicate-signer error", async () => {
    const authFetch = vi.fn(async () =>
      jsonRes({ alreadyGranted: false, policyId: "p1", expiresAt: 1, signerId: "kq" }),
    );
    addSigners.mockRejectedValue(new Error("Duplicate signer(s) provided when updating wallet"));
    const { result } = renderHook(() => useSessionGrant({ authFetch }));
    await act(async () => {
      await result.current.grant();
    });
    expect(result.current.status).toBe("granted");
  });

  it("useSessionGrant surfaces a typed error", async () => {
    const authFetch = vi.fn(async () =>
      jsonRes({ error: { code: "CONFIG_MISSING_ENV", message: "Missing X", hint: "set it" } }, 500),
    );
    const { result } = renderHook(() => useSessionGrant({ authFetch }));
    await act(async () => {
      await result.current.grant();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("CONFIG_MISSING_ENV");
  });

  it("useSessionStatus: active with a countdown from the stored expiry", async () => {
    const authFetch = vi.fn(async () => jsonRes({ delegated: true }));
    localStorage.setItem(
      `pepu:session:${ADDR.toLowerCase()}`,
      JSON.stringify({ expiresAt: Math.floor(Date.now() / 1000) + 100 }),
    );
    const { result } = renderHook(() => useSessionStatus({ authFetch }));
    await waitFor(() => expect(result.current.state).toBe("active"));
    expect(result.current.secondsLeft).toBeGreaterThan(90);
  });

  it("useSessionStatus: loading is true until the first response, so the UI does not flash", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const authFetch = vi.fn(async () => {
      await gate;
      return jsonRes({ delegated: true });
    });
    const { result } = renderHook(() => useSessionStatus({ authFetch }));
    expect(result.current.loading).toBe(true);
    expect(result.current.state).toBe("none");
    release();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toBe("active");
  });

  it("useSessionStatus: loading also clears when the status request fails", async () => {
    const authFetch = vi.fn(async () => jsonRes({ error: "x" }, 500));
    const { result } = renderHook(() => useSessionStatus({ authFetch }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state).toBe("none");
  });

  it("useSessionStatus: not delegated is none", async () => {
    const authFetch = vi.fn(async () => jsonRes({ delegated: false }));
    const { result } = renderHook(() => useSessionStatus({ authFetch }));
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(result.current.state).toBe("none");
  });

  it("useSessionRevoke removes the signer, then cleans up", async () => {
    const authFetch = vi.fn(async () => jsonRes({ revoked: true }));
    removeSigners.mockResolvedValue({});
    const { result } = renderHook(() => useSessionRevoke({ authFetch }));
    await act(async () => {
      await result.current.revoke();
    });
    expect(removeSigners).toHaveBeenCalledWith({ address: ADDR });
    expect(result.current.status).toBe("revoked");
  });

  it("useSessionAct returns the body; a 409 is SESSION_NONE, a 502 is not", async () => {
    const authFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ hash: "0x1" }))
      .mockResolvedValueOnce(jsonRes({ error: { code: "SESSION_NONE", message: "n", hint: "h" } }, 409))
      .mockResolvedValueOnce(jsonRes({ error: { code: "UNKNOWN", message: "revert", hint: "h" } }, 502));
    const { result } = renderHook(() => useSessionAct<object, { hash: string }>({ endpoint: "/api/x", authFetch }));
    await act(async () => {
      expect((await result.current.act({})).hash).toBe("0x1");
    });
    await act(async () => {
      await expect(result.current.act({})).rejects.toMatchObject({ code: "SESSION_NONE" });
    });
    await act(async () => {
      await expect(result.current.act({})).rejects.toMatchObject({ code: "UNKNOWN" });
    });
  });
});
