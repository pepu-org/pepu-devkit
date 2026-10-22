/**
 * HTTP-layer behaviour added for hosting: /ready, constant-time admin token check, and the missing-Origin policy
 * for the paymaster JSON-RPC route. Real node:http server on an ephemeral port; policy engine is stubbed because
 * none of these paths reach it.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { PolicyDb } from "../src/db.js";
import type { PolicyEngine } from "../src/policy.js";
import type { PaymasterRpcConfig } from "../src/paymasterRpc.js";
import { createReadinessChecker, type ReadyChain } from "../src/ready.js";
import { createPolicyHttpServer } from "../src/server.js";

const PAYMASTER = "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0" as Address;
const ADMIN = "admin-token-0123456789abcdef0123456789abcdef";

const rpcConfig = {
  policy: {} as unknown as PolicyEngine,
  entryPointAddress: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address,
  chainId: 97741,
  paymasterAddress: PAYMASTER,
  paymasterVerificationGasLimit: 100_000n,
  paymasterPostOpGasLimit: 50_000n,
  validityWindowSeconds: 90,
  allowAccountDeployment: true,
} satisfies PaymasterRpcConfig;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("GET /ready", () => {
  let db: PolicyDb;
  let server: Server;
  let base: string;
  const chain: ReadyChain & { depositWei: bigint; rpcDown: boolean } = {
    depositWei: 500n,
    rpcDown: false,
    async getBlockNumber() {
      if (this.rpcDown) throw new Error("connect ECONNREFUSED");
      return 1234n;
    },
    async getDeposit() {
      return this.depositWei;
    },
  };

  beforeEach(async () => {
    db = new PolicyDb(":memory:");
    chain.depositWei = 500n;
    chain.rpcDown = false;
    server = createPolicyHttpServer({
      policy: {} as unknown as PolicyEngine,
      db,
      adminToken: ADMIN,
      paymasterRpc: null,
      ready: createReadinessChecker({
        db,
        chain,
        paymaster: PAYMASTER,
        minDepositWei: 100n,
        maxDepositWei: 1_000n,
        cacheMs: 0,
      }),
    });
    base = await listen(server);
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  });

  it("is 200 with ok checks when DB, RPC and deposit are fine, and /health stays a bare liveness probe", async () => {
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: Record<string, { ok: boolean; wei?: string }> };
    expect(body.status).toBe("ready");
    expect(body.checks.db?.ok).toBe(true);
    expect(body.checks.rpc?.ok).toBe(true);
    expect(body.checks.deposit).toMatchObject({ ok: true, wei: "500" });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: "ok" });
  });

  it("is 503 when the deposit is below the minimum", async () => {
    chain.depositWei = 99n;
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { deposit: { ok: boolean; belowMinimum: boolean } } };
    expect(body.status).toBe("not_ready");
    expect(body.checks.deposit).toMatchObject({ ok: false, belowMinimum: true });
  });

  it("stays 200 but warns when the deposit is above the ceiling", async () => {
    chain.depositWei = 5_000n;
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warnings: string[] };
    expect(body.warnings.join(" ")).toMatch(/above READY_MAX_DEPOSIT_WEI/);
  });

  it("is 503 when the RPC is unreachable, and does not check the deposit", async () => {
    chain.rpcDown = true;
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { checks: { rpc: { ok: boolean }; deposit: { ok: boolean; detail: string } } };
    expect(body.checks.rpc.ok).toBe(false);
    expect(body.checks.deposit.ok).toBe(false);
    expect(body.checks.deposit.detail).toMatch(/RPC unreachable/);
  });

  it("is 503 when the database is closed", async () => {
    db.close();
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { checks: { db: { ok: boolean } } };
    expect(body.checks.db.ok).toBe(false);
    // reopen so afterEach close() has something valid to close
    db = new PolicyDb(":memory:");
  });
});

describe("readiness caching", () => {
  it("serves a cached report inside the TTL so /ready cannot amplify RPC calls", async () => {
    let calls = 0;
    let t = 0;
    const check = createReadinessChecker({
      db: { ping: () => undefined },
      chain: {
        async getBlockNumber() {
          calls++;
          return 1n;
        },
        async getDeposit() {
          return 1n;
        },
      },
      paymaster: PAYMASTER,
      minDepositWei: 0n,
      maxDepositWei: 0n,
      cacheMs: 5_000,
      now: () => t,
    });
    await check();
    await check();
    expect(calls).toBe(1);
    t = 6_000;
    await check();
    expect(calls).toBe(2);
  });

  it("times out a hung RPC instead of hanging the probe", async () => {
    const check = createReadinessChecker({
      db: { ping: () => undefined },
      chain: {
        getBlockNumber: () => new Promise<bigint>(() => undefined),
        getDeposit: async () => 1n,
      },
      paymaster: PAYMASTER,
      minDepositWei: 0n,
      maxDepositWei: 0n,
      cacheMs: 0,
      rpcTimeoutMs: 20,
    });
    const report = await check();
    expect(report.status).toBe("not_ready");
    expect(report.checks.rpc.detail).toMatch(/timed out/);
  });

  it("without an RPC configured, rpc/deposit are skipped and readiness depends on the DB only", async () => {
    const check = createReadinessChecker({
      db: { ping: () => undefined },
      chain: null,
      paymaster: PAYMASTER,
      minDepositWei: 1n,
      maxDepositWei: 0n,
      cacheMs: 0,
    });
    const report = await check();
    expect(report.status).toBe("ready");
    expect(report.warnings.length).toBe(1);
  });
});

describe("POST /admin/circuit-breaker/reset", () => {
  let db: PolicyDb;
  let server: Server;
  let base: string;
  beforeEach(async () => {
    db = new PolicyDb(":memory:");
    server = createPolicyHttpServer({ policy: {} as unknown as PolicyEngine, db, adminToken: ADMIN, paymasterRpc: null });
    base = await listen(server);
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  });

  const call = (token?: string) =>
    fetch(`${base}/admin/circuit-breaker/reset`, { method: "POST", headers: token ? { "x-admin-token": token } : {} });

  it("accepts the right token", async () => {
    expect((await call(ADMIN)).status).toBe(200);
  });

  it("rejects missing, wrong, prefix, longer and empty tokens without throwing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect((await call(ADMIN.slice(0, -1))).status).toBe(401);
    expect((await call(`${ADMIN}x`)).status).toBe(401);
    expect((await call("")).status).toBe(401);
  });

  it("does not route protocol-relative targets like //localhost/admin/... to the admin handler", async () => {
    const { request } = await import("node:http");
    const port = new URL(base).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, method: "POST", path: "//localhost/admin/circuit-breaker/reset", headers: { "x-admin-token": ADMIN } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(404);
  });

  it("is disabled (401) when no ADMIN_TOKEN is configured", async () => {
    await new Promise<void>((r) => server.close(() => r()));
    server = createPolicyHttpServer({ policy: {} as unknown as PolicyEngine, db, adminToken: null, paymasterRpc: null });
    base = await listen(server);
    expect((await call(ADMIN)).status).toBe(401);
  });
});

describe("paymaster JSON-RPC Origin policy", () => {
  let db: PolicyDb;
  let server: Server;
  let base: string;

  async function start(allowMissingOrigin: boolean | undefined): Promise<void> {
    db = new PolicyDb(":memory:");
    server = createPolicyHttpServer({
      policy: {} as unknown as PolicyEngine,
      db,
      adminToken: null,
      paymasterRpc: {
        ...rpcConfig,
        allowedOrigins: ["https://app.example.com"],
        ...(allowMissingOrigin === undefined ? {} : { allowMissingOrigin }),
      },
    });
    base = await listen(server);
  }
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  });

  const rpc = (headers: Record<string, string>) =>
    fetch(`${base}/paymaster/some-token`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "not_a_method", params: [] }),
    });

  it("default: a request with no Origin is refused once an allowlist is configured", async () => {
    await start(undefined);
    expect((await rpc({})).status).toBe(403);
  });

  it("allowMissingOrigin=true: server-side callers with no Origin reach the handler", async () => {
    await start(true);
    const res = await rpc({});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("allowMissingOrigin=true still refuses a PRESENT but unlisted Origin", async () => {
    await start(true);
    expect((await rpc({ origin: "https://evil.example" })).status).toBe(403);
  });

  it("an allowlisted Origin passes and is echoed back for CORS", async () => {
    await start(false);
    const res = await rpc({ origin: "https://app.example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
  });
});
