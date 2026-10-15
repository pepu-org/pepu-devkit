import { describe, expect, it, vi } from "vitest";
import { PepuAuthError, PepuError } from "../src/errors.js";
import { errorFromEnsureResponse, requestEnsureWallet } from "../src/privy/ensure-client.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("requestEnsureWallet", () => {
  it("posts with a bearer token and returns the address", async () => {
    const fetchFn = vi.fn(async () => json({ address: ADDR, created: true }));
    const r = await requestEnsureWallet({
      getAccessToken: async () => "tok",
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(r).toEqual({ address: ADDR, created: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/wallet/ensure");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("throws PepuAuthError without a token and never calls fetch", async () => {
    const fetchFn = vi.fn();
    await expect(
      requestEnsureWallet({ getAccessToken: async () => null, fetch: fetchFn as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(PepuAuthError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps the SDK error body to its code, hint and status", async () => {
    const fetchFn = async () =>
      json({ error: { code: "CONFIG_MISSING_ENV", message: "Missing required env: PRIVY_APP_SECRET", hint: "set it" } }, 500);
    const e = await requestEnsureWallet({ getAccessToken: async () => "t", fetch: fetchFn as unknown as typeof fetch }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(PepuError);
    expect((e as PepuError).code).toBe("CONFIG_MISSING_ENV");
    expect((e as PepuError).hint).toBe("set it");
    expect((e as PepuError).status).toBe(500);
  });

  it("handles legacy string error bodies and unparsable bodies", () => {
    expect(errorFromEnsureResponse(401, { error: "bad" })).toBeInstanceOf(PepuAuthError);
    expect(errorFromEnsureResponse(502, null).code).toBe("WALLET_NOT_PROVISIONED");
    expect(errorFromEnsureResponse(500, { error: { code: "NOT_A_CODE", message: "m" } }).code).toBe("UNKNOWN");
  });

  it("rejects a 200 without a valid address", async () => {
    const fetchFn = async () => json({ address: "nope" });
    await expect(
      requestEnsureWallet({ getAccessToken: async () => "t", fetch: fetchFn as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: "WALLET_NOT_PROVISIONED" });
  });

  it("times out with a retryable error", async () => {
    const fetchFn = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    const e = await requestEnsureWallet({
      getAccessToken: async () => "t",
      timeoutMs: 10,
      fetch: fetchFn as unknown as typeof fetch,
    }).catch((x: unknown) => x);
    expect((e as PepuError).code).toBe("WALLET_NOT_PROVISIONED");
    expect((e as PepuError).retryable).toBe(true);
    expect((e as PepuError).message).toMatch(/timed out/);
  });

  it("never puts the token in a thrown message", async () => {
    const secret = "sk_live_SECRET_TOKEN_123";
    const fetchFn = async () => {
      throw new Error("connection reset");
    };
    const e = await requestEnsureWallet({
      getAccessToken: async () => secret,
      fetch: fetchFn as unknown as typeof fetch,
    }).catch((x: unknown) => x);
    expect(String((e as Error).message)).not.toContain(secret);
  });
});
