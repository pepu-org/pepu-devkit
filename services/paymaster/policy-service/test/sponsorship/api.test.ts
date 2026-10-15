/**
 * End-to-end tests of the gated /v2 HTTP API over a real `node:http` server on an ephemeral port: SIWE login
 * (real EOA signatures), session + on-chain-owner gating, no unauthenticated writes, admin credential, prepare
 * (calldata decodes back to the intended call), token mint/rotate, ERC-7677 route, rate limiting, CORS, and that
 * the feature is invisible (404 passthrough) to non-/v2 paths.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeFunctionData, verifyMessage, verifyTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PEPU_SPONSORED_PAYMASTER_ABI } from "../../src/sponsorship/abi.js";
import { createSponsorshipV2 } from "../../src/sponsorship/api.js";
import type { SponsorshipConfig } from "../../src/sponsorship/config.js";
import { Reconciler } from "../../src/sponsorship/reconciler.js";
import { SiweAuth, buildLoginMessage } from "../../src/sponsorship/siwe.js";
import { projectIdOf } from "../../src/sponsorship/paymasterData.js";
import type { PrivySecretVerifier } from "../../src/sponsorship/projectVerify.js";
import { PEPU } from "./helpers/fakeChain.js";
import { CHAIN_ID, ENTRY_POINT, ORIGIN, PAYMASTER, TARGET, defaultFreeTier, defaultGasBounds, defaultReservations, freshOp, hex, makeHarness, type Harness } from "./helpers/harness.js";

const ADMIN_TOKEN = "a".repeat(40);
const DOMAIN = "dashboard.example.com";
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
export const signer = privateKeyToAccount(generatePrivateKey());

/** Scriptable Privy secret check: `valid` maps appId -> the only secret that is accepted. */
export class FakeSecretVerifier implements PrivySecretVerifier {
  valid = new Map<string, string>();
  calls: { appId: string; appSecret: string }[] = [];
  down = false;
  async verify(appId: string, appSecret: string) {
    this.calls.push({ appId, appSecret });
    if (this.down) throw new Error(`privy exploded while handling ${appSecret}`); // would leak if ever echoed
    return this.valid.get(appId) === appSecret ? ("valid" as const) : ("invalid" as const);
  }
}

function testConfig(over: Partial<SponsorshipConfig> = {}): SponsorshipConfig {
  return {
    paymasterAddress: PAYMASTER,
    entryPointAddress: ENTRY_POINT,
    chainId: CHAIN_ID,
    rpcUrl: "http://unused.invalid/SECRET-KEY",
    deployBlock: 0n,
    logChunkBlocks: 1000n,
    dbPath: ":memory:",
    paymasterVerificationGasLimit: 150_000n,
    paymasterPostOpGasLimit: 60_000n,
    validityWindowSeconds: 90,
    allowAccountDeployment: true,
    requireSenderOwnership: false,
    kernel: { factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419", ecdsaValidator: "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57", index: 0n },
    freeTier: defaultFreeTier(),
    gasBounds: defaultGasBounds(),
    reservations: defaultReservations(),
    project: { defaultPerUserDailyWei: 200n * PEPU, maxPerUserDailyWei: 5_000n * PEPU },
    siwe: { domains: [DOMAIN], nonceTtlSeconds: 300, sessionTtlSeconds: 3600, maxMessageLifetimeSeconds: 600, clockSkewSeconds: 60 },
    adminToken: ADMIN_TOKEN,
    publicBaseUrl: "https://pm.example.com",
    apiAllowedOrigins: ["https://dashboard.example.com"],
    paymasterRpcAllowedOrigins: null,
    trustProxy: false,
    trustedProxyHops: 1,
    rateLimits: { authPerIpPerMinute: 1000, ownerPerAddressPerMinute: 1000, adminPerIpPerMinute: 1000, rpcPerKeyPerMinute: 1000, publicPerIpPerMinute: 1000, verifyPerIpPerMinute: 1000, verifyPerAppPerMinute: 1000, clientTokenPerIpPerMinute: 1000, sponsorPerIpPerMinute: 1000, rpcUnknownTokenPerIpPerMinute: 1000 },
    auditRetentionDays: 30,
    claimAttestationTtlSeconds: 600,
    reconcileIntervalSeconds: 30,
    voidSafetyMarginSeconds: 0,
    chainCacheTtlMs: 0,
    identityCacheTtlMs: 1000,
    identityNegativeCacheTtlMs: 1000,
    ...over,
  };
}

interface Ctx {
  verifier: FakeSecretVerifier;
  h: Harness;
  server: Server;
  base: string;
}
let c: Ctx;

async function start(over: Partial<SponsorshipConfig> = {}, harnessOpts: Parameters<typeof makeHarness>[0] = {}): Promise<Ctx> {
  const h = makeHarness(harnessOpts);
  h.chain.verifySignature = async (address: Address, message: string, signature: Hex) => verifyMessage({ address, message, signature });
  const config = testConfig(over);
  const siwe = new SiweAuth({ db: h.db, chain: h.chain, chainId: CHAIN_ID, config: config.siwe, now: () => h.clock.now });
  const reconciler = new Reconciler({ db: h.db, chain: h.chain, deployBlock: 0n, chunkBlocks: 1000n, voidSafetyMarginSeconds: 0 });
  const verifier = new FakeSecretVerifier();
  const api = createSponsorshipV2({ config, db: h.db, chain: h.chain, engine: h.engine, siwe, identity: h.identity, reconciler, now: () => h.clock.now, signerAccount: signer, privySecretVerifier: verifier });
  const server = createServer(async (req, res) => {
    if (!(await api.handle(req, res))) {
      res.writeHead(418);
      res.end("not-v2");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { verifier, h, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function call(method: string, path: string, opts: { body?: unknown; bearer?: string; admin?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(c.base + path, {
    method,
    headers: { "content-type": "application/json", ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}), ...(opts.admin ? { "x-admin-token": opts.admin } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, headers: res.headers };
}

async function login(account = owner): Promise<string> {
  const { json } = await call("GET", "/v2/auth/nonce");
  const now = c.h.clock.now;
  const message = buildLoginMessage({ address: account.address, domain: DOMAIN, uri: `https://${DOMAIN}`, chainId: CHAIN_ID, nonce: json.nonce, issuedAt: new Date(now), expirationTime: new Date(now + 5 * 60_000) });
  const signature = await account.signMessage({ message });
  const r = await call("POST", "/v2/auth/login", { body: { message, signature } });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

const APP = "my-privy-app";
const PROJECT_ID = projectIdOf(APP);

function registerOnChain(ownerAddr: Address = owner.address) {
  c.h.chain.setProject(PROJECT_ID, { owner: ownerAddr, balance: 500n * PEPU, dailyLimit: 1_000n * PEPU });
  c.h.chain.setTargets(PROJECT_ID, [TARGET]);
  c.h.chain.appIds.set(PROJECT_ID.toLowerCase(), APP);
}

beforeEach(async () => {
  c = await start();
});
afterEach(async () => {
  await new Promise((r) => c.server.close(r));
});

describe("routing", () => {
  it("does not handle non-/v2 paths (v1 routes are untouched)", async () => {
    expect((await call("GET", "/health")).status).toBe(418);
    expect((await call("GET", "/sponsor")).status).toBe(418);
  });
  it("unknown /v2 paths are 404 JSON", async () => {
    expect((await call("GET", "/v2/nope")).status).toBe(404);
  });
});

describe("public endpoints", () => {
  it("serves config, contract (address + ABI) and free-tier state", async () => {
    const cfg = await call("GET", "/v2/config");
    expect(cfg.json).toMatchObject({ chainId: CHAIN_ID, paymaster: PAYMASTER, siweDomains: [DOMAIN], adminChangeDelaySeconds: 172_800 });
    expect(cfg.json.deposits).toMatch(/one-way/);
    expect(cfg.json).not.toHaveProperty("registrationOpen");
    const con = await call("GET", "/v2/contract");
    expect(con.json.address).toBe(PAYMASTER);
    expect(con.json.abi.some((x: { name?: string }) => x.name === "claimProject")).toBe(true);
    expect(con.json.abi.some((x: { name?: string }) => x.name === "depositFor")).toBe(true);
    expect(con.json.abi.some((x: { name?: string }) => /^(requestWithdrawal|executeWithdrawal|cancelWithdrawal|withdrawFreePool)$/.test(x.name ?? ""))).toBe(false);
    const free = await call("GET", "/v2/free-tier");
    expect(free.json).toMatchObject({ enabled: true, perUser: { dailyWei: (50n * PEPU).toString() } });
    expect(free.json.pool.maxOpCost).toBe((40n * PEPU).toString());
    expect(free.json.pool.chainWideDailyCeiling).toBeNull(); // no chain-wide ceiling
    expect(free.json.eligibility).toMatch(/Privy/);
    expect(JSON.stringify(free.json)).not.toMatch(/anonymousw*Tier|dailyCeiling/);
  });
  it("never leaks the RPC url or admin token", async () => {
    const all = JSON.stringify([(await call("GET", "/v2/config")).json, (await call("GET", "/v2/free-tier")).json]);
    expect(all).not.toContain("SECRET-KEY");
    expect(all).not.toContain(ADMIN_TOKEN);
  });
});

describe("SIWE login", () => {
  it("accepts a valid signed message once and issues a session", async () => {
    const token = await login();
    expect((await call("GET", "/v2/me", { bearer: token })).json.address).toBe(owner.address);
  });

  async function rawLogin(mutate: (m: Parameters<typeof buildLoginMessage>[0]) => void, reuseNonce?: string, signer = owner) {
    const nonce = reuseNonce ?? (await call("GET", "/v2/auth/nonce")).json.nonce;
    const now = c.h.clock.now;
    const params = { address: owner.address, domain: DOMAIN, uri: `https://${DOMAIN}`, chainId: CHAIN_ID, nonce, issuedAt: new Date(now), expirationTime: new Date(now + 300_000) };
    mutate(params);
    const message = buildLoginMessage(params);
    return call("POST", "/v2/auth/login", { body: { message, signature: await signer.signMessage({ message }) } });
  }

  it("rejects a replayed nonce", async () => {
    const nonce = (await call("GET", "/v2/auth/nonce")).json.nonce;
    expect((await rawLogin(() => {}, nonce)).status).toBe(200);
    const again = await rawLogin(() => {}, nonce);
    expect(again.status).toBe(401);
    expect(again.json.reason).toBe("invalid_nonce");
  });
  it("rejects an unknown nonce, wrong domain, wrong chain, expired, too-long lifetime and a forged signature", async () => {
    expect((await rawLogin(() => {}, "deadbeef")).json.reason).toBe("invalid_nonce");
    expect((await rawLogin((p) => (p.domain = "evil.example.org"))).json.reason).toBe("domain_mismatch");
    expect((await rawLogin((p) => (p.chainId = 1))).json.reason).toBe("chain_id_mismatch");
    expect((await rawLogin((p) => (p.expirationTime = new Date(c.h.clock.now - 3_600_000)))).json.reason).toBe("message_expired");
    expect((await rawLogin((p) => (p.expirationTime = new Date(c.h.clock.now + 3_600_000)))).json.reason).toBe("expiration_too_far");
    expect((await rawLogin((p) => (p.issuedAt = new Date(c.h.clock.now + 3_600_000)))).json.reason).toBe("issued_in_future");
    c.h.chain.signatureOk = false; // irrelevant: the test chain verifier is the real EOA check
    const forged = await rawLogin(() => {}, undefined, stranger); // signed by another key, claims owner's address
    expect(forged.json.reason).toBe("invalid_signature");
  });
  it("a failed login does not burn the nonce (garbage cannot DoS honest users)", async () => {
    const nonce = (await call("GET", "/v2/auth/nonce")).json.nonce;
    expect((await rawLogin(() => {}, nonce, stranger)).status).toBe(401);
    expect((await rawLogin(() => {}, nonce)).status).toBe(200);
  });
  it("sessions expire", async () => {
    const token = await login();
    c.h.clock.now += 3_600_001;
    expect((await call("GET", "/v2/me", { bearer: token })).status).toBe(401);
  });
  it("logout invalidates the session", async () => {
    const token = await login();
    await call("POST", "/v2/auth/logout", { bearer: token });
    expect((await call("GET", "/v2/me", { bearer: token })).status).toBe(401);
  });
});

describe("no unauthenticated writes", () => {
  it("every owner/admin route rejects a missing credential", async () => {
    const owner401 = [
      ["POST", "/v2/projects"],
      ["POST", "/v2/projects/prepare"],
      ["GET", "/v2/projects"],
      ["GET", `/v2/projects/${PROJECT_ID}`],
      ["POST", `/v2/projects/${PROJECT_ID}/token/rotate`],
      ["POST", `/v2/projects/${PROJECT_ID}/server-key/rotate`],
      ["PATCH", `/v2/projects/${PROJECT_ID}/settings`],
      ["GET", `/v2/projects/${PROJECT_ID}/usage`],
      ["POST", "/v2/auth/logout"],
      ["GET", "/v2/me"],
    ] as const;
    for (const [m, p] of owner401) expect((await call(m, p, { body: m === "GET" ? undefined : {} })).status, `${m} ${p}`).toBe(401);
    const admin401 = [
      ["GET", "/v2/admin/overview"],
      ["GET", "/v2/admin/projects"],
      ["POST", "/v2/admin/apps"],
      ["POST", "/v2/admin/reconcile"],
      ["POST", "/v2/admin/projects/x/status"],
    ] as const;
    for (const [m, p] of admin401) expect((await call(m, p, { body: m === "GET" ? undefined : {} })).status, `${m} ${p}`).toBe(401);
  });
  it("a session is not an admin credential, and the v1 ADMIN_TOKEN style header does nothing without the right value", async () => {
    const token = await login();
    expect((await call("GET", "/v2/admin/overview", { bearer: token })).status).toBe(401);
    expect((await call("GET", "/v2/admin/overview", { admin: "wrong" })).status).toBe(401);
  });
  it("admin routes 404 when no admin token is configured", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ adminToken: null });
    expect((await call("GET", "/v2/admin/overview", { admin: ADMIN_TOKEN })).status).toBe(404);
  });
});

describe("project claim, indexing and token lifecycle", () => {
  it("verify -> prepare claim -> (owner sends tx on-chain) -> index -> token; shows balance, allowlist, usage", async () => {
    const token = await login();
    c.verifier.valid.set(APP, "privy-secret-1");
    const ver = await call("POST", "/v2/projects/verify", { bearer: token, body: { appId: APP, appSecret: "privy-secret-1", ownerAddress: owner.address } });
    expect(ver.status).toBe(200);
    expect(ver.json.action).toBe("claimProject");
    expect(ver.json.projectId).toBe(PROJECT_ID);
    const prep = await call("POST", "/v2/projects/prepare", { bearer: token, body: { action: "claimProject", attestation: ver.json.attestation } });
    expect(prep.status).toBe(200);
    expect(prep.json.to).toBe(PAYMASTER);
    expect(prep.json.value).toBe("0");
    const dec = decodeFunctionData({ abi: PEPU_SPONSORED_PAYMASTER_ABI, data: prep.json.data });
    expect(dec.functionName).toBe("claimProject");
    expect(dec.args).toHaveLength(1); // the claim carries NO targets or limits (delta review L2)
    // the old shape (initial settings alongside the attestation) is rejected, not silently dropped
    const oldShape = await call("POST", "/v2/projects/prepare", { bearer: token, body: { action: "claimProject", attestation: ver.json.attestation, targets: [TARGET], dailyLimitWei: "1", senderDailyLimitWei: "1" } });
    expect(oldShape.status).toBe(400);

    // before the on-chain claim exists: 409
    expect((await call("POST", "/v2/projects", { bearer: token, body: { appId: APP } })).status).toBe(409);

    registerOnChain();
    const created = await call("POST", "/v2/projects", { bearer: token, body: { appId: APP, requireIdentity: false, allowedOrigins: [ORIGIN] } });
    expect(created.status).toBe(201);
    expect(created.json.serverKey).toMatch(/^ppk_/);
    expect(created.json.offchain.allowedOrigins).toEqual([ORIGIN]);
    expect(created.json.projectId).toBe(PROJECT_ID);
    expect(created.json.paymasterUrl).toBe(`https://pm.example.com/v2/paymaster/${created.json.token}`);
    expect((await call("POST", "/v2/projects", { bearer: token, body: { appId: APP } })).status).toBe(409); // already indexed

    const detail = await call("GET", `/v2/projects/${PROJECT_ID}`, { bearer: token });
    expect(detail.status).toBe(200);
    expect(detail.json.onchain.balance).toBe((500n * PEPU).toString());
    expect(detail.json.allowlist).toEqual([TARGET.toLowerCase()]);
    expect(detail.json.adminChangeDelaySeconds).toBe(172_800);
    expect(JSON.stringify(detail.json)).not.toMatch(/withdraw/i);
    expect(JSON.stringify(detail.json)).not.toContain(created.json.token); // plaintext token never shown again

    const list = await call("GET", "/v2/projects", { bearer: token });
    expect(list.json.projects).toHaveLength(1);
    // the minted URL token really sponsors (project-funded) from an allowed origin only, and shows up in usage
    const evil = await call("POST", `/v2/paymaster/${created.json.token}`, { body: rpcData(), headers: { origin: "https://evil.example" } });
    expect(evil.json.error.data.reason).toBe("project_origin_not_allowed");
    const noOrigin = await call("POST", `/v2/paymaster/${created.json.token}`, { body: rpcData() });
    expect(noOrigin.json.error.data.reason).toBe("project_origin_not_allowed");
    const rpc = await call("POST", `/v2/paymaster/${created.json.token}`, { body: rpcData(), headers: { origin: ORIGIN } });
    expect(rpc.json.result?.paymaster).toBe(PAYMASTER);
    // the SERVER key needs no origin and works for any wallet (no Privy identity)
    const viaKey = await call("POST", "/v2/sponsor", { headers: { "x-api-key": created.json.serverKey }, body: { userOp: rpcData({ sender: "0x00000000000000000000000000000000000000c3" }).params[0] } });
    expect(viaKey.status).toBe(200);
    expect(viaKey.json.sponsor.kind).toBe("project");
    const usage = await call("GET", `/v2/projects/${PROJECT_ID}/usage`, { bearer: token });
    expect(usage.json.rows).toHaveLength(2);
    expect(usage.json.rows[0].sponsor).toBe("project");
    expect(usage.json.last24h.ops).toBe(2);

    // rotation kills the old credentials
    const rot = await call("POST", `/v2/projects/${PROJECT_ID}/token/rotate`, { bearer: token });
    expect(rot.json.token).not.toBe(created.json.token);
    const old = await call("POST", `/v2/paymaster/${created.json.token}`, { body: rpcData(), headers: { origin: ORIGIN } });
    expect(old.json.error.data.reason).toBe("unknown_or_invalid_app_credential");
    const rotKey = await call("POST", `/v2/projects/${PROJECT_ID}/server-key/rotate`, { bearer: token });
    expect(rotKey.json.serverKey).not.toBe(created.json.serverKey);
    const oldKey = await call("POST", "/v2/sponsor", { headers: { "x-api-key": created.json.serverKey }, body: { userOp: rpcData().params[0] } });
    expect(oldKey.status).toBe(401);
  });

  it("claims need no API after verification: indexing works by appId or projectId, even after an ownership transfer", async () => {
    // claimed on-chain by someone else, then transferred to `owner`: the id (keccak256(appId)) is still derivable
    const pid = projectIdOf("team-app");
    c.h.chain.setProject(pid, { owner: owner.address, balance: 10n * PEPU });
    c.h.chain.setTargets(pid, [TARGET]);
    c.h.chain.appIds.set(pid.toLowerCase(), "team-app");
    const s = await login();
    const ok = await call("POST", "/v2/projects", { bearer: s, body: { appId: "team-app" } });
    expect(ok.status).toBe(201);
    expect(ok.json.projectId).toBe(pid);
    expect(ok.json.appId).toBe("team-app");
    expect((await call("POST", "/v2/projects", { bearer: s, body: {} })).status).toBe(400);
  });

  it("allowed origins are validated: plain origins only, http only for localhost", async () => {
    registerOnChain();
    const s = await login();
    for (const bad of ["https://app.example/path", "*.example.com", "https://*.example.com", "http://app.example", "javascript:alert(1)", "app.example"]) {
      const r = await call("POST", "/v2/projects", { bearer: s, body: { appId: APP, allowedOrigins: [bad] } });
      expect(r.status, bad).toBe(400);
      expect(r.json.error).toBe("invalid_origin");
    }
    const ok = await call("POST", "/v2/projects", { bearer: s, body: { appId: APP, allowedOrigins: ["https://App.Example", "http://localhost:3000"] } });
    expect(ok.status).toBe(201);
    expect(ok.json.offchain.allowedOrigins).toEqual(["https://app.example", "http://localhost:3000"]);
    const patched = await call("PATCH", `/v2/projects/${PROJECT_ID}/settings`, { bearer: s, body: { allowedOrigins: [] } });
    expect(patched.json.allowedOrigins).toEqual([]);
  });

  it("only the on-chain owner can index or manage; ownership is re-read from the chain on every call", async () => {
    registerOnChain();
    const ownerSession = await login(owner);
    const strangerSession = await login(stranger);
    expect((await call("POST", "/v2/projects", { bearer: strangerSession, body: { projectId: PROJECT_ID } })).status).toBe(403);
    expect((await call("POST", "/v2/projects", { bearer: strangerSession, body: { appId: APP } })).status).toBe(403); // same canonical project id: not the owner
    await call("POST", "/v2/projects", { bearer: ownerSession, body: { appId: APP } });
    for (const [m, p] of [["GET", ""], ["GET", "/usage"], ["GET", "/allowlist"], ["GET", "/events"], ["POST", "/token/rotate"], ["POST", "/server-key/rotate"], ["PATCH", "/settings"]] as const) {
      const r = await call(m, `/v2/projects/${PROJECT_ID}${p}`, { bearer: strangerSession, body: m === "GET" ? undefined : {} });
      expect(r.status, `${m} ${p}`).toBe(403);
    }
    expect((await call("POST", "/v2/projects/prepare", { bearer: strangerSession, body: { action: "setPaused", projectId: PROJECT_ID, paused: true } })).status).toBe(403);
    // ownership transferred on-chain: the old session loses access immediately, the new owner gains it
    c.h.chain.setProject(PROJECT_ID, { owner: stranger.address });
    expect((await call("GET", `/v2/projects/${PROJECT_ID}`, { bearer: ownerSession })).status).toBe(403);
    expect((await call("GET", `/v2/projects/${PROJECT_ID}`, { bearer: strangerSession })).status).toBe(200);
  });

  it("settings: per-user cap bounded by the admin maximum", async () => {
    registerOnChain();
    const s = await login();
    await call("POST", "/v2/projects", { bearer: s, body: { appId: APP } });
    const ok = await call("PATCH", `/v2/projects/${PROJECT_ID}/settings`, { bearer: s, body: { perUserDailyCapWei: (10n * PEPU).toString(), requireIdentity: false } });
    expect(ok.status).toBe(200);
    expect(ok.json.perUserDailyCapWei).toBe((10n * PEPU).toString());
    expect((await call("PATCH", `/v2/projects/${PROJECT_ID}/settings`, { bearer: s, body: { perUserDailyCapWei: (10_000n * PEPU).toString() } })).status).toBe(400);
  });

  it("prepare covers deposit/reclaim/allowlist actions, validates input, and has NO withdrawal actions", async () => {
    registerOnChain();
    const s = await login();
    const mk = async (body: unknown) => call("POST", "/v2/projects/prepare", { bearer: s, body });
    const dep = await mk({ action: "depositFor", projectId: PROJECT_ID, amountWei: "123" });
    expect(dep.json.value).toBe("123");
    expect(decodeFunctionData({ abi: PEPU_SPONSORED_PAYMASTER_ABI, data: dep.json.data }).functionName).toBe("depositFor");
    expect(dep.json.description).toMatch(/one-way/i);
    // a stranger (non-owner) may deposit, and the project need not even be claimed: it is open to anyone
    const strangerSession = await login(stranger);
    const anyone = await call("POST", "/v2/projects/prepare", { bearer: strangerSession, body: { action: "depositFor", projectId: `0x${"ab".repeat(32)}`, amountWei: "5" } });
    expect(anyone.status).toBe(200);
    const st = await mk({ action: "setTargets", projectId: PROJECT_ID, targets: [TARGET], allowed: false });
    expect(decodeFunctionData({ abi: PEPU_SPONSORED_PAYMASTER_ABI, data: st.json.data }).args).toEqual([PROJECT_ID, [TARGET], false]);
    expect((await mk({ action: "executeReclaim", projectId: PROJECT_ID })).status).toBe(200);
    expect((await mk({ action: "cancelReclaim", projectId: PROJECT_ID })).status).toBe(200);
    for (const gone of ["requestWithdrawal", "cancelWithdrawal", "executeWithdrawal", "withdrawFreePool", "depositToProject", "registerProject"]) {
      expect((await mk({ action: gone, projectId: PROJECT_ID, amountWei: "1", to: owner.address })).status, gone).toBe(400);
    }
    expect((await mk({ action: "nope" })).status).toBe(400);
    expect((await mk({ action: "depositFor", projectId: "0x12", amountWei: "1" })).status).toBe(400);
    expect((await mk({ action: "claimProject", targets: [], dailyLimitWei: "0" })).status).toBe(400);
  });

  it("lists on-chain projects the owner claimed but has not indexed yet", async () => {
    registerOnChain();
    c.h.chain.events.push({ name: "ProjectClaimed", args: { projectId: PROJECT_ID, owner: owner.address, appId: APP }, blockNumber: 5n, transactionHash: `0x${"22".repeat(32)}`, logIndex: 0 });
    const s = await login();
    const list = await call("GET", "/v2/projects", { bearer: s });
    expect(list.json.onchainUnindexed).toEqual([{ projectId: PROJECT_ID, appId: APP }]);
  });
});

function rpcData(over = {}) {
  const op = freshOp(over);
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "pm_getPaymasterData",
    params: [
      { sender: op.sender, nonce: hex(op.nonce), callData: op.callData, callGasLimit: hex(op.callGasLimit), verificationGasLimit: hex(op.verificationGasLimit), preVerificationGas: hex(op.preVerificationGas), maxFeePerGas: hex(op.maxFeePerGas), maxPriorityFeePerGas: hex(op.maxPriorityFeePerGas), signature: "0x00" },
      ENTRY_POINT,
      hex(BigInt(CHAIN_ID)),
    ],
  };
}

describe("admin API", () => {
  it("creates a free-tier-only app, lists, suspends, rotates, and reports overview; all audited", async () => {
    const mk = await call("POST", "/v2/admin/apps", { admin: ADMIN_TOKEN, body: { label: "Demo App", perUserDailyCapWei: (20n * PEPU).toString() } });
    expect(mk.status).toBe(201);
    const key = mk.json.key as string;
    expect((await call("POST", "/v2/admin/apps", { admin: ADMIN_TOKEN, body: { label: "Demo App" } })).status).toBe(409);
    expect((await call("GET", "/v2/admin/projects", { admin: ADMIN_TOKEN })).json.projects).toHaveLength(1);
    expect((await call("POST", `/v2/admin/projects/${encodeURIComponent(key)}/status`, { admin: ADMIN_TOKEN, body: { status: "suspended" } })).status).toBe(200);
    const denied = await call("POST", `/v2/paymaster/${mk.json.token}`, { body: rpcData() });
    expect(denied.json.error.data.reason).toBe("app_suspended");
    const rot = await call("POST", `/v2/admin/projects/${encodeURIComponent(key)}/token/rotate`, { admin: ADMIN_TOKEN });
    expect(rot.json.token).not.toBe(mk.json.token);
    const ov = await call("GET", "/v2/admin/overview", { admin: ADMIN_TOKEN });
    expect(ov.status).toBe(200);
    expect(ov.json.recentAdminActions.map((a: { action: string }) => a.action)).toContain("create_free_app");
    expect((await call("POST", "/v2/admin/reconcile", { admin: ADMIN_TOKEN })).status).toBe(200);
  });
});

describe("ERC-7677 route", () => {
  it("stub returns a same-length dummy-signature layout with the project's sponsorId; unknown token still gets a free-pool stub", async () => {
    registerOnChain();
    const s = await login();
    const created = await call("POST", "/v2/projects", { bearer: s, body: { appId: APP } });
    const stub = (tok: string) => call("POST", `/v2/paymaster/${tok}`, { body: { ...rpcData(), method: "pm_getPaymasterStubData" } });
    const a = await stub(created.json.token);
    const b = await stub("ppt_unknown");
    expect(a.json.result.isFinal).toBe(false);
    expect(a.json.result.paymasterData.length).toBe(b.json.result.paymasterData.length);
    expect(a.json.result.paymasterData.slice(2 + 13 * 2, 2 + 45 * 2)).toBe(PROJECT_ID.slice(2));
    expect(b.json.result.paymasterData.slice(2 + 13 * 2, 2 + 45 * 2)).toBe("00".repeat(32));
    expect((await call("POST", `/v2/paymaster/ppt_unknown`, { body: rpcData() })).json.error.data.reason).toBe("unknown_or_invalid_app_credential");
  });
  it("rejects a wrong entryPoint/chain and unsupported methods", async () => {
    const bad = rpcData();
    bad.params[1] = "0x0000000000000000000000000000000000000001";
    expect((await call("POST", "/v2/paymaster/x", { body: bad })).json.error.code).toBe(-32602);
    expect((await call("POST", "/v2/paymaster/x", { body: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } })).json.error.code).toBe(-32601);
  });
  it("accepts the optional context.privyAccessToken (identity for the free tier)", async () => {
    c.h.resolver.tokens.set("tok", "user-1");
    const { token } = c.h.addFreeApp();
    const body = rpcData();
    (body.params as unknown[])[3] = { privyAccessToken: "tok" };
    const r = await call("POST", `/v2/paymaster/${token}`, { body });
    expect(r.json.result.paymasterData).toMatch(/^0x02/);
    expect(c.h.db.freeIdentitySpendWei("privy:user-1", 0)).toBeGreaterThan(0n);
  });
  it("POST /v2/sponsor maps denial reasons to HTTP statuses", async () => {
    const op = rpcData().params[0] as Record<string, string>;
    const r = await call("POST", "/v2/sponsor", { headers: { "x-api-key": "nope" }, body: { userOp: op } });
    expect(r.status).toBe(401);
    expect(r.json.reason).toBe("unknown_or_invalid_app_credential");
  });
});

describe("rate limiting and CORS", () => {
  it("rate-limits the auth endpoints per IP", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, authPerIpPerMinute: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await call("GET", "/v2/auth/nonce")).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const limited = await call("GET", "/v2/auth/nonce");
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
  it("rate-limits admin attempts per IP (brute-force guard)", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, adminPerIpPerMinute: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await call("GET", "/v2/admin/overview", { admin: "guess" + i })).status);
    expect(codes).toEqual([401, 401, 429, 429]);
  });
  it("rate-limits owner endpoints per address", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, ownerPerAddressPerMinute: 2 } });
    const s = await login();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await call("GET", "/v2/me", { bearer: s })).status);
    expect(codes).toEqual([200, 200, 429, 429]);
  });
  it("sends CORS headers only for configured origins and answers preflight", async () => {
    const ok = await call("GET", "/v2/config", { headers: { origin: "https://dashboard.example.com" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://dashboard.example.com");
    const evil = await call("GET", "/v2/config", { headers: { origin: "https://evil.example.org" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await call("OPTIONS", "/v2/projects", { headers: { origin: "https://dashboard.example.com" } });
    expect(pre.status).toBe(204);
  });
});

describe("POST /v2/projects/verify (Privy app secret -> signed claim attestation)", () => {
  const SECRET = "privy-app-secret-DO-NOT-LEAK-0123456789";
  const verifyBody = (over: Record<string, unknown> = {}) => ({ appId: APP, appSecret: SECRET, ownerAddress: owner.address, ...over });

  async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
    const lines: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      return { result: await fn(), output: lines.join("\n") };
    } finally {
      Object.assign(console, orig);
    }
  }

  it("issues a first-claim attestation the contract's EIP-712 digest verifies, bound to chain, paymaster, owner and deadline", async () => {
    c.verifier.valid.set(APP, SECRET);
    const s = await login();
    const r = await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody() });
    expect(r.status).toBe(200);
    expect(r.json.action).toBe("claimProject");
    expect(r.json.projectId).toBe(PROJECT_ID);
    const a = r.json.attestation;
    expect(a).toMatchObject({ appId: APP, newOwner: owner.address });
    expect(BigInt(a.deadline)).toBe(BigInt(Math.floor(c.h.clock.now / 1000) + 600));
    const ok = await verifyTypedData({
      address: signer.address,
      domain: { name: "PepuSponsoredPaymaster", version: "1", chainId: CHAIN_ID, verifyingContract: PAYMASTER },
      types: { ProjectClaim: [{ name: "appId", type: "string" }, { name: "newOwner", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "ProjectClaim",
      message: { appId: APP, newOwner: owner.address, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
      signature: a.signature,
    });
    expect(ok).toBe(true);
    // each call uses a fresh nonce
    const r2 = await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody() });
    expect(r2.json.attestation.nonce).not.toBe(a.nonce);
  });

  it("returns a reclaim attestation (with the timelock warning) when the project is already owned by someone else", async () => {
    c.verifier.valid.set(APP, SECRET);
    registerOnChain(stranger.address);
    const s = await login();
    const r = await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody() });
    expect(r.status).toBe(200);
    expect(r.json.action).toBe("reclaimProject");
    expect(r.json.note).toMatch(/48h/);
  });

  it("409s when the wallet already owns the project", async () => {
    c.verifier.valid.set(APP, SECRET);
    registerOnChain();
    const r = await call("POST", "/v2/projects/verify", { bearer: await login(), body: verifyBody() });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("already_owner");
  });

  it("requires a SIWE session for the SAME address as ownerAddress", async () => {
    c.verifier.valid.set(APP, SECRET);
    expect((await call("POST", "/v2/projects/verify", { body: verifyBody() })).status).toBe(401);
    const strangerSession = await login(stranger);
    const r = await call("POST", "/v2/projects/verify", { bearer: strangerSession, body: verifyBody() }); // claims owner's address
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("owner_mismatch");
    expect(c.verifier.calls).toHaveLength(0); // never even asked Privy
  });

  it("rejects a wrong secret (403) and reports Privy outages as 502, never as a verdict", async () => {
    c.verifier.valid.set(APP, SECRET);
    const s = await login();
    const bad = await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody({ appSecret: "nope" }) });
    expect(bad.status).toBe(403);
    expect(bad.json.error).toBe("invalid_privy_credentials");
    c.verifier.down = true;
    const down = await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody() });
    expect(down.status).toBe(502);
  });

  it("NEVER stores, logs or echoes the app secret (success, wrong secret, Privy error, malformed body)", async () => {
    c.verifier.valid.set(APP, SECRET);
    const s = await login();
    const { output, result } = await captureConsole(async () => {
      const out: { status: number; text: string }[] = [];
      const post = async (body: unknown) => {
        const res = await fetch(c.base + "/v2/projects/verify", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s}` }, body: JSON.stringify(body) });
        out.push({ status: res.status, text: await res.text() });
      };
      await post(verifyBody()); // success
      await post(verifyBody({ appSecret: `${SECRET}-wrong` })); // wrong secret
      c.verifier.down = true;
      await post(verifyBody()); // verifier throws an error whose message contains the secret
      c.verifier.down = false;
      await post({ appId: APP, appSecret: SECRET, ownerAddress: owner.address, extra: SECRET }); // strict schema rejects extras
      await post({ appId: "bad id with spaces", appSecret: SECRET, ownerAddress: owner.address });
      await post({ appId: APP, appSecret: SECRET, ownerAddress: "0xnot-an-address" });
      return out;
    });
    expect(result.map((r) => r.status)).toEqual([200, 403, 502, 400, 400, 400]);
    for (const r of result) expect(r.text).not.toContain(SECRET);
    expect(output).not.toContain(SECRET);
    // nothing about the secret is persisted anywhere in the database
    const dump = JSON.stringify([c.h.db.listAllProjects(), c.h.db.listAdminAudit(100)]);
    expect(dump).not.toContain(SECRET);
  });

  it("is rate limited per IP and per Privy app id (bounds secret guessing)", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, verifyPerAppPerMinute: 2, verifyPerIpPerMinute: 5 } });
    c.verifier.valid.set(APP, SECRET);
    const s = await login();
    const post = (over: Record<string, unknown> = {}) => call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody(over) });
    expect((await post({ appSecret: "g1" })).status).toBe(403);
    expect((await post({ appSecret: "g2" })).status).toBe(403);
    const limited = await post({ appSecret: "g3" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(c.verifier.calls).toHaveLength(2); // the third guess never reached Privy
    // a different app id has its own budget; the per-IP budget (5) is shared across apps
    for (let i = 0; i < 2; i++) expect((await post({ appId: `other-${i}`, appSecret: "x" })).status).toBe(403);
    expect((await post({ appId: "other-9", appSecret: "x" })).status).toBe(429);
  });

  it("is disabled (501) when no signer or Privy verifier is configured", async () => {
    await new Promise((r) => c.server.close(r));
    const h = makeHarness();
    h.chain.verifySignature = async (address: Address, message: string, signature: Hex) => verifyMessage({ address, message, signature });
    const config = testConfig();
    const siwe = new SiweAuth({ db: h.db, chain: h.chain, chainId: CHAIN_ID, config: config.siwe, now: () => h.clock.now });
    const reconciler = new Reconciler({ db: h.db, chain: h.chain, deployBlock: 0n, chunkBlocks: 1000n, voidSafetyMarginSeconds: 0 });
    const api = createSponsorshipV2({ config, db: h.db, chain: h.chain, engine: h.engine, siwe, identity: h.identity, reconciler, now: () => h.clock.now });
    const server = createServer(async (req, res) => void (await api.handle(req, res)));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    c = { verifier: new FakeSecretVerifier(), h, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    const r = await call("POST", "/v2/projects/verify", { bearer: await login(), body: verifyBody() });
    expect(r.status).toBe(501);
  });
});

describe("delta review regressions (L1 verify lockout, L4 stale credentials, X-Forwarded-For)", () => {
  const SECRET = "legit-secret";
  const verifyBody = (over: Record<string, unknown> = {}) => ({ appId: APP, appSecret: SECRET, ownerAddress: owner.address, ...over });

  // L1 (was PoC S1): a stranger's failed guesses must not spend the real owner's verify budget.
  it("L1: a stranger cannot lock the real owner out of verify (budget is per app AND per account, charged on failure)", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, verifyPerAppPerMinute: 5, verifyPerIpPerMinute: 10 } });
    c.verifier.valid.set(APP, SECRET);
    const attacker = await login(stranger);
    for (let i = 0; i < 5; i++) {
      const r = await call("POST", "/v2/projects/verify", { bearer: attacker, body: verifyBody({ appSecret: `junk${i}`, ownerAddress: stranger.address }) });
      expect(r.status).toBe(403);
    }
    // the attacker's own budget for this app is spent...
    const again = await call("POST", "/v2/projects/verify", { bearer: attacker, body: verifyBody({ appSecret: "junk-x", ownerAddress: stranger.address }) });
    expect(again.status).toBe(429);
    // ...but the legitimate owner is unaffected
    const legit = await call("POST", "/v2/projects/verify", { bearer: await login(owner), body: verifyBody() });
    expect(legit.status).toBe(200);
  });

  it("L1: successful verifications are not charged to the failure budget; brute force by one account stays bounded", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, verifyPerAppPerMinute: 2, verifyPerIpPerMinute: 100 } });
    c.verifier.valid.set(APP, SECRET);
    const s = await login();
    for (let i = 0; i < 4; i++) expect((await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody() })).status).toBe(200);
    expect((await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody({ appSecret: "g1" }) })).status).toBe(403);
    expect((await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody({ appSecret: "g2" }) })).status).toBe(403);
    const blocked = await call("POST", "/v2/projects/verify", { bearer: s, body: verifyBody({ appSecret: "g3" }) });
    expect(blocked.status).toBe(429);
    expect(c.verifier.calls.filter((x) => x.appSecret.startsWith("g"))).toHaveLength(2); // the third never reached Privy
  });

  // L4 (was PoC S2) through the HTTP API
  it("L4: after the on-chain owner changes, the old owner's server key and client token stop working", async () => {
    const tok = await login(owner);
    registerOnChain();
    const created = await call("POST", "/v2/projects", { bearer: tok, body: { appId: APP, requireIdentity: false, allowedOrigins: [ORIGIN] } });
    expect(created.status).toBe(201);
    const op = rpcData({ sender: "0x00000000000000000000000000000000000000c3" }).params[0];
    const before = await call("POST", "/v2/sponsor", { headers: { "x-api-key": created.json.serverKey }, body: { userOp: op } });
    expect(before.status).toBe(200);
    c.h.chain.setProject(PROJECT_ID, { owner: stranger.address, balance: 500n * PEPU, dailyLimit: 1_000n * PEPU });
    const viaOldKey = await call("POST", "/v2/sponsor", { headers: { "x-api-key": created.json.serverKey }, body: { userOp: op } });
    expect(viaOldKey.status).toBe(403);
    expect(viaOldKey.json.reason).toBe("project_owner_changed");
    // and the old credentials stay dead afterwards
    const again = await call("POST", "/v2/sponsor", { headers: { "x-api-key": created.json.serverKey }, body: { userOp: op } });
    expect(again.status).toBe(401);
    const viaOldToken = await call("POST", "/v2/sponsor", { headers: { "x-api-key": created.json.token, origin: ORIGIN }, body: { userOp: op } });
    expect(viaOldToken.status).toBe(401);
    // the NEW owner gets working credentials from the rotate routes
    const newTok = await login(stranger);
    const rot = await call("POST", `/v2/projects/${PROJECT_ID}/server-key/rotate`, { bearer: newTok });
    expect(rot.status).toBe(200);
    const ok = await call("POST", "/v2/sponsor", { headers: { "x-api-key": rot.json.serverKey }, body: { userOp: op } });
    expect(ok.status).toBe(200);
  });

  it("L4: the new owner's first owner-route call revokes the previous owner's credentials (ownerGate)", async () => {
    const tok = await login(owner);
    registerOnChain();
    const created = await call("POST", "/v2/projects", { bearer: tok, body: { appId: APP, requireIdentity: false, allowedOrigins: [ORIGIN] } });
    c.h.chain.setProject(PROJECT_ID, { owner: stranger.address, balance: 500n * PEPU, dailyLimit: 1_000n * PEPU });
    expect((await call("GET", `/v2/projects/${PROJECT_ID}`, { bearer: await login(stranger) })).status).toBe(200);
    const op = rpcData({ sender: "0x00000000000000000000000000000000000000c3" }).params[0];
    const viaOldKey = await call("POST", "/v2/sponsor", { headers: { "x-api-key": created.json.serverKey }, body: { userOp: op } });
    expect(viaOldKey.status).toBe(401);
    expect(c.h.db.getByProjectId(PROJECT_ID)?.allowedOrigins).toEqual([]);
  });

  it("X-Forwarded-For: with trustProxy the client is the rightmost untrusted hop, a spoofed leftmost entry does not evade the limit", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ trustProxy: true, trustedProxyHops: 1, rateLimits: { ...testConfig().rateLimits, authPerIpPerMinute: 2 } });
    const hit = (xff: string) => call("GET", "/v2/auth/nonce", { headers: { "x-forwarded-for": xff } });
    expect((await hit("spoof-1, 8.8.8.8")).status).toBe(200);
    expect((await hit("spoof-2, 8.8.8.8")).status).toBe(200);
    expect((await hit("spoof-3, 8.8.8.8")).status).toBe(429); // same real client, different spoofed prefix
    expect((await hit("spoof-1, 9.9.9.9")).status).toBe(200); // a different real client has its own budget
  });

  it("X-Forwarded-For: TRUSTED_PROXY_HOPS=2 skips the inner proxy's own entry", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ trustProxy: true, trustedProxyHops: 2, rateLimits: { ...testConfig().rateLimits, authPerIpPerMinute: 1 } });
    const hit = (xff: string) => call("GET", "/v2/auth/nonce", { headers: { "x-forwarded-for": xff } });
    expect((await hit("junk-a, 5.5.5.5, 10.0.0.1")).status).toBe(200);
    expect((await hit("junk-b, 5.5.5.5, 10.0.0.2")).status).toBe(429);
    expect((await hit("junk-b, 6.6.6.6, 10.0.0.2")).status).toBe(200);
  });
});

describe("review 3 regressions (M-3 flood, L-5 deployment switch, C-L1 appId binding, first-claim note)", () => {
  const sponsorBody = (over = {}) => ({ userOp: rpcData(over).params[0] });

  /** Audit C's PoC 2, adapted: the flood no longer writes one audit row per request and is throttled per IP. */
  it("M-3 (C PoC 2): junk credentials on POST /v2/sponsor are throttled per IP before the body is read, and never persisted", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, sponsorPerIpPerMinute: 50 } });
    const N = 200;
    const statuses = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const r = await call("POST", "/v2/sponsor", { headers: { "x-api-key": "junk-" + i }, body: sponsorBody() });
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      if (r.status === 429) expect(r.headers.get("retry-after")).toMatch(/^[0-9]+$/);
    }
    expect(statuses.get(401)).toBe(50);
    expect(statuses.get(429)).toBe(N - 50);
    expect(c.h.db.listAudit(1_000_000)).toHaveLength(0); // C's PoC: 1500 requests -> 1500 rows
    // the 50 that got through were counted in memory
    expect(c.h.engine.stats().unknownCredentialDenials).toBe(50);
    // the limiter is checked BEFORE the body is read: an oversized/garbage body from a throttled IP is still just a 429
    const huge = await fetch(c.base + "/v2/sponsor", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "junk-x" }, body: "{" + "x".repeat(1_000_000) });
    expect(huge.status).toBe(429);
  });

  it("M-3 (C PoC 2): ERC-7677 requests with random tokens are limited per IP, a real token is not affected, nothing is persisted", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ rateLimits: { ...testConfig().rateLimits, rpcUnknownTokenPerIpPerMinute: 10 } });
    const { serverKey } = c.h.addProject();
    let limited = 0;
    for (let i = 0; i < 100; i++) {
      const r = await call("POST", `/v2/paymaster/random-token-${i}`, { body: rpcData() });
      if (r.json.error?.code === -32005) limited++;
    }
    expect(limited).toBe(90); // C's PoC: 0 of 100 limited
    expect(c.h.db.listAudit(1_000_000)).toHaveLength(0);
    // a known token (here the project's server key) still works while the unknown-token bucket is exhausted
    for (let i = 0; i < 5; i++) {
      const ok = await call("POST", `/v2/paymaster/${serverKey}`, { body: rpcData() });
      expect(ok.json.error?.code).not.toBe(-32005);
    }
  });

  it("openapi documents 400 and 413 on POST /v2/sponsor: the route really returns them", async () => {
    const bad = await fetch(c.base + "/v2/sponsor", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: "{not json" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_json");
    const huge = await fetch(c.base + "/v2/sponsor", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify({ userOp: { pad: "x".repeat(300 * 1024) } }) });
    expect(huge.status).toBe(413);
    const shape = await call("POST", "/v2/sponsor", { headers: { "x-api-key": "k" }, body: { nope: true } });
    expect(shape.status).toBe(400);
    expect(shape.json.error).toBe("malformed_request");
  });

  it("M-3: the admin overview reports the in-memory unknown-credential counter", async () => {
    await call("POST", "/v2/sponsor", { headers: { "x-api-key": "junk" }, body: sponsorBody() });
    const ov = await call("GET", "/v2/admin/overview", { admin: ADMIN_TOKEN });
    expect(ov.status).toBe(200);
    expect(ov.json.unauthenticated.unknownCredentialDenials).toBe(1);
  });

  /** Audit C's PoC 3, adapted: both routes refuse a factory op when account deployment is off. */
  it("L-5 (C PoC 3): allowAccountDeployment=false is enforced on POST /v2/sponsor as well as on the ERC-7677 route", async () => {
    await new Promise((r) => c.server.close(r));
    c = await start({ allowAccountDeployment: false }, { allowAccountDeployment: false });
    const { serverKey } = c.h.addProject();
    const op = { ...(rpcData().params[0] as Record<string, unknown>), factory: "0x0000000000000000000000000000000000000f00", factoryData: "0xdeadbeef" };
    const rpc = await call("POST", `/v2/paymaster/${serverKey}`, { body: { jsonrpc: "2.0", id: 1, method: "pm_getPaymasterData", params: [op, ENTRY_POINT, hex(BigInt(CHAIN_ID))] } });
    expect(rpc.json.error.code).toBe(-32001);
    expect(rpc.json.error.data.reason).toBe("account_deployment_disabled_on_public_endpoint");
    const rest = await call("POST", "/v2/sponsor", { headers: { "x-api-key": serverKey }, body: { userOp: op } });
    expect(rest.status).toBe(403); // C's PoC: 200 approved
    expect(rest.json.reason).toBe("account_deployment_disabled");
  });

  /** Audit C's PoC 4 / lead L1, adapted: a request-supplied appId must hash to the projectId. */
  it("C-L1 (C PoC 4): POST /v2/projects never indexes a project under an appId that does not hash to its projectId", async () => {
    const s = await login();
    const attackerApp = "attacker-app";
    const pid = projectIdOf(attackerApp);
    c.h.chain.setProject(pid, { owner: owner.address, balance: 10n * PEPU });
    c.h.chain.setTargets(pid, [TARGET]);
    // the chain lookup fails (no ProjectClaimed/ProjectClaimProposed event known): the old code took body.appId on faith
    const forged = await call("POST", "/v2/projects", { bearer: s, body: { projectId: pid, appId: "pepu-own-privy-app" } });
    expect(forged.status).toBe(400);
    expect(forged.json.error).toBe("app_id_mismatch");
    expect(c.h.db.getByProjectId(pid)).toBeNull();
    // projectId alone: indexed under the projectId hex, never a guessed app id
    const alone = await call("POST", "/v2/projects", { bearer: s, body: { projectId: pid } });
    expect(alone.status).toBe(201);
    expect(alone.json.appId).toBe(pid);
  });

  it("C-L1: a matching appId is accepted even when the chain lookup has nothing", async () => {
    const s = await login();
    const pid = projectIdOf("honest-app");
    c.h.chain.setProject(pid, { owner: owner.address, balance: 10n * PEPU });
    c.h.chain.setTargets(pid, [TARGET]);
    const ok = await call("POST", "/v2/projects", { bearer: s, body: { projectId: pid, appId: "honest-app" } });
    expect(ok.status).toBe(201);
    expect(ok.json.appId).toBe("honest-app");
  });

  it("M-1: verify tells the owner a claim of an already-funded project is pending for the admin delay", async () => {
    const SECRET = "privy-secret-pending";
    c.verifier.valid.set(APP, SECRET);
    const s = await login();
    const empty = await call("POST", "/v2/projects/verify", { bearer: s, body: { appId: APP, appSecret: SECRET, ownerAddress: owner.address } });
    expect(empty.json).toMatchObject({ action: "claimProject", takesEffect: "immediately" });
    c.h.chain.setProject(PROJECT_ID, { owner: "0x0000000000000000000000000000000000000000", balance: 5n * PEPU });
    const funded = await call("POST", "/v2/projects/verify", { bearer: s, body: { appId: APP, appSecret: SECRET, ownerAddress: owner.address } });
    expect(funded.json).toMatchObject({ action: "claimProject", takesEffect: "after_admin_change_delay" });
    expect(funded.json.note).toMatch(/PENDING/);
    expect(funded.json.note).toMatch(/executeReclaim/);
  });
});
