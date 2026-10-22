// Run with: node --test deploy/hosting/scripts/healthcheck-alert.test.mjs
// Spins up throwaway local HTTP servers on ephemeral ports (never the real service ports).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildMessage, evaluateAlerts, loadConfig, main, redact, runChecks } from "./healthcheck-alert.mjs";

const EP = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const PAYMASTER = "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0";
const EXECUTOR = "0x1111111111111111111111111111111111111111";
const WEI = 10n ** 18n;

/** Mutable fake world. */
const world = {
  bundlerChainId: "0x17dcd",
  entryPoints: [EP],
  paymasterHealth: { status: "ok" },
  readyStatus: 200,
  readyBody: { status: "ready", checks: {}, warnings: [] },
  rpcChainId: "0x17dcd",
  depositWei: 200n * WEI,
  executorWei: 500n * WEI,
  requireKey: null,
  webhooks: [],
  heartbeats: 0,
  webhookStatus: 200,
};

let server;
let base;

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      if (url.pathname === "/webhook") {
        world.webhooks.push(JSON.parse(raw));
        return reply(res, world.webhookStatus, {});
      }
      if (url.pathname === "/heartbeat") {
        world.heartbeats++;
        return reply(res, 200, {});
      }
      if (url.pathname === "/health") return reply(res, 200, world.paymasterHealth);
      if (url.pathname === "/ready") return reply(res, world.readyStatus, world.readyBody);
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === "/bundler") {
        if (world.requireKey && req.headers["x-pepu-bundler-key"] !== world.requireKey) return reply(res, 401, {});
        if (body.method === "eth_chainId") return reply(res, 200, { jsonrpc: "2.0", id: 1, result: world.bundlerChainId });
        if (body.method === "eth_supportedEntryPoints") return reply(res, 200, { jsonrpc: "2.0", id: 1, result: world.entryPoints });
      }
      if (url.pathname === "/rpc") {
        if (body.method === "eth_chainId") return reply(res, 200, { jsonrpc: "2.0", id: 1, result: world.rpcChainId });
        if (body.method === "eth_call") {
          assert.equal(body.params[0].to, EP);
          assert.ok(body.params[0].data.startsWith("0x70a08231"));
          assert.ok(body.params[0].data.endsWith(PAYMASTER.slice(2).toLowerCase()));
          return reply(res, 200, { jsonrpc: "2.0", id: 1, result: `0x${world.depositWei.toString(16)}` });
        }
        if (body.method === "eth_getBalance") return reply(res, 200, { jsonrpc: "2.0", id: 1, result: `0x${world.executorWei.toString(16)}` });
      }
      reply(res, 404, {});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

function env(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pepu-monitor-"));
  return {
    PUBLIC_BUNDLER_URL: `${base}/bundler`,
    PUBLIC_PAYMASTER_URL: base,
    POLICY_READY_URL: `${base}/ready`,
    RPC_URL: `${base}/rpc`,
    PAYMASTER_ADDRESS: PAYMASTER,
    EXECUTOR_ADDRESSES: EXECUTOR,
    DEPOSIT_LOW_WEI: String(100n * WEI),
    DEPOSIT_HIGH_WEI: String(500n * WEI),
    EXECUTOR_MIN_WEI: String(100n * WEI),
    WEBHOOK_URL: `${base}/webhook`,
    HEARTBEAT_URL: `${base}/heartbeat`,
    STATE_FILE: join(dir, "state.json"),
    ...over,
  };
}

const byName = (results, name) => results.find((r) => r.name === name);

beforeEach(() => {
  Object.assign(world, {
    bundlerChainId: "0x17dcd",
    entryPoints: [EP],
    paymasterHealth: { status: "ok" },
    readyStatus: 200,
    readyBody: { status: "ready", checks: {}, warnings: [] },
    rpcChainId: "0x17dcd",
    depositWei: 200n * WEI,
    executorWei: 500n * WEI,
    requireKey: null,
    webhooks: [],
    heartbeats: 0,
    webhookStatus: 200,
  });
});

describe("runChecks", () => {
  it("passes everything on a healthy world", async () => {
    const results = await runChecks(loadConfig(env()));
    assert.deepEqual(results.filter((r) => !r.ok), []);
    assert.ok(byName(results, "paymaster_deposit").detail.includes("deposit"));
  });

  it("flags a deposit below the low mark and above the ceiling", async () => {
    world.depositWei = 50n * WEI;
    assert.equal(byName(await runChecks(loadConfig(env())), "paymaster_deposit").ok, false);
    world.depositWei = 900n * WEI;
    const r = byName(await runChecks(loadConfig(env())), "paymaster_deposit");
    assert.equal(r.ok, false);
    assert.match(r.detail, /ABOVE/);
  });

  it("flags a low executor float", async () => {
    world.executorWei = 1n * WEI;
    const results = await runChecks(loadConfig(env()));
    assert.equal(results.filter((r) => !r.ok).length, 1);
    assert.match(results.find((r) => !r.ok).detail, /fund it/);
  });

  it("flags a wrong chain id, a missing EntryPoint and an unhealthy paymaster", async () => {
    world.bundlerChainId = "0x1";
    world.entryPoints = ["0x0000000000000000000000000000000000000001"];
    world.paymasterHealth = { status: "degraded" };
    const results = await runChecks(loadConfig(env()));
    for (const name of ["bundler_chain_id", "bundler_entrypoints", "paymaster_health"]) {
      assert.equal(byName(results, name).ok, false, name);
    }
  });

  it("reports /ready failures with the failing sub-check", async () => {
    world.readyStatus = 503;
    world.readyBody = { status: "not_ready", checks: { deposit: { ok: false, detail: "below minimum" } } };
    const r = byName(await runChecks(loadConfig(env())), "policy_ready");
    assert.equal(r.ok, false);
    assert.match(r.detail, /deposit: below minimum/);
  });

  it("sends the bundler shared secret header when configured", async () => {
    world.requireKey = "k-123";
    assert.equal(byName(await runChecks(loadConfig(env())), "bundler_chain_id").ok, false);
    assert.equal(byName(await runChecks(loadConfig(env({ BUNDLER_SHARED_SECRET: "k-123" }))), "bundler_chain_id").ok, true);
  });

  it("an unreachable service is a failed check, not a crash, and never leaks the RPC URL", async () => {
    const results = await runChecks(
      loadConfig(env({ RPC_URL: "http://127.0.0.1:1/SECRET-PROVIDER-KEY", CHECK_TIMEOUT_MS: "1500" })),
    );
    const rpc = byName(results, "chain_rpc");
    assert.equal(rpc.ok, false);
    assert.ok(!JSON.stringify(results).includes("SECRET-PROVIDER-KEY"));
  });

  it("reads the RPC URL from RPC_URL_FILE", () => {
    const cfg = loadConfig({ RPC_URL_FILE: "/run/secrets/rpc_url" }, () => "http://rpc.example/key\n");
    assert.equal(cfg.rpcUrl, "http://rpc.example/key");
  });

  it("fails loudly when on-chain checks are configured but no RPC is available", async () => {
    const results = await runChecks(loadConfig(env({ RPC_URL: "" })));
    assert.equal(byName(results, "chain_rpc").ok, false);
  });

  it("checks certificate expiry through the injected inspector", async () => {
    const e = env({ PUBLIC_BUNDLER_URL: "https://bundler.example.com", PUBLIC_PAYMASTER_URL: "https://paymaster.example.com" });
    let days = 3;
    const results = await runChecks(loadConfig(e), {
      fetch: async () => {
        throw new Error("offline");
      },
      inspectCertificate: async () => ({ authorized: true, authError: null, daysLeft: days }),
    });
    assert.equal(byName(results, "cert_bundler").ok, false);
    days = 60;
    const ok = await runChecks(loadConfig(e), {
      fetch: async () => {
        throw new Error("offline");
      },
      inspectCertificate: async () => ({ authorized: true, authError: null, daysLeft: days }),
    });
    assert.equal(byName(ok, "cert_bundler").ok, true);
    const untrusted = await runChecks(loadConfig(e), {
      fetch: async () => {
        throw new Error("offline");
      },
      inspectCertificate: async () => ({ authorized: false, authError: "self signed", daysLeft: 80 }),
    });
    assert.equal(byName(untrusted, "cert_paymaster").ok, false);
  });
});

describe("evaluateAlerts", () => {
  const fail = (name) => ({ name, ok: false, detail: "x" });
  const pass = (name) => ({ name, ok: true, detail: "ok" });
  const MIN = 60_000;

  it("alerts on first failure, stays quiet inside the repeat window, repeats after it", () => {
    let d = evaluateAlerts([fail("a"), pass("b")], { key: "", lastSentMs: 0 }, 1_000_000, 60);
    assert.equal(d.send, "alert");
    d = evaluateAlerts([fail("a")], d.nextState, 1_000_000 + 10 * MIN, 60);
    assert.equal(d.send, null);
    d = evaluateAlerts([fail("a")], d.nextState, 1_000_000 + 61 * MIN, 60);
    assert.equal(d.send, "alert");
  });

  it("alerts immediately when the failing set changes", () => {
    const first = evaluateAlerts([fail("a")], { key: "", lastSentMs: 0 }, 5_000_000, 60);
    const second = evaluateAlerts([fail("a"), fail("b")], first.nextState, 5_000_000 + MIN, 60);
    assert.equal(second.send, "alert");
  });

  it("sends exactly one recovery message", () => {
    const down = evaluateAlerts([fail("a")], { key: "", lastSentMs: 0 }, 5_000_000, 60);
    const up = evaluateAlerts([pass("a")], down.nextState, 5_000_000 + MIN, 60);
    assert.equal(up.send, "recovered");
    const still = evaluateAlerts([pass("a")], up.nextState, 5_000_000 + 2 * MIN, 60);
    assert.equal(still.send, null);
  });

  it("messages list every failing check and nothing else", () => {
    const msg = buildMessage("alert", "L", [fail("a"), pass("b")]);
    assert.match(msg, /ALERT: 1 check/);
    assert.match(msg, /- a: x/);
    assert.ok(!msg.includes("- b"));
  });
});

describe("main", () => {
  it("green run: exit 0, pings the heartbeat, no webhook", async () => {
    const { exitCode } = await main(env(), { log: () => undefined });
    assert.equal(exitCode, 0);
    assert.equal(world.heartbeats, 1);
    assert.equal(world.webhooks.length, 0);
  });

  it("failing run: exit 1, one webhook, no heartbeat, deduped on the next run, recovery after the fix", async () => {
    const e = env();
    world.depositWei = 10n * WEI;
    let r = await main(e, { log: () => undefined });
    assert.equal(r.exitCode, 1);
    assert.equal(world.webhooks.length, 1);
    assert.match(world.webhooks[0].text, /paymaster_deposit/);
    assert.equal(world.heartbeats, 0);

    r = await main(e, { log: () => undefined });
    assert.equal(r.exitCode, 1);
    assert.equal(world.webhooks.length, 1, "deduplicated");

    world.depositWei = 200n * WEI;
    r = await main(e, { log: () => undefined });
    assert.equal(r.exitCode, 0);
    assert.equal(world.webhooks.length, 2);
    assert.match(world.webhooks[1].text, /RECOVERED/);
    assert.equal(world.heartbeats, 1);
  });

  it("a failed webhook delivery is retried on the next run", async () => {
    const e = env();
    world.depositWei = 10n * WEI;
    world.webhookStatus = 500;
    await main(e, { log: () => undefined });
    assert.equal(JSON.parse(readFileSync(e.STATE_FILE, "utf8")).key, "");
    world.webhookStatus = 200;
    await main(e, { log: () => undefined });
    assert.equal(JSON.parse(readFileSync(e.STATE_FILE, "utf8")).key, "paymaster_deposit");
    assert.equal(world.webhooks.length, 2);
  });

  it("discord format uses the content field", async () => {
    world.depositWei = 10n * WEI;
    await main(env({ WEBHOOK_FORMAT: "discord" }), { log: () => undefined });
    assert.ok(typeof world.webhooks[0].content === "string");
    assert.equal(world.webhooks[0].text, undefined);
  });
});

describe("redact", () => {
  it("masks URLs", () => {
    assert.equal(redact("failed https://rpc.example/KEY123 now"), "failed <url> now");
  });
});
