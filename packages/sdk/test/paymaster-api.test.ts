import { parseSiweMessage } from "viem/siwe";
import type { Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import { PepuConfigError, PepuPaymasterError } from "../src/errors.js";
import {
  assertApproved,
  buildErc7677Url,
  createPaymasterApi,
  credentialKind,
  serializeAttestation,
} from "../src/paymaster/api.js";
import type { SponsorUserOp } from "../src/paymaster/api.js";

const BASE = "https://paymaster.example.com";
const ID = `0x${"ab".repeat(32)}` as Hex;
const ADDR: Address = "0x2222222222222222222222222222222222222222";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(handler: (c: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: r.headers ?? {},
    });
  });
  return { f: f as unknown as typeof fetch, calls };
}

const userOp: SponsorUserOp = {
  sender: ADDR,
  nonce: 1n,
  callData: "0x1234",
  callGasLimit: 100n,
  verificationGasLimit: "0x10",
  preVerificationGas: 5n,
  maxFeePerGas: 7n,
  maxPriorityFeePerGas: 1n,
};

describe("createPaymasterApi config", () => {
  it("defaults to the hosted paymaster base when no URL is configured", async () => {
    const { f, calls } = fakeFetch(() => ({ body: {} }));
    const api = createPaymasterApi({ env: {}, fetch: f });
    await api.v2.freeTier();
    expect(calls[0]?.url).toBe("https://paymaster.pepeunchained.com/v2/free-tier");
  });

  it("derives the base from a configured ERC-7677 URL", async () => {
    const { f, calls } = fakeFetch(() => ({ body: {} }));
    const api = createPaymasterApi({ env: { PEPU_PAYMASTER_URL: "https://pm.example/v2/paymaster/ppt_x" }, fetch: f });
    await api.v2.freeTier();
    expect(calls[0]?.url).toBe("https://pm.example/v2/free-tier");
  });
  it("reads PEPU_PAYMASTER_URL and strips trailing slashes", () => {
    const api = createPaymasterApi({ env: { PEPU_PAYMASTER_URL: `${BASE}//` } });
    expect(api.baseUrl).toBe(BASE);
  });
  it("rejects non-http URLs", () => {
    expect(() => createPaymasterApi({ baseUrl: "ftp://x.test" })).toThrow(PepuConfigError);
  });
});

describe("ERC-7677 URL builder", () => {
  it("builds v1 and v2 paths and encodes the token", () => {
    expect(buildErc7677Url({ baseUrl: BASE, token: "ppt_abc", version: 1 })).toBe(`${BASE}/paymaster/ppt_abc`);
    expect(buildErc7677Url({ baseUrl: `${BASE}/`, token: "ppt_abc" })).toBe(`${BASE}/v2/paymaster/ppt_abc`);
    expect(buildErc7677Url({ baseUrl: BASE, token: "a/b" })).toBe(`${BASE}/v2/paymaster/a%2Fb`);
  });
  it("validates input", () => {
    expect(() => buildErc7677Url({ baseUrl: BASE, token: " " })).toThrow(PepuConfigError);
    expect(() => buildErc7677Url({ baseUrl: "nope", token: "ppt_x" })).toThrow(PepuConfigError);
  });
  it("refuses a server key in a browser", () => {
    const g = globalThis as { window?: unknown };
    g.window = {};
    try {
      expect(() => buildErc7677Url({ baseUrl: BASE, token: "ppk_secret" })).toThrow(/server key/);
      expect(() => buildErc7677Url({ baseUrl: BASE, token: "ppt_ok" })).not.toThrow();
    } finally {
      delete g.window;
    }
    expect(buildErc7677Url({ baseUrl: BASE, token: "ppk_secret" })).toContain("ppk_secret");
  });
  it("exposes builders on the client and classifies credentials", () => {
    const api = createPaymasterApi({ baseUrl: BASE });
    expect(api.v1.erc7677Url("ppt_a")).toBe(`${BASE}/paymaster/ppt_a`);
    expect(api.v2.erc7677Url("ppt_a")).toBe(`${BASE}/v2/paymaster/ppt_a`);
    expect(credentialKind("ppt_x")).toBe("client");
    expect(credentialKind("ppk_x")).toBe("server");
    expect(credentialKind("other")).toBeNull();
  });
});

describe("sponsor", () => {
  const approved = {
    status: "approved",
    chainId: 97741,
    paymaster: ADDR,
    paymasterVerificationGasLimit: "0x1",
    paymasterPostOpGasLimit: "0x2",
    paymasterData: "0x00",
    validUntil: 2,
    validAfter: 1,
    userOpHash: ID,
  };

  it("v1 posts hex-encoded userOp with X-Api-Key and Bearer", async () => {
    const { f, calls } = fakeFetch(() => ({ body: approved }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    const r = await api.v1.sponsor(userOp, { apiKey: "ppk_k", privyAccessToken: "tok" });
    expect(r.status).toBe("approved");
    const c = calls[0]!;
    expect(c.url).toBe(`${BASE}/sponsor`);
    expect(c.method).toBe("POST");
    expect(c.headers["x-api-key"]).toBe("ppk_k");
    expect(c.headers["authorization"]).toBe("Bearer tok");
    expect(c.body).toEqual({
      userOp: {
        sender: ADDR,
        nonce: "0x1",
        callData: "0x1234",
        callGasLimit: "0x64",
        verificationGasLimit: "0x10",
        preVerificationGas: "0x5",
        maxFeePerGas: "0x7",
        maxPriorityFeePerGas: "0x1",
      },
    });
  });
  it("v1 requires a Privy access token", async () => {
    const { f, calls } = fakeFetch(() => ({ body: approved }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    await expect(api.v1.sponsor(userOp, { apiKey: "k" })).rejects.toMatchObject({ code: "PAYMASTER_IDENTITY_REQUIRED" });
    expect(calls).toHaveLength(0);
  });
  it("v2 works with only an API key (any wallet) and forwards Origin", async () => {
    const { f, calls } = fakeFetch(() => ({ body: approved }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    await api.v2.sponsor(userOp, { apiKey: "ppt_k", origin: "https://app.example.com" });
    expect(calls[0]!.url).toBe(`${BASE}/v2/sponsor`);
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(calls[0]!.headers["origin"]).toBe("https://app.example.com");
  });
  it("returns denials (HTTP 4xx with a denied body) instead of throwing, and assertApproved maps them", async () => {
    const { f } = fakeFetch(() => ({
      status: 403,
      body: { status: "denied", reason: "project_not_claimed_onchain", message: "claim it first" },
    }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    const r = await api.v2.sponsor(userOp, { apiKey: "ppt_k" });
    expect(r).toMatchObject({ status: "denied", reason: "project_not_claimed_onchain" });
    let err: unknown;
    try {
      assertApproved(r);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PepuPaymasterError);
    expect((err as PepuPaymasterError).code).toBe("PAYMASTER_PROJECT_NOT_CLAIMED");
    expect(assertApproved({ ...approved, status: "approved" } as never).status).toBe("approved");
  });
  it("maps project_owner_changed", () => {
    expect(() => assertApproved({ status: "denied", reason: "project_owner_changed", message: "x" })).toThrowError(
      expect.objectContaining({ code: "PAYMASTER_PROJECT_OWNER_CHANGED" }) as never,
    );
  });
  it("throws a typed error when the response is not a sponsor body", async () => {
    const { f } = fakeFetch(() => ({ status: 502, body: { error: "bad_gateway", message: "oops" } }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    await expect(api.v2.sponsor(userOp, { apiKey: "k" })).rejects.toMatchObject({ code: "PAYMASTER_API_ERROR" });
  });
  it("requires an apiKey", async () => {
    const api = createPaymasterApi({ baseUrl: BASE, fetch: fakeFetch(() => ({})).f });
    await expect(api.v2.sponsor(userOp, { apiKey: "" })).rejects.toBeInstanceOf(PepuConfigError);
  });
  it("wraps network failures without leaking the credential", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED with ppk_supersecret in it");
    }) as unknown as typeof fetch;
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    let err: PepuPaymasterError | undefined;
    try {
      await api.v2.sponsor(userOp, { apiKey: "ppk_supersecret" });
    } catch (e) {
      err = e as PepuPaymasterError;
    }
    expect(err?.code).toBe("PAYMASTER_UNREACHABLE");
    expect(JSON.stringify({ m: err?.message, d: err?.details, h: err?.hint })).not.toContain("ppk_supersecret");
    expect(err?.cause).toBeUndefined();
  });
});

describe("v2 public and SIWE", () => {
  it("fetches config, contract and free tier", async () => {
    const { f, calls } = fakeFetch((c) => ({ body: { path: c.url } }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    await api.v2.config();
    await api.v2.contract();
    await api.v2.freeTier();
    await api.v1.health();
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v2/config`, `${BASE}/v2/contract`, `${BASE}/v2/free-tier`, `${BASE}/health`]);
  });

  it("loginWithWallet builds an EIP-4361 message from the nonce, signs it and stores the session", async () => {
    let signed = "";
    const { f, calls } = fakeFetch((c) => {
      if (c.url.endsWith("/v2/auth/nonce")) return { body: { nonce: "abcdef123456", expiresAt: "x" } };
      return { body: { token: "sess-token", address: ADDR, expiresAt: "2030-01-01T00:00:00.000Z" } };
    });
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    const r = await api.v2.loginWithWallet(
      async (m) => {
        signed = m;
        return "0xbeef";
      },
      { address: ADDR, domain: "app.example.com", now: () => Date.UTC(2030, 0, 1) },
    );
    expect(r.token).toBe("sess-token");
    expect(api.v2.getSessionToken()).toBe("sess-token");
    const m = parseSiweMessage(signed);
    expect(m).toMatchObject({ domain: "app.example.com", nonce: "abcdef123456", chainId: 97741, version: "1", address: ADDR });
    expect(m.expirationTime!.getTime() - m.issuedAt!.getTime()).toBe(300_000);
    expect(calls[1]!.body).toEqual({ message: signed, signature: "0xbeef" });
  });
  it("login failure surfaces the service reason", async () => {
    const { f } = fakeFetch(() => ({ status: 401, body: { error: "login_failed", message: "SIWE login rejected: domain_mismatch", reason: "domain_mismatch" } }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    await expect(api.v2.auth.login("m", "0x01")).rejects.toMatchObject({ code: "PAYMASTER_DENIED" });
    expect(api.v2.getSessionToken()).toBeNull();
  });
  it("owner endpoints refuse to run without a session", async () => {
    const { f, calls } = fakeFetch(() => ({}));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f });
    await expect(api.v2.projects.list()).rejects.toMatchObject({ code: "PAYMASTER_SESSION_REQUIRED" });
    await expect(api.v2.me()).rejects.toMatchObject({ code: "PAYMASTER_SESSION_REQUIRED" });
    expect(calls).toHaveLength(0);
  });
  it("logout clears the session", async () => {
    const { f } = fakeFetch(() => ({ body: { status: "ok" } }));
    const api = createPaymasterApi({ baseUrl: BASE, fetch: f, sessionToken: "t" });
    await api.v2.auth.logout();
    expect(api.v2.getSessionToken()).toBeNull();
  });
  it("maps 401 unauthenticated to PAYMASTER_SESSION_REQUIRED and 429 to retryable rate limit", async () => {
    const a = createPaymasterApi({
      baseUrl: BASE,
      sessionToken: "t",
      fetch: fakeFetch(() => ({ status: 401, body: { error: "unauthenticated", message: "expired" } })).f,
    });
    await expect(a.v2.me()).rejects.toMatchObject({ code: "PAYMASTER_SESSION_REQUIRED" });
    const b = createPaymasterApi({
      baseUrl: BASE,
      fetch: fakeFetch(() => ({ status: 429, headers: { "retry-after": "12" }, body: { error: "rate_limited", message: "slow down" } })).f,
    });
    await expect(b.v2.auth.nonce()).rejects.toMatchObject({
      code: "PAYMASTER_RATE_LIMITED",
      retryable: true,
      details: expect.objectContaining({ retryAfterSeconds: 12 }) as never,
    });
  });
});

describe("v2 projects", () => {
  function authed(handler: Parameters<typeof fakeFetch>[0] = () => ({ body: {} })) {
    const h = fakeFetch(handler);
    return { ...h, api: createPaymasterApi({ baseUrl: BASE, fetch: h.f, sessionToken: "sess" }) };
  }

  it("prepare posts the action with the bearer session", async () => {
    const { api, calls } = authed(() => ({ body: { to: ADDR, data: "0x", value: "0" } }));
    await api.v2.projects.prepare({ action: "setPaused", projectId: ID, paused: true });
    expect(calls[0]).toMatchObject({ url: `${BASE}/v2/projects/prepare`, method: "POST" });
    expect(calls[0]!.headers["authorization"]).toBe("Bearer sess");
    expect(calls[0]!.body).toEqual({ action: "setPaused", projectId: ID, paused: true });
  });
  it("covers register, list, get, rotate, settings, usage, events, allowlist", async () => {
    const { api, calls } = authed();
    await api.v2.projects.register({ appId: "app", allowedOrigins: ["https://a.example"] });
    await api.v2.projects.list();
    await api.v2.projects.get(ID);
    await api.v2.projects.rotateClientToken(ID);
    await api.v2.projects.rotateServerKey(ID);
    await api.v2.projects.updateSettings(ID, { requireIdentity: true });
    await api.v2.projects.usage(ID, { limit: 5 });
    await api.v2.projects.events(ID, { fromBlock: 10, limit: 2 });
    await api.v2.projects.allowlist(ID);
    expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual([
      "POST /v2/projects",
      "GET /v2/projects",
      `GET /v2/projects/${ID}`,
      `POST /v2/projects/${ID}/token/rotate`,
      `POST /v2/projects/${ID}/server-key/rotate`,
      `PATCH /v2/projects/${ID}/settings`,
      `GET /v2/projects/${ID}/usage?limit=5`,
      `GET /v2/projects/${ID}/events?fromBlock=10&limit=2`,
      `GET /v2/projects/${ID}/allowlist`,
    ]);
  });
  it("rejects a malformed project id before any request", async () => {
    const { api, calls } = authed();
    await expect(api.v2.projects.get("0x12" as Hex)).rejects.toBeInstanceOf(PepuPaymasterError);
    expect(calls).toHaveLength(0);
  });
  it("403 owner errors map to PAYMASTER_DENIED", async () => {
    const { api } = authed(() => ({ status: 403, body: { error: "forbidden", message: "not the owner" } }));
    await expect(api.v2.projects.get(ID)).rejects.toMatchObject({ code: "PAYMASTER_DENIED" });
  });
  it("maps a service reason in an error body", async () => {
    const { api } = authed(() => ({
      status: 409,
      body: { error: "not_claimed_onchain", reason: "project_not_claimed_onchain", message: "claim first" },
    }));
    await expect(api.v2.projects.register({ appId: "x" })).rejects.toMatchObject({ code: "PAYMASTER_PROJECT_NOT_CLAIMED" });
  });
  it("serializeAttestation produces decimal strings", () => {
    expect(serializeAttestation({ appId: "a", newOwner: ADDR, nonce: 5n, deadline: 6n, signature: "0x01" })).toEqual({
      appId: "a",
      newOwner: ADDR,
      nonce: "5",
      deadline: "6",
      signature: "0x01",
    });
  });
});
