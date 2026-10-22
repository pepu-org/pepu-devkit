import type { Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import { PepuPaymasterError } from "../src/errors.js";
import { createPaymasterApi } from "../src/paymaster/api.js";
import { requestClaimAttestation } from "../src/paymaster/server.js";

const BASE = "https://paymaster.example.com";
const OWNER: Address = "0x2222222222222222222222222222222222222222";
const APP = "clx0example0app0id";
const SECRET = "privy-app-secret-DO-NOT-LEAK-12345";
const attestation = { appId: APP, newOwner: OWNER, nonce: "1", deadline: "1900000000", signature: "0xabcd" as Hex };

function api(handler: (body: unknown, headers: Record<string, string>, url: string) => Response | Promise<Response>) {
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(typeof init?.body === "string" ? JSON.parse(init.body) : undefined, (init?.headers ?? {}) as Record<string, string>, String(url)),
  );
  return { f, client: createPaymasterApi({ baseUrl: BASE, fetch: f as unknown as typeof fetch, sessionToken: "sess" }) };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("requestClaimAttestation", () => {
  it("posts appId, appSecret and ownerAddress with the session and returns the attestation", async () => {
    const { client, f } = api((body, headers, url) => {
      expect(url).toBe(`${BASE}/v2/projects/verify`);
      expect(headers["authorization"]).toBe("Bearer sess");
      expect(body).toEqual({ appId: APP, appSecret: SECRET, ownerAddress: OWNER });
      return json(200, {
        projectId: `0x${"11".repeat(32)}`,
        appId: APP,
        ownerAddress: OWNER,
        action: "claimProject",
        attestation,
        expiresAt: "2030-01-01T00:00:00.000Z",
        note: "n",
      });
    });
    const r = await requestClaimAttestation(client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.action).toBe("claimProject");
    expect(r.attestation).toEqual(attestation);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("passes through takesEffect (a claim of a funded project is pending for the admin delay) and omits it for an older service", async () => {
    const body = { projectId: `0x${"11".repeat(32)}`, appId: APP, ownerAddress: OWNER, action: "claimProject", attestation, expiresAt: "2030-01-01T00:00:00.000Z" };
    const pending = api(() => json(200, { ...body, takesEffect: "after_admin_change_delay" }));
    const r = await requestClaimAttestation(pending.client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET });
    expect(r.takesEffect).toBe("after_admin_change_delay");
    const old = api(() => json(200, body));
    const r2 = await requestClaimAttestation(old.client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET });
    expect(r2).not.toHaveProperty("takesEffect");
  });

  it("requires a session before sending anything", async () => {
    const { f } = api(() => json(200, {}));
    const client = createPaymasterApi({ baseUrl: BASE, fetch: f as unknown as typeof fetch });
    await expect(requestClaimAttestation(client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET })).rejects.toMatchObject({
      code: "PAYMASTER_SESSION_REQUIRED",
    });
    expect(f).not.toHaveBeenCalled();
  });

  async function capture(fn: () => Promise<unknown>): Promise<PepuPaymasterError> {
    try {
      await fn();
    } catch (e) {
      return e as PepuPaymasterError;
    }
    throw new Error("expected a throw");
  }
  function everything(e: PepuPaymasterError): string {
    return JSON.stringify({
      name: e.name,
      message: e.message,
      hint: e.hint,
      docs: e.docsUrl,
      details: e.details,
      cause: e.cause,
      stack: e.stack,
    });
  }

  it("never puts the secret in thrown errors, even if the service echoes it", async () => {
    for (const status of [400, 403, 409, 429, 501, 502]) {
      const { client } = api(() => json(status, { error: "x_error", message: `bad credentials ${SECRET}`, reason: undefined }));
      const e = await capture(() => requestClaimAttestation(client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET }));
      expect(e).toBeInstanceOf(PepuPaymasterError);
      expect(everything(e)).not.toContain(SECRET);
    }
  });

  it("never puts the secret in network errors", async () => {
    const f = vi.fn(async () => {
      throw new Error(`socket hang up, body was ${SECRET}`);
    });
    const client = createPaymasterApi({ baseUrl: BASE, fetch: f as unknown as typeof fetch, sessionToken: "sess" });
    const e = await capture(() => requestClaimAttestation(client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET }));
    expect(e.code).toBe("PAYMASTER_UNREACHABLE");
    expect(everything(e)).not.toContain(SECRET);
  });

  it("never echoes the secret from local validation errors", async () => {
    const { client, f } = api(() => json(200, {}));
    const bad = "x".repeat(600) + SECRET;
    const e = await capture(() => requestClaimAttestation(client, { appId: APP, newOwner: OWNER, privyAppSecret: bad }));
    expect(everything(e)).not.toContain(SECRET);
    const e2 = await capture(() => requestClaimAttestation(client, { appId: "bad id " + SECRET, newOwner: OWNER, privyAppSecret: SECRET }));
    expect(everything(e2)).not.toContain(SECRET);
    const e3 = await capture(() => requestClaimAttestation(client, { appId: APP, newOwner: ("nope" + SECRET) as Address, privyAppSecret: SECRET }));
    expect(everything(e3)).not.toContain(SECRET);
    expect(f).not.toHaveBeenCalled();
  });

  it("uses fixed messages: the service's own message is dropped on this route", async () => {
    const { client } = api(() => json(403, { error: "invalid_privy_credentials", message: "Privy did not accept that app id and secret" }));
    const e = await capture(() => requestClaimAttestation(client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET }));
    expect(e.message).toBe("Paymaster API 403 invalid_privy_credentials.");
    expect(e.code).toBe("PAYMASTER_DENIED");
  });

  it("maps a 409 already_owner and a 429 retryable", async () => {
    const a = api(() => json(409, { error: "already_owner", message: "m" }));
    await expect(requestClaimAttestation(a.client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET })).rejects.toMatchObject({
      code: "PAYMASTER_API_ERROR",
      details: expect.objectContaining({ status: 409, error: "already_owner" }) as never,
    });
    const b = api(() => json(429, { error: "rate_limited", message: "m" }));
    await expect(requestClaimAttestation(b.client, { appId: APP, newOwner: OWNER, privyAppSecret: SECRET })).rejects.toMatchObject({
      code: "PAYMASTER_RATE_LIMITED",
      retryable: true,
    });
  });
});
