import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeProjectId } from "@pepu-chain/sdk/paymaster";
import { createTestClient, isError, jsonOf, textOf } from "../test-helpers.js";

const EP07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A healthy bundler plus paymaster, both on one fake fetch. */
function stubServices(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) return json({ status: "ok" });
      if (url.endsWith("/v2/free-tier")) return json({ enabled: true });
      const body = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
      if (body.method === "eth_chainId") return json({ jsonrpc: "2.0", id: body.id, result: "0x17dcd" });
      if (body.method === "eth_supportedEntryPoints") return json({ jsonrpc: "2.0", id: body.id, result: [EP07] });
      if (body.method === "pm_getPaymasterStubData") return json({ jsonrpc: "2.0", id: body.id, result: { paymaster: EP07 } });
      return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "invalid params" } });
    })
  );
}

const SECRET_URL = "https://pm.example.com/paymaster/canary-token-9f8e7d";

describe("bundler, paymaster and sponsorship probes", () => {
  beforeEach(() => {
    vi.stubEnv("PEPU_BUNDLER_URL", "");
    vi.stubEnv("PEPU_PAYMASTER_URL", "");
    vi.stubEnv("NEXT_PUBLIC_PEPU_BUNDLER_URL", "");
    vi.stubEnv("NEXT_PUBLIC_PEPU_PAYMASTER_URL", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("pepu_bundler_health defaults to the hosted bundler when no URL is set", async () => {
    stubServices();
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_bundler_health", arguments: {} })) as Record<string, unknown>;
    expect(out["configured"]).toBe(true);
    expect(out["host"]).toBe("bundler.pepeunchained.com");
  });

  it("pepu_bundler_health probes a healthy bundler and returns only its host", async () => {
    stubServices();
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_bundler_health", arguments: { url: "https://bundler.example.com/key-abc" } });
    const out = jsonOf(res) as Record<string, unknown>;
    expect(out["verdict"]).toBe("healthy");
    expect(out["chainId"]).toBe(97741);
    expect(out["host"]).toBe("bundler.example.com");
    expect(textOf(res)).not.toContain("key-abc");
  });

  it("pepu_bundler_health reports unhealthy for a bundler on the wrong chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        return json({ jsonrpc: "2.0", id: body.id, result: body.method === "eth_chainId" ? "0x1" : [EP07] });
      })
    );
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_bundler_health", arguments: { url: "https://b.example.com" } })) as { verdict: string; problem: { hint: string } };
    expect(out.verdict).toBe("unhealthy");
    expect(out.problem.hint).toMatch(/97741/);
  });

  it("pepu_paymaster_health never returns the URL (it can embed a token)", async () => {
    stubServices();
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_paymaster_health", arguments: { url: SECRET_URL } });
    const out = jsonOf(res) as Record<string, unknown>;
    expect(out["verdict"]).toBe("healthy");
    expect(out["erc7677StubOk"]).toBe(true);
    expect(out["erc7677"]).toBe("stub-ok");
    expect(textOf(res)).not.toContain("canary-token");
    expect(String(out["v2"])).toMatch(/one-way/);
  });

  it("pepu_paymaster_health reports the stub check as not applicable (null) without a credential, still healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) return json({ status: "ok" });
        if (url.endsWith("/v2/free-tier")) return json({ enabled: true });
        const body = JSON.parse(String(init?.body ?? "{}")) as { id: number };
        return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Invalid params" } });
      })
    );
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_paymaster_health", arguments: { url: "https://paymaster.example.com" } })) as Record<string, unknown>;
    expect(out["verdict"]).toBe("healthy");
    expect(out["erc7677"]).toBe("needs-credential");
    expect(out["erc7677StubOk"]).toBeNull();
  });

  /** Mirrors the live hosted service: ERC-7677 only at /v2/paymaster/<token>; every other POST path is a REST 404. */
  function stubHostedV2(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/health")) return json({ status: "ok" });
        if (url.endsWith("/v2/free-tier")) return json({ enabled: true });
        const body = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string };
        if (/\/v2\/paymaster\/[^/]+$/.test(url) && body.method === "pm_getPaymasterStubData") {
          return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Invalid params: expected [userOp, entryPoint, chainId, context?]." } });
        }
        if (body.method === "eth_chainId") return json({ jsonrpc: "2.0", id: body.id, result: "0x17dcd" });
        if (body.method === "eth_supportedEntryPoints") return json({ jsonrpc: "2.0", id: body.id, result: [EP07] });
        if (String(body.method).startsWith("eth_") || String(body.method).startsWith("pimlico_") || String(body.method).startsWith("zd_")) {
          return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "invalid params" } });
        }
        return json({ error: "not_found" }, 404);
      })
    );
  }

  it("pepu_paymaster_health is healthy for the hosted v2 service by default (invalid-params JSON-RPC error counts as responding)", async () => {
    stubHostedV2();
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_paymaster_health", arguments: {} })) as Record<string, unknown>;
    expect(out["verdict"]).toBe("healthy");
    expect(out["host"]).toBe("paymaster.pepeunchained.com");
    expect(out["erc7677"]).toBe("needs-credential");
    expect(out["freeTierOk"]).toBe(true);
    expect(out["problem"]).toBeUndefined();
  });

  it("pepu_sponsorship_status is available against the hosted v2 service defaults", async () => {
    stubHostedV2();
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_sponsorship_status", arguments: { include_deposit: false } })) as { available: boolean; paymaster: { erc7677: string; ok: boolean } };
    expect(out.available).toBe(true);
    expect(out.paymaster).toMatchObject({ ok: true, erc7677: "needs-credential" });
  });

  it("pepu_bundler_health is unhealthy when a required UserOperation method is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        if (body.method === "eth_chainId") return json({ jsonrpc: "2.0", id: body.id, result: "0x17dcd" });
        if (body.method === "eth_supportedEntryPoints") return json({ jsonrpc: "2.0", id: body.id, result: [EP07] });
        if (body.method === "eth_sendUserOperation") return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
        return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "invalid params" } });
      })
    );
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_bundler_health", arguments: { url: "https://b.example.com" } })) as { verdict: string; missingRequiredMethods: string[] };
    expect(out.verdict).toBe("unhealthy");
    expect(out.missingRequiredMethods).toEqual(["eth_sendUserOperation"]);
  });

  it("pepu_sponsorship_status is unavailable with reasons and fixes when the hosted services do not answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_sponsorship_status", arguments: { include_deposit: false } })) as { available: boolean; fixes: string[]; notes: string[] };
    expect(out.available).toBe(false);
    expect(out.fixes.length).toBeGreaterThan(0);
    expect(out.notes.join(" ")).toMatch(/one-way/);
  });

  it("pepu_sponsorship_status is available when both services answer", async () => {
    stubServices();
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_sponsorship_status", arguments: { bundlerUrl: "https://b.example.com", paymasterUrl: SECRET_URL, include_deposit: false } });
    expect((jsonOf(res) as { available: boolean }).available).toBe(true);
    expect(textOf(res)).not.toContain("canary-token");
  });



  it("pepu_project_balance rejects both or neither of appId and projectId", async () => {
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_project_balance", arguments: {} });
    expect(isError(res)).toBe(true);
  });
});
