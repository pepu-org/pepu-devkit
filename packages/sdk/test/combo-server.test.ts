import type { Address, Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionRecord, SessionStore } from "../src/session/store.js";

/**
 * Route-level tests with the chain and the bundler mocked out. They cover the
 * session state machine and the guards, not the on-chain scope (that is what
 * scripts/prove-session.ts exercises live). Ported from
 * templates/sponsored-session-app/app/api/session/routes.test.ts.
 */

const KERNEL = "0x1d9a59701E5bd3A10244D94ec398eed997Ba4264" as Address;
const OWNER = "0x0000000000000000000000000000000000000001" as Address;
const TAPSCORE = "0x261eA5971B93237a56990206A46Bc80318e4d078" as Address;
const PAYMASTER = "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0";
const SECRET_KEY = `0x${"22".repeat(32)}` as Hex;
const userId = "did:privy:test";

const getKernelAddress = vi.fn(async () => KERNEL);
const expectedPermissionId = vi.fn(async () => "0xb5018da6");
const loadKernelSessionAccount = vi.fn(async () => ({ address: KERNEL }));
vi.mock("../src/session/kernel.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/session/kernel.js")>()),
  getKernelAddress: (...a: unknown[]) => (getKernelAddress as (...x: unknown[]) => unknown)(...a),
  expectedPermissionId: (...a: unknown[]) => (expectedPermissionId as (...x: unknown[]) => unknown)(...a),
  loadKernelSessionAccount: (...a: unknown[]) => (loadKernelSessionAccount as (...x: unknown[]) => unknown)(...a),
}));

const createPepuSponsoredClient = vi.fn((_p: unknown) => ({ tag: "client" }));
const sendSponsored = vi.fn();
vi.mock("../src/aa/kernel.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/aa/kernel.js")>()),
  createPepuSponsoredClient: (p: unknown) => createPepuSponsoredClient(p),
  sendSponsored: (p: unknown) => sendSponsored(p),
}));

const { createSponsoredSessionRoutes, assertCallsInScope, createMemoryStore } = await import("../src/combo/server.js");
const { describeKernelSessionScope } = await import("../src/session/kernel.js");

const tapAbi = [{ type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;
const scoresAbi = [
  { type: "function", name: "scores", stateMutability: "view", inputs: [{ name: "p", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

let store: SessionStore;
let routes: ReturnType<typeof createSponsoredSessionRoutes<{ n?: number }>>;
const buildCalls = vi.fn((): { to: Address; abi: typeof tapAbi; functionName: "tap" }[] => [
  { to: TAPSCORE, abi: tapAbi, functionName: "tap" },
]);

const authed = { headers: { authorization: "Bearer t" } };
const post = (body?: unknown) =>
  new Request("http://x", {
    method: "POST",
    ...authed,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const future = () => Math.floor(Date.now() / 1000) + 600;

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    userId,
    ownerAddress: OWNER,
    kernelAddress: KERNEL,
    sessionPrivateKey: SECRET_KEY,
    sessionKeyAddress: "0x0000000000000000000000000000000000000003",
    permissionId: "0xb5018da6",
    validUntil: future(),
    approval: "approval",
    actions: 0,
    ...over,
  };
}

const goodApproval = (over: Record<string, unknown> = {}): string =>
  Buffer.from(
    JSON.stringify({
      permissionParams: { permissionId: "0xb5018da6" },
      accountParams: { accountAddress: KERNEL },
      isPreInstalled: false,
      ...over,
    }),
  ).toString("base64");

beforeEach(() => {
  store = createMemoryStore();
  getKernelAddress.mockClear();
  expectedPermissionId.mockClear();
  loadKernelSessionAccount.mockClear();
  createPepuSponsoredClient.mockClear();
  sendSponsored.mockReset();
  buildCalls.mockClear();
  routes = createSponsoredSessionRoutes<{ n?: number }>({
    scope: { calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }] },
    store,
    minutes: 15,
    endpoints: { bundlerUrl: "http://bundler.test", paymasterUrl: "http://paymaster.test/paymaster/key" },
    publicClient: {} as never,
    act: { parse: (b) => b as { n?: number }, buildCalls },
    authenticate: async (req) =>
      req.headers.get("authorization") ? { userId, ownerAddress: OWNER } : null,
  });
});

describe("unset scope target", () => {
  it("does not throw at creation; every route answers CONFIG_MISSING_ENV at request time", async () => {
    const lazy = createSponsoredSessionRoutes({
      scope: { calls: [{ target: "" as Address, abi: tapAbi, functionName: "tap" }], targetEnv: "TAPSCORE_ADDRESS" },
      store,
      act: { parse: () => ({}), buildCalls },
      authenticate: async () => ({ userId, ownerAddress: OWNER }),
    });
    for (const res of [
      await lazy.prepare.POST(post()),
      await lazy.activate.POST(post({})),
      await lazy.status.GET(new Request("http://x", authed)),
      await lazy.act.POST(post()),
      await lazy.revoke.POST(post()),
    ]) {
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("CONFIG_MISSING_ENV");
      expect(body.error.message).toContain("TAPSCORE_ADDRESS");
    }
  });

  it("a malformed non-empty target still throws at creation", () => {
    expect(() =>
      createSponsoredSessionRoutes({
        scope: { calls: [{ target: "0x12" as Address, abi: tapAbi, functionName: "tap" }] },
        store,
        act: { parse: () => ({}), buildCalls },
      }),
    ).toThrow();
  });
});

describe("combo exports", () => {
  it("re-exports resolveSessionMinutes", async () => {
    const { resolveSessionMinutes } = await import("../src/combo/server.js");
    expect(resolveSessionMinutes(undefined)).toBe(15);
    expect(resolveSessionMinutes("99999")).toBe(1440);
  });

  it("act response matches the SponsoredActResult type", async () => {
    await store.set(record());
    sendSponsored.mockResolvedValue({
      userOpHash: "0xaa",
      transactionHash: "0xbb",
      success: true,
      paymaster: PAYMASTER,
      actualGasCostWei: 5n,
      explorerUrl: "https://x/tx/0xbb",
    });
    const res = await routes.act.POST(post({}));
    const body = (await res.json()) as import("../src/combo/server.js").SponsoredActResult;
    expect(body.actualGasCostWei).toBe("5");
    expect(body.actions).toBe(1);
    expect(body.paymaster).toBe(PAYMASTER);
  });
});

describe("auth", () => {
  it("every route refuses a request without a token (401)", async () => {
    const bare = new Request("http://x", { method: "POST" });
    for (const res of [
      await routes.prepare.POST(bare),
      await routes.activate.POST(bare),
      await routes.act.POST(bare),
      await routes.revoke.POST(bare),
      await routes.status.GET(new Request("http://x")),
    ]) {
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH_INVALID_TOKEN");
    }
  });

  it("default auth uses Privy: bad token 401, no wallet 409, good token works", async () => {
    const wallet = (address: string | null) => ({
      linked_accounts: address
        ? [{ type: "wallet", wallet_client_type: "privy", chain_type: "ethereum", address, id: "w1", connector_type: "embedded" }]
        : [],
    });
    const mk = (user: unknown) =>
      createSponsoredSessionRoutes({
        scope: { calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }] },
        store,
        publicClient: {} as never,
        act: { parse: () => ({}), buildCalls },
        provisioningWait: { attempts: 1, delayMs: 1 },
        privy: {
          utils: () => ({
            auth: () => ({
              verifyAccessToken: async (t: string) => {
                if (t !== "good") throw new Error("bad");
                return { user_id: userId };
              },
            }),
          }),
          users: () => ({ _get: async () => user }),
        } as never,
      });
    const bad = await mk(wallet(OWNER)).status.GET(new Request("http://x", { headers: { authorization: "Bearer nope" } }));
    expect(bad.status).toBe(401);
    const none = await mk(wallet(null)).prepare.POST(
      new Request("http://x", { method: "POST", headers: { authorization: "Bearer good" } }),
    );
    expect(none.status).toBe(409);
    const ok = await mk(wallet(OWNER)).status.GET(new Request("http://x", { headers: { authorization: "Bearer good" } }));
    expect(ok.status).toBe(200);
  });
});

describe("prepare", () => {
  it("creates a pending record and returns only public data", async () => {
    const res = await routes.prepare.POST(post());
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { kernelAddress: string; sessionKeyAddress: string; validUntil: number; minutes: number; scope: { calls: unknown[] } };
    expect(body.kernelAddress).toBe(KERNEL);
    expect(body.minutes).toBe(15);
    expect(body.scope.calls).toHaveLength(1);
    const stored = await store.get(userId);
    expect(stored?.approval).toBeNull();
    expect(stored?.permissionId).toBe("0xb5018da6");
    expect(stored?.validUntil).toBe(body.validUntil);
    expect(stored?.sessionKeyAddress).toBe(body.sessionKeyAddress);
    expect(text).not.toContain(stored?.sessionPrivateKey.slice(2) ?? "x");
    expect(text).not.toContain("sessionPrivateKey");
  });

  it("replaces an existing session (the old key is dropped)", async () => {
    await store.set(record());
    await routes.prepare.POST(post());
    const stored = await store.get(userId);
    expect(stored?.approval).toBeNull();
    expect(stored?.sessionPrivateKey).not.toBe(SECRET_KEY);
  });

  it("an upstream failure is a 502, not a 500", async () => {
    getKernelAddress.mockRejectedValueOnce(new Error("rpc down"));
    expect((await routes.prepare.POST(post())).status).toBe(502);
  });
});

describe("activate", () => {
  it("rejects when nothing is pending (409 SESSION_NONE)", async () => {
    const res = await routes.activate.POST(post({ approval: "a" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SESSION_NONE");
  });

  it("requires an approval string (400)", async () => {
    expect((await routes.activate.POST(post({}))).status).toBe(400);
  });

  it("rejects an approval that does not match what the server issued (400 SESSION_APPROVAL_MISMATCH)", async () => {
    await store.set(record({ approval: null }));
    const res = await routes.activate.POST(post({ approval: goodApproval({ permissionParams: { permissionId: "0xdead" } }) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SESSION_APPROVAL_MISMATCH");
    expect((await store.get(userId))?.approval).toBeNull();
  });

  it("rejects an approval carrying a private key", async () => {
    await store.set(record({ approval: null }));
    const res = await routes.activate.POST(post({ approval: goodApproval({ privateKey: SECRET_KEY }) }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(SECRET_KEY);
  });

  it("rejects an expired offer and drops it (410 SESSION_EXPIRED)", async () => {
    await store.set(record({ approval: null, validUntil: 1 }));
    const res = await routes.activate.POST(post({ approval: "a" }));
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SESSION_EXPIRED");
    expect(await store.get(userId)).toBeUndefined();
  });

  it("stores a matching approval", async () => {
    await store.set(record({ approval: null }));
    const approval = goodApproval();
    const res = await routes.activate.POST(post({ approval }));
    expect(res.status).toBe(200);
    expect((await store.get(userId))?.approval).toBe(approval);
  });

  it("refuses a second activation of the same offer", async () => {
    await store.set(record({ approval: "already" }));
    expect((await routes.activate.POST(post({ approval: goodApproval() }))).status).toBe(409);
  });
});

describe("act", () => {
  const ok = {
    userOpHash: "0xaa",
    transactionHash: "0xbb",
    success: true,
    paymaster: PAYMASTER,
    actualGasCostWei: 5n,
    explorerUrl: "https://pepuscan.com/tx/0xbb",
  };

  it("needs an active session (409 SESSION_NONE)", async () => {
    expect((await routes.act.POST(post({}))).status).toBe(409);
    await store.set(record({ validUntil: 1 }));
    const res = await routes.act.POST(post({}));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SESSION_NONE");
    await store.set(record({ approval: null }));
    expect((await routes.act.POST(post({}))).status).toBe(409);
    expect(sendSponsored).not.toHaveBeenCalled();
  });

  it("sends one sponsored operation through the configured endpoints and counts it", async () => {
    await store.set(record());
    sendSponsored.mockResolvedValue(ok);
    const res = await routes.act.POST(post({ n: 1 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: number; paymaster: string; actualGasCostWei: string; kernelAddress: string };
    expect(body).toMatchObject({ actions: 1, paymaster: PAYMASTER, actualGasCostWei: "5", kernelAddress: KERNEL });
    expect(buildCalls).toHaveBeenCalledWith({ n: 1 }, { kernelAddress: KERNEL, ownerAddress: OWNER });
    expect(loadKernelSessionAccount).toHaveBeenCalledWith(
      expect.objectContaining({ approval: "approval", sessionPrivateKey: SECRET_KEY }),
    );
    expect(createPepuSponsoredClient).toHaveBeenCalledWith(
      expect.objectContaining({ bundlerUrl: "http://bundler.test", paymasterUrl: "http://paymaster.test/paymaster/key" }),
    );
    expect(sendSponsored).toHaveBeenCalledOnce();
    expect((await store.get(userId))?.actions).toBe(1);
    expect(await store.tryLock(userId)).toBe(true); // the lock was released
  });

  it("forwards the caller's Privy token as ERC-7677 context (free tier) unless disabled", async () => {
    await store.set(record());
    sendSponsored.mockResolvedValue(ok);
    await routes.act.POST(post({}));
    expect(createPepuSponsoredClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymasterContext: { privyAccessToken: "t" } }),
    );
    const off = createSponsoredSessionRoutes<{ n?: number }>({
      scope: { calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }] },
      store,
      endpoints: { paymasterToken: "ppt_abc" },
      forwardPrivyToken: false,
      publicClient: {} as never,
      authenticate: async () => ({ userId, ownerAddress: OWNER }),
      act: { parse: () => ({}), buildCalls },
    });
    await off.act.POST(post({}));
    const last = createPepuSponsoredClient.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last["paymasterContext"]).toBeUndefined();
    expect(last["paymasterToken"]).toBe("ppt_abc");
  });

  it("does not count a reverted operation", async () => {
    await store.set(record());
    sendSponsored.mockResolvedValue({ ...ok, success: false });
    const body = (await (await routes.act.POST(post({}))).json()) as { actions: number; success: boolean };
    expect(body).toMatchObject({ success: false, actions: 0 });
  });

  it("allows one in-flight action (429) and releases the lock on failure", async () => {
    await store.set(record());
    expect(await store.tryLock(userId)).toBe(true);
    const res = await routes.act.POST(post({}));
    expect(res.status).toBe(429);
    await store.unlock(userId);

    sendSponsored.mockRejectedValue(new Error("validateUserOp reverted"));
    const failed = await routes.act.POST(post({}));
    expect(failed.status).toBe(502);
    expect(await store.tryLock(userId)).toBe(true);
  });

  it("a bad body is a 400 and never reaches the bundler", async () => {
    const strict = createSponsoredSessionRoutes({
      scope: { calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }] },
      store,
      publicClient: {} as never,
      act: {
        parse: () => {
          throw new Error("n must be a number");
        },
        buildCalls,
      },
      authenticate: async () => ({ userId, ownerAddress: OWNER }),
    });
    await store.set(record());
    const res = await strict.act.POST(post({}));
    expect(res.status).toBe(400);
    expect(sendSponsored).not.toHaveBeenCalled();
  });

  it("refuses a call outside the scope before signing (403 POLICY_UNSCOPED)", async () => {
    await store.set(record());
    buildCalls.mockReturnValueOnce([{ to: TAPSCORE, abi: scoresAbi as never, functionName: "scores", args: [OWNER] } as never]);
    const res = await routes.act.POST(post({}));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("POLICY_UNSCOPED");
    expect(loadKernelSessionAccount).not.toHaveBeenCalled();
  });

  it("surfaces a typed paymaster denial from the bundler flow", async () => {
    await store.set(record());
    const { PepuPaymasterError } = await import("../src/errors.js");
    sendSponsored.mockRejectedValue(new PepuPaymasterError("PAYMASTER_CAP", "cap hit"));
    const res = await routes.act.POST(post({}));
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PAYMASTER_CAP");
  });
});

describe("revoke and status", () => {
  it("revoke deletes the key and approval immediately", async () => {
    await store.set(record());
    expect(((await (await routes.status.GET(new Request("http://x", authed))).json()) as { active: boolean }).active).toBe(true);
    expect((await routes.revoke.POST(post())).status).toBe(200);
    expect(await store.get(userId)).toBeUndefined();
    expect(((await (await routes.status.GET(new Request("http://x", authed))).json()) as { active: boolean }).active).toBe(false);
  });

  it("status is inactive for a pending or expired session", async () => {
    await store.set(record({ approval: null }));
    expect(((await (await routes.status.GET(new Request("http://x", authed))).json()) as { active: boolean }).active).toBe(false);
    await store.set(record({ validUntil: 1 }));
    expect(((await (await routes.status.GET(new Request("http://x", authed))).json()) as { active: boolean }).active).toBe(false);
  });

  it("status never leaks the session key or approval", async () => {
    await store.set(record({ approval: "APPROVAL-BLOB" }));
    const text = await (await routes.status.GET(new Request("http://x", authed))).text();
    expect(text).not.toContain("22222222");
    expect(text).not.toContain("APPROVAL-BLOB");
    expect(text).not.toContain("sessionPrivateKey");
  });
});

describe("factory validation and assertCallsInScope", () => {
  it("fails at construction for a malformed scope", () => {
    expect(() =>
      createSponsoredSessionRoutes({
        scope: { calls: [] },
        store,
        act: { parse: () => ({}), buildCalls },
      }),
    ).toThrow(/at least one/);
  });

  it("assertCallsInScope accepts in-scope calls and rejects others", () => {
    const scope = describeKernelSessionScope({
      calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }],
      validUntil: 1,
    });
    expect(() => assertCallsInScope(scope, [{ to: TAPSCORE, abi: tapAbi, functionName: "tap" }])).not.toThrow();
    expect(() => assertCallsInScope(scope, [{ to: TAPSCORE, abi: tapAbi, functionName: "tap", value: 1n }])).toThrow(/outside/);
    expect(() => assertCallsInScope(scope, [{ to: OWNER, abi: tapAbi, functionName: "tap" }])).toThrow(/outside/);
  });
});

describe("a brand-new user whose embedded wallet Privy's server does not report yet", () => {
  const walletUser = { linked_accounts: [{ type: "wallet", wallet_client_type: "privy", chain_type: "ethereum", address: OWNER, id: "w1", connector_type: "embedded" }] };
  const noWallet = { linked_accounts: [] };
  const mk = (lookups: unknown[], provisioningWait = { attempts: 3, delayMs: 1 }) => {
    const calls = { n: 0 };
    const r = createSponsoredSessionRoutes({
      scope: { calls: [{ target: TAPSCORE, abi: tapAbi, functionName: "tap" }] },
      store,
      minutes: 15,
      publicClient: {} as never,
      act: { parse: () => ({}), buildCalls },
      provisioningWait,
      privy: {
        utils: () => ({ auth: () => ({ verifyAccessToken: async () => ({ user_id: userId }) }) }),
        users: () => ({ _get: async () => lookups[Math.min(calls.n++, lookups.length - 1)] }),
      } as never,
    });
    return { r, calls };
  };
  const good = { headers: { authorization: "Bearer good" } };

  it("status is a normal 200 provisioning state, never an error", async () => {
    const { r } = mk([noWallet]);
    const res = await r.status.GET(new Request("http://x", good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false, provisioning: true });
  });

  it("status resolves normally once the wallet shows up within the wait", async () => {
    const { r, calls } = mk([noWallet, noWallet, walletUser]);
    const res = await r.status.GET(new Request("http://x", good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false });
    expect(calls.n).toBe(3);
  });

  it("prepare waits for the wallet instead of failing", async () => {
    const { r } = mk([noWallet, walletUser]);
    const res = await r.prepare.POST(new Request("http://x", { method: "POST", ...good }));
    expect(res.status).toBe(200);
  });

  it("prepare that never sees the wallet is a retryable 409, after bounded lookups", async () => {
    const { r, calls } = mk([noWallet]);
    const res = await r.prepare.POST(new Request("http://x", { method: "POST", ...good }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; retryable?: boolean } };
    expect(body.error.code).toBe("WALLET_NOT_PROVISIONED");
    expect(calls.n).toBe(4); // first lookup + 3 retries
  });
});
