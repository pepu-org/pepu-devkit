import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";

import { normalizeCalls, userOpEventFromReceipt } from "../src/aa/calls.js";
import {
  createPepuBundlerClient,
  createPepuPaymasterClient,
  estimatePepuUserOpFees,
  requireBundlerUrl,
  requirePaymasterUrl,
} from "../src/aa/clients.js";
import { describeUserOpFailure, redactSecrets } from "../src/aa/describe.js";
import { getPaymasterDeposit, probeBundler, probePaymaster } from "../src/aa/probes.js";
import { checkSponsorship } from "../src/aa/status.js";
import { resolvePepuEndpoints } from "../src/endpoints.js";
import { PepuBundlerError, PepuPaymasterError } from "../src/errors.js";

const SECRET = "sk_live_SUPERSECRET123";
const EP = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function bundlerFetch(over: { chainId?: string; eps?: string[]; missing?: string[] } = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    if (method === "eth_chainId") return json({ result: over.chainId ?? "0x17dcd" });
    if (method === "eth_supportedEntryPoints") return json({ result: over.eps ?? [EP] });
    if (over.missing?.includes(method)) return json({ error: { code: -32601, message: "Method not found" } });
    return json({ error: { code: -32602, message: "invalid params" } });
  });
}

describe("describeUserOpFailure", () => {
  it("maps AA25 to a bundler error with a nonce hint", () => {
    const e = describeUserOpFailure(new Error("UserOperation reverted: AA25 invalid account nonce"));
    expect(e).toBeInstanceOf(PepuBundlerError);
    expect(e.code).toBe("BUNDLER_AA_FAILED");
    expect(e.hint).toMatch(/nonce/i);
  });

  it("maps AA31 to a paymaster no-balance error", () => {
    const e = describeUserOpFailure(new Error("AA31 paymaster deposit too low"));
    expect(e).toBeInstanceOf(PepuPaymasterError);
    expect(e.code).toBe("PAYMASTER_NO_BALANCE");
  });

  it("reads paymaster reasons from the cause chain (viem details)", () => {
    const inner = Object.assign(new Error("rpc"), { details: "sender_not_owned_by_token_user" });
    const outer = Object.assign(new Error("UserOperationExecutionError"), { cause: inner });
    const e = describeUserOpFailure(outer);
    expect(e).toBeInstanceOf(PepuPaymasterError);
    expect(e.code).toBe("PAYMASTER_DENIED");
  });

  it("falls back to UNKNOWN", () => {
    expect(describeUserOpFailure(new Error("weird")).code).toBe("UNKNOWN");
  });

  it("never leaks secrets in messages", () => {
    const e = describeUserOpFailure(
      new Error(`POST https://pm.example/paymaster/${SECRET} failed AA33 Bearer ${SECRET} x-api-key: ${SECRET}`),
    );
    expect(e.message).not.toContain(SECRET);
    expect(e.hint).not.toContain(SECRET);
    expect(redactSecrets(`https://u:${SECRET}@h.example/x`)).not.toContain(SECRET);
  });
});

describe("normalizeCalls", () => {
  const to = "0x0000000000000000000000000000000000000002" as const;
  it("encodes abi calls and defaults value", () => {
    const abi = parseAbi(["function tap()"]);
    const [c] = normalizeCalls([{ to, abi, functionName: "tap" }]);
    expect(c?.data.length).toBe(10);
    expect(c?.value).toBe(0n);
  });
  it("rejects empty and ambiguous calls", () => {
    expect(() => normalizeCalls([])).toThrow();
    expect(() => normalizeCalls([{ to, data: "0x", functionName: "x" }])).toThrow();
    expect(() => normalizeCalls([{ to, functionName: "x" }])).toThrow();
  });
});

describe("userOpEventFromReceipt", () => {
  it("reads paymaster and cost", () => {
    const sender = "0x00000000000000000000000000000000000000aa";
    const paymaster = "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0";
    const topics = encodeEventTopics({
      abi: entryPoint07Abi,
      eventName: "UserOperationEvent",
      args: { userOpHash: `0x${"11".repeat(32)}`, sender, paymaster },
    });
    const data = encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [5n, true, 1234n, 99n],
    );
    const r = userOpEventFromReceipt({ logs: [{ address: EP, topics, data } as never] }, sender);
    expect(r?.paymaster?.toLowerCase()).toBe(paymaster.toLowerCase());
    expect(r?.actualGasCost).toBe(1234n);
    expect(r?.success).toBe(true);
    expect(userOpEventFromReceipt({ logs: [] }, sender)).toBeNull();
  });
});

describe("fees and clients", () => {
  it("applies 20% headroom to maxFeePerGas only", async () => {
    const fees = await estimatePepuUserOpFees({
      estimateFeesPerGas: async () => ({ maxFeePerGas: 1000n, maxPriorityFeePerGas: 7n }),
    } as never);
    expect(fees).toEqual({ maxFeePerGas: 1200n, maxPriorityFeePerGas: 7n });
  });

  it("builds the hosted ERC-7677 URL from a project token and needs one otherwise", () => {
    const prev = process.env["PEPU_PAYMASTER_URL"];
    delete process.env["PEPU_PAYMASTER_URL"];
    try {
      expect(requirePaymasterUrl(undefined, "ppt_abc")).toBe("https://paymaster.pepeunchained.com/v2/paymaster/ppt_abc");
      expect(requirePaymasterUrl("https://pm.example/v2/paymaster/ppt_z", "ppt_abc")).toBe("https://pm.example/v2/paymaster/ppt_z");
      expect(() => createPepuPaymasterClient({ paymasterToken: "ppt_abc" })).not.toThrow();
      // The default bundler is the hosted one, so a bundler client no longer needs configuration.
      expect(requireBundlerUrl()).toBe("https://bundler.pepeunchained.com");
    } finally {
      if (prev !== undefined) process.env["PEPU_PAYMASTER_URL"] = prev;
    }
  });

  it("throws CONFIG_MISSING_ENV naming the variable when no paymaster token URL is configured", () => {
    const prev = { b: process.env["PEPU_BUNDLER_URL"], p: process.env["PEPU_PAYMASTER_URL"] };
    delete process.env["PEPU_BUNDLER_URL"];
    delete process.env["PEPU_PAYMASTER_URL"];
    try {
      expect(() => createPepuPaymasterClient()).toThrow(/PEPU_PAYMASTER_URL/);
    } finally {
      if (prev.b !== undefined) process.env["PEPU_BUNDLER_URL"] = prev.b;
      if (prev.p !== undefined) process.env["PEPU_PAYMASTER_URL"] = prev.p;
    }
  });

  it("injects the paymaster context into stub and final data calls", async () => {
    const bodies: unknown[][] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)) as { params: unknown[] };
      bodies.push(b.params);
      return json({ jsonrpc: "2.0", id: 1, result: { paymaster: EP, paymasterData: "0x" } });
    }) as typeof fetch;
    try {
      const pm = createPepuPaymasterClient({ paymasterUrl: "https://pm.example/paymaster/tok", context: { privyAccessToken: "t" } });
      await pm.getPaymasterStubData({
        chainId: 97741,
        entryPointAddress: EP,
        sender: "0x00000000000000000000000000000000000000aa",
        callData: "0x",
        nonce: 0n,
      } as never);
      expect(bodies[0]?.[3]).toEqual({ privyAccessToken: "t" });
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("probeBundler", () => {
  it("is ok for chain 97741 with EntryPoint v0.7 and reports supported methods", async () => {
    const r = await probeBundler("https://b.example", {
      fetch: bundlerFetch({ missing: ["zd_getUserOperationGasPrice"] }),
    });
    expect(r.ok).toBe(true);
    expect(r.chainId).toBe(97741);
    expect(r.supportedMethods?.["eth_sendUserOperation"]).toBe(true);
    expect(r.supportedMethods?.["zd_getUserOperationGasPrice"]).toBe(false);
  });
  it("treats Alto-style -32601 validation errors as supported and its discriminator error as unsupported", async () => {
    const alto = vi.fn(async (_url: string, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      if (method === "eth_chainId") return json({ result: "0x17dcd" });
      if (method === "eth_supportedEntryPoints") return json({ result: [EP] });
      if (method === "zd_getUserOperationGasPrice") {
        return json({ error: { code: -32601, message: "Validation error: Invalid discriminator value. Expected 'eth_chainId' | 'eth_sendUserOperation'" } });
      }
      return json({ error: { code: -32601, message: 'Validation error: Array must contain at least 2 element(s) at "params"' } });
    });
    const r = await probeBundler("https://b.example", { fetch: alto });
    expect(r.ok).toBe(true);
    expect(r.supportedMethods?.["eth_sendUserOperation"]).toBe(true);
    expect(r.supportedMethods?.["eth_estimateUserOperationGas"]).toBe(true);
    expect(r.supportedMethods?.["eth_getUserOperationReceipt"]).toBe(true);
    expect(r.supportedMethods?.["zd_getUserOperationGasPrice"]).toBe(false);
    expect(r.missingRequiredMethods).toEqual([]);
  });
  it("is not ok when a required method is missing", async () => {
    const r = await probeBundler("https://b.example", { fetch: bundlerFetch({ missing: ["eth_sendUserOperation"] }) });
    expect(r.ok).toBe(false);
    expect(r.missingRequiredMethods).toEqual(["eth_sendUserOperation"]);
    expect(r.error?.message).toMatch(/eth_sendUserOperation/);
  });
  it("fails on wrong chain", async () => {
    const r = await probeBundler("https://b.example", { fetch: bundlerFetch({ chainId: "0x1" }) });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/chain 1/);
  });
  it("reports unreachable without leaking the URL", async () => {
    const r = await probeBundler(`https://u:${SECRET}@b.example/${SECRET}`, {
      fetch: async () => {
        throw new Error(`connect ECONNREFUSED https://b.example/${SECRET}`);
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("BUNDLER_UNREACHABLE");
    expect(r.error?.message).not.toContain(SECRET);
  });
  it("throws CONFIG_BAD_URL for a malformed URL", async () => {
    await expect(probeBundler("nope")).rejects.toMatchObject({ code: "CONFIG_BAD_URL" });
  });
});

describe("probePaymaster", () => {
  const paymasterFetch = (opts: { health?: boolean; rpc?: "result" | "error" | "throw" }) =>
    vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return opts.health === false ? json({}, 500) : json({ status: "ok" });
      if (url.endsWith("/v2/free-tier")) return json({ enabled: true });
      if (opts.rpc === "throw") throw new Error("boom");
      return opts.rpc === "error"
        ? json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "denied" } })
        : json({ jsonrpc: "2.0", id: 1, result: { paymaster: EP, paymasterData: "0x" } });
    });

  it("is ok with health and stub data", async () => {
    const r = await probePaymaster("https://pm.example/paymaster/tok", { fetch: paymasterFetch({ rpc: "result" }) });
    expect(r).toMatchObject({ ok: true, health: true, erc7677StubOk: true, freeTier: { enabled: true } });
  });
  it("is ok and reports needs-credential (stub not applicable) when the endpoint denies", async () => {
    const r = await probePaymaster("https://pm.example/paymaster/tok", { fetch: paymasterFetch({ rpc: "error" }) });
    expect(r.ok).toBe(true);
    expect(r.erc7677).toBe("needs-credential");
    expect(r.erc7677StubOk).toBeUndefined();
  });
  it("is not ok when the URL does not speak JSON-RPC", async () => {
    const notRpc = vi.fn(async (url: string) =>
      url.endsWith("/health") ? json({ status: "ok" }) : url.endsWith("/v2/free-tier") ? json({ enabled: true }) : json({ error: "not_found" }, 404),
    );
    const r = await probePaymaster("https://pm.example/v2/paymaster/tok", { fetch: notRpc });
    expect(r.ok).toBe(false);
    expect(r.erc7677).toBe("not-responding");
    expect(r.erc7677StubOk).toBe(false);
  });
  it("reports unreachable with a redacted message", async () => {
    const r = await probePaymaster(`https://pm.example/paymaster/${SECRET}`, {
      fetch: async () => {
        throw new Error(`fetch failed https://pm.example/paymaster/${SECRET}`);
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.message).not.toContain(SECRET);
  });

  describe("against a realistic v2 service", () => {
    /** Serves ONLY the v2 routes; the origin root and /paymaster/* answer a REST 404, like the live service. */
    const v2Service = (opts: { rpc?: "invalid-params" | "five-hundred" | "html" | "net" } = {}) => {
      const seen: Array<{ url: string; method: string; body?: string }> = [];
      const f = vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({ url, method: init?.method ?? "GET", ...(init?.body ? { body: String(init.body) } : {}) });
        if (url.endsWith("/health")) return json({ status: "ok" });
        if (url.endsWith("/v2/free-tier")) return json({ enabled: true, pool: { balance: "1" } });
        if (/\/v2\/paymaster\/[^/]+$/.test(url) && init?.method === "POST") {
          if (opts.rpc === "net") throw new Error("socket hang up");
          if (opts.rpc === "five-hundred") return json({ error: "boom" }, 502);
          if (opts.rpc === "html") return new Response("<html>bad gateway</html>", { status: 200 });
          return json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params: expected [userOp, entryPoint, chainId, context?]." } });
        }
        return json({ error: "not_found" }, 404);
      });
      return { f, seen };
    };

    it("probes the v2 route with a placeholder token (not the origin root) and treats invalid params as responding", async () => {
      const { f, seen } = v2Service();
      const r = await probePaymaster("https://paymaster.example", { fetch: f });
      expect(r).toMatchObject({ ok: true, health: true, freeTierOk: true, erc7677: "needs-credential" });
      expect(r.error).toBeUndefined();
      const post = seen.find((s) => s.method === "POST");
      expect(post?.url).toBe("https://paymaster.example/v2/paymaster/pepu-probe");
      expect(JSON.parse(post?.body ?? "{}").params).toEqual([]);
      expect(r.erc7677Route).toBe("https://paymaster.example/v2/paymaster/<probe>");
    });
    it("defaults to the hosted service base and accepts null and undefined", async () => {
      for (const arg of [undefined, null] as const) {
        const { f, seen } = v2Service();
        const r = await probePaymaster(arg, { fetch: f });
        expect(r.ok).toBe(true);
        expect(seen[0]?.url).toBe("https://paymaster.pepeunchained.com/health");
      }
    });
    it("type-checks with the resolvePepuEndpoints() base", async () => {
      const { f } = v2Service();
      const r = await probePaymaster(resolvePepuEndpoints({ env: {} }).paymasterBaseUrl, { fetch: f });
      expect(r.ok).toBe(true);
    });
    it("is not-responding for 5xx and reports PAYMASTER_API_ERROR with an accurate hint", async () => {
      const { f } = v2Service({ rpc: "five-hundred" });
      const r = await probePaymaster("https://paymaster.example", { fetch: f });
      expect(r.ok).toBe(false);
      expect(r.erc7677).toBe("not-responding");
      expect(r.error?.code).toBe("PAYMASTER_API_ERROR");
      expect(r.error?.hint).toMatch(/\/v2\/paymaster\/<client token>/);
    });
    it("is not-responding for a non-JSON answer", async () => {
      const { f } = v2Service({ rpc: "html" });
      const r = await probePaymaster("https://paymaster.example", { fetch: f });
      expect(r.erc7677).toBe("not-responding");
      expect(r.ok).toBe(false);
    });
    it("is not-responding on a network error on the route but still ok:false with PAYMASTER_API_ERROR when the host is reachable", async () => {
      const { f } = v2Service({ rpc: "net" });
      const r = await probePaymaster("https://paymaster.example", { fetch: f });
      expect(r.erc7677).toBe("not-responding");
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe("PAYMASTER_API_ERROR");
    });
    it("reports PAYMASTER_UNREACHABLE (never BUNDLER_UNREACHABLE) when nothing answers", async () => {
      const r = await probePaymaster("https://paymaster.example", {
        fetch: async () => {
          throw new Error("offline");
        },
      });
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe("PAYMASTER_UNREACHABLE");
      expect(r.error).toBeInstanceOf(PepuPaymasterError);
    });
    it("probeBundler defaults to the hosted bundler and accepts null", async () => {
      const urls: string[] = [];
      const f = vi.fn(async (url: string) => {
        urls.push(url);
        throw new Error("offline");
      });
      await probeBundler(undefined, { fetch: f });
      await probeBundler(null, { fetch: f });
      expect(urls.every((u) => u === "https://bundler.pepeunchained.com")).toBe(true);
      expect(urls.length).toBeGreaterThan(0);
    });
  });
});

describe("getPaymasterDeposit", () => {
  it("reads EntryPoint balanceOf for the paymaster", async () => {
    const readContract = vi.fn(async () => 42n);
    const v = await getPaymasterDeposit({ readContract } as never);
    expect(v).toBe(42n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "balanceOf", address: EP }),
    );
  });
});

describe("checkSponsorship", () => {
  it("defaults to the hosted bundler and probes the hosted paymaster base", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      urls.push(url);
      throw new Error("offline");
    });
    const r = await checkSponsorship({ env: {}, fetch: f });
    expect(r.available).toBe(false);
    expect(r.transport).toBe("direct");
    expect(r.bundler.configured).toBe(true);
    expect(r.paymaster.configured).toBe(true);
    expect(urls).toContain("https://bundler.pepeunchained.com");
    expect(urls).toContain("https://paymaster.pepeunchained.com/health");
    expect(urls).toContain("https://paymaster.pepeunchained.com/v2/free-tier");
  });
  it("is available when both probes pass and the deposit is funded", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://pm.example")) {
        if (url.endsWith("/health")) return json({ status: "ok" });
        if (url.endsWith("/v2/free-tier")) return json({});
        return json({ result: { paymaster: EP, paymasterData: "0x" } });
      }
      return bundlerFetch()(url, init);
    });
    const r = await checkSponsorship({
      bundlerUrl: "https://b.example",
      paymasterUrl: "https://pm.example/paymaster/tok",
      fetch: f,
      publicClient: { readContract: async () => 10n } as never,
    });
    expect(r.available).toBe(true);
    expect(r.paymaster.depositWei).toBe(10n);
  });
  it("is unavailable when the deposit is empty", async () => {
    const r = await checkSponsorship({
      bundlerUrl: "https://b.example",
      paymasterUrl: "https://pm.example/paymaster/tok",
      fetch: async (url: string, init?: RequestInit) =>
        url.startsWith("https://pm.example")
          ? json({ status: "ok", result: { paymaster: EP, paymasterData: "0x" } })
          : bundlerFetch()(url, init),
      publicClient: { readContract: async () => 0n } as never,
    });
    expect(r.available).toBe(false);
    expect(r.fixes.join(" ")).toMatch(/deposit/i);
  });
});
