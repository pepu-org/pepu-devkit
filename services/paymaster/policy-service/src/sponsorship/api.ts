/**
 * The gated `/v2` HTTP API (SPEC section 10; contract in openapi.yaml). Mounted by server.ts ONLY when the v2 feature
 * flag is on; with the flag off none of these routes exist.
 *
 * Auth tiers:
 *   public    : config / contract / free-tier state, SIWE nonce+login (rate-limited per IP)
 *   owner     : `Authorization: Bearer <SIWE session>`; the session address must equal the project's CURRENT on-chain
 *               owner (re-read on every call). No unauthenticated writes anywhere.
 *   admin     : `X-Admin-Token` == SPONSORSHIP_ADMIN_TOKEN (distinct from v1's ADMIN_TOKEN); 404 when unset.
 *   sponsor   : `/v2/sponsor` (app token + Privy token) and `/v2/paymaster/:token` (ERC-7677), authenticated by tokens.
 * Funds never move through this API: deposits are on-chain txs from anyone's wallet and there are NO withdrawals; `prepare`
 * only encodes calldata. Project ownership comes from an on-chain claim backed by an attestation from POST
 * /v2/projects/verify (Privy app secret check; the secret is never stored, logged or echoed).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, type Address, type Hex, type LocalAccount } from "viem";
import { ZodError, z } from "zod";
import { parseSponsorRequestBody } from "../requestSchema.js";
import { PEPU_SPONSORED_PAYMASTER_ABI } from "./abi.js";
import type { ChainReader } from "./chain.js";
import type { SponsorshipConfig } from "./config.js";
import { SponsorshipDb } from "./db.js";
import { normalizeOrigin, statusForSponsorshipReason, type SponsorshipEngine } from "./engine.js";
import { FREE_POOL_ID, isBytes32Hex, projectIdOf } from "./paymasterData.js";
import { signClaimAttestation, type PrivySecretVerifier } from "./projectVerify.js";
import { actionNeedsOwner, prepareRequestSchema, prepareTransaction } from "./prepare.js";
import { RateLimiter } from "./rateLimit.js";
import type { Reconciler } from "./reconciler.js";
import { handleV2RpcBody, type V2RpcConfig } from "./rpc.js";
import type { SiweAuth } from "./siwe.js";
import type { IdentityService } from "./identity.js";
import type { OnchainSponsor, ProjectRecord } from "./types.js";

export interface SponsorshipApiDeps {
  config: SponsorshipConfig;
  db: SponsorshipDb;
  chain: ChainReader;
  engine: SponsorshipEngine;
  siwe: SiweAuth;
  identity: IdentityService;
  reconciler: Pick<Reconciler, "runOnce" | "status">;
  /** The policy signer (signs claim attestations). Without it, and `privySecretVerifier`, /v2/projects/verify is disabled. */
  signerAccount?: LocalAccount;
  privySecretVerifier?: PrivySecretVerifier;
  now?: () => number;
}

export interface SponsorshipV2 {
  /** Returns true if it handled (responded to) the request. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

const MAX_BODY = 256 * 1024;
const ZERO = "0x0000000000000000000000000000000000000000";
const DAY_S = 86_400;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function sha(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha(a), sha(b));
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > MAX_BODY) throw new HttpError(413, "body_too_large", "request body too large");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "request body is not valid JSON");
  }
}

const bigintReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

export function createSponsorshipV2(deps: SponsorshipApiDeps): SponsorshipV2 {
  const { config, db, chain } = deps;
  const now = () => (deps.now ?? Date.now)();
  const rl = config.rateLimits;
  const limiters = {
    auth: new RateLimiter({ windowMs: 60_000, max: rl.authPerIpPerMinute }, now),
    owner: new RateLimiter({ windowMs: 60_000, max: rl.ownerPerAddressPerMinute }, now),
    admin: new RateLimiter({ windowMs: 60_000, max: rl.adminPerIpPerMinute }, now),
    rpc: new RateLimiter({ windowMs: 60_000, max: rl.rpcPerKeyPerMinute }, now),
    pub: new RateLimiter({ windowMs: 60_000, max: rl.publicPerIpPerMinute }, now),
    verifyIp: new RateLimiter({ windowMs: 60_000, max: rl.verifyPerIpPerMinute }, now),
    verifyApp: new RateLimiter({ windowMs: 60_000, max: rl.verifyPerAppPerMinute }, now),
    /** POST /v2/sponsor per IP, charged BEFORE the body is read (review 3, M-3). */
    sponsor: new RateLimiter({ windowMs: 60_000, max: rl.sponsorPerIpPerMinute }, now),
    /** ERC-7677 requests per IP whose URL token resolves to no credential (junk tokens dodge the per-token limiter). */
    rpcUnknown: new RateLimiter({ windowMs: 60_000, max: rl.rpcUnknownTokenPerIpPerMinute }, now),
  };

  const rpcConfig: V2RpcConfig = {
    engine: deps.engine,
    db,
    entryPointAddress: config.entryPointAddress,
    chainId: config.chainId,
    paymasterAddress: config.paymasterAddress,
    paymasterVerificationGasLimit: config.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: config.paymasterPostOpGasLimit,
    validityWindowSeconds: config.validityWindowSeconds,
  };

  function ip(req: IncomingMessage): string {
    if (config.trustProxy) {
      // Proxies APPEND to X-Forwarded-For, so the leftmost entries are client-controlled. With N trusted proxies the
      // address the outermost trusted proxy saw is entry (length - N); everything left of it is ignored (delta review).
      const xff = header(req, "x-forwarded-for");
      if (xff) {
        const hops = xff.split(",").map((h) => h.trim());
        return hops[Math.max(0, hops.length - Math.max(1, config.trustedProxyHops))] || "unknown";
      }
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  function throttle(l: RateLimiter, key: string): void {
    const d = l.check(key);
    if (!d.ok) throw new HttpError(429, "rate_limited", "too many requests", { retryAfterSeconds: d.retryAfterSeconds });
  }

  function cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = header(req, "origin");
    res.setHeader("Vary", "Origin");
    if (origin && config.apiAllowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
    }
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body, bigintReplacer));
  }

  /* ----------------------------- auth helpers ----------------------------- */

  function session(req: IncomingMessage): { address: Address; token: string } {
    const h = header(req, "authorization");
    const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
    const token = m?.[1]?.trim();
    const s = token ? db.getSession(token, now()) : null;
    if (!token || !s) throw new HttpError(401, "unauthenticated", "missing or expired session; sign in with SIWE (GET /v2/auth/nonce, POST /v2/auth/login)");
    throttle(limiters.owner, `owner:${s.address}`);
    return { address: getAddress(s.address), token };
  }

  function admin(req: IncomingMessage): string {
    if (!config.adminToken) throw new HttpError(404, "not_found", "Not found.");
    throttle(limiters.admin, `admin:${ip(req)}`);
    const provided = header(req, "x-admin-token");
    if (!provided || !safeEqual(provided, config.adminToken)) throw new HttpError(401, "unauthenticated", "missing or invalid X-Admin-Token");
    return "admin";
  }

  /** Validates and normalises `scheme://host[:port]` origins; rejects anything else (paths, wildcards, junk). */
  function parseOrigins(list: string[]): string[] {
    const out = new Set<string>();
    for (const raw of list) {
      const n = normalizeOrigin(raw);
      if (!n || n !== raw.trim().replace(/\/+$/, "").toLowerCase()) {
        throw new HttpError(400, "invalid_origin", `"${raw}" is not a plain origin (expected scheme://host[:port], no path or wildcard)`);
      }
      if (n.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(n)) {
        throw new HttpError(400, "invalid_origin", `"${raw}": plain http is only allowed for localhost`);
      }
      out.add(n);
    }
    return [...out];
  }

  function parseProjectId(raw: string): Hex {
    if (!isBytes32Hex(raw) || raw.toLowerCase() === FREE_POOL_ID) throw new HttpError(400, "invalid_project_id", "projectId must be a 32-byte hex id");
    return raw.toLowerCase() as Hex;
  }

  async function onchainOrThrow(projectId: Hex): Promise<OnchainSponsor> {
    try {
      return await chain.getSponsor(projectId, { fresh: true });
    } catch {
      throw new HttpError(503, "chain_read_failed", "could not read on-chain state");
    }
  }

  /** Session address must equal the project's CURRENT on-chain owner. */
  async function ownerGate(req: IncomingMessage, projectIdRaw: string): Promise<{ address: Address; projectId: Hex; onchain: OnchainSponsor }> {
    const s = session(req);
    const projectId = parseProjectId(projectIdRaw);
    const onchain = await onchainOrThrow(projectId);
    if (onchain.owner === ZERO) throw new HttpError(404, "project_not_found", "no such project on-chain");
    if (onchain.owner.toLowerCase() !== s.address.toLowerCase()) throw new HttpError(403, "not_project_owner", "the signed-in address is not this project's on-chain owner");
    const row = db.getByProjectId(projectId);
    if (row && row.owner?.toLowerCase() !== onchain.owner.toLowerCase()) {
      // the owner changed on-chain: credentials issued to the previous owner are revoked (delta review L4); the new
      // owner (this caller) gets fresh ones from the rotate routes
      if (row.owner) db.revokeCredentialsForOwnerChange(row.key, onchain.owner, now());
      else db.setOwnerSnapshot(row.key, onchain.owner, now());
    }
    return { address: s.address, projectId, onchain };
  }

  /* ------------------------------ view builders ------------------------------ */

  function effective(o: OnchainSponsor, outstanding: bigint) {
    const today = Math.floor(now() / 1000 / DAY_S);
    const spentToday = o.spentDay < today ? 0n : o.spentToday;
    const spendable = o.balance > outstanding ? o.balance - outstanding : 0n;
    return { spentToday, spendable, dailyRemaining: o.dailyLimit > spentToday + outstanding ? o.dailyLimit - spentToday - outstanding : 0n };
  }

  function offchainView(p: ProjectRecord) {
    return {
      key: p.key,
      status: p.status,
      perUserDailyCapWei: p.perUserDailyCapWei,
      requireIdentity: p.requireIdentity,
      identityVerifiable: deps.identity.canVerify(p.appId),
      tokenPrefix: p.tokenPrefix,
      tokenRotatedAt: p.tokenRotatedAtMs ? new Date(p.tokenRotatedAtMs).toISOString() : null,
      serverKeyPrefix: p.serverKeyPrefix,
      serverKeyRotatedAt: p.serverKeyRotatedAtMs ? new Date(p.serverKeyRotatedAtMs).toISOString() : null,
      allowedOrigins: p.allowedOrigins,
      createdAt: new Date(p.createdAtMs).toISOString(),
    };
  }

  function paymasterUrl(token: string): string {
    return `${config.publicBaseUrl}/v2/paymaster/${token}`;
  }

  async function projectDetail(projectId: Hex, onchain: OnchainSponsor) {
    const row = db.getByProjectId(projectId);
    const outstanding = db.outstandingReservedWei(projectId, now());
    const eff = effective(onchain, outstanding);
    const [targets, params] = await Promise.all([chain.getProjectTargets(projectId).catch(() => null), chain.getContractParams().catch(() => null)]);
    const dayAgo = now() - DAY_S * 1000;
    return {
      projectId,
      appId: row?.appId ?? null,
      indexed: row !== null,
      owner: onchain.owner,
      onchain: {
        balance: onchain.balance,
        spendable: eff.spendable,
        outstandingApprovals: outstanding,
        paused: onchain.paused,
        dailyLimit: onchain.dailyLimit,
        senderDailyLimit: onchain.senderDailyLimit,
        spentToday: eff.spentToday,
        dailyRemaining: eff.dailyRemaining,
      },
      adminChangeDelaySeconds: params?.adminChangeDelaySeconds ?? null,
      allowlist: targets,
      offchain: row ? offchainView(row) : null,
      usage24h: row
        ? (() => {
            const s = db.projectSpendSince(row.key, dayAgo);
            return { ops: s.ops, projectFundedWei: s.project, freeTierFundedWei: s.free };
          })()
        : null,
      contract: { address: config.paymasterAddress, chainId: config.chainId },
    };
  }

  async function freePoolView() {
    const [s, cfg] = await Promise.all([chain.getSponsor(FREE_POOL_ID), chain.getFreeConfig()]);
    const outstanding = db.outstandingReservedWei(FREE_POOL_ID, now());
    const spendable = s.balance > outstanding ? s.balance - outstanding : 0n;
    const f = config.freeTier;
    return {
      enabled: f.enabled && cfg.enabled,
      eligibility: "verified Privy account only (send a Privy access token); there is no anonymous tier",
      pool: { balance: s.balance, spendable, maxOpCost: cfg.maxOpCost, senderDailyLimit: cfg.senderDailyLimit, chainWideDailyCeiling: null },
      perUser: { dailyWei: f.perUserDailyWei, hourlyWei: f.perUserHourlyWei, dailyOps: f.perUserDailyCount, hourlyOps: f.perUserHourlyCount, windowSeconds: DAY_S },
      spentTodayWei: db.freeSpendTodayWei(now()),
    };
  }

  /* -------------------------------- routes -------------------------------- */

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const path = url.pathname;
    const method = req.method ?? "GET";
    let m: RegExpExecArray | null;

    // ---- ERC-7677 + sponsor (token-authenticated) ----
    if ((m = /^\/v2\/paymaster\/([^/]+)$/.exec(path))) {
      const origins = config.paymasterRpcAllowedOrigins;
      const origin = header(req, "origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (origins && origins.length > 0) {
        res.setHeader("Vary", "Origin");
        if (origin && origins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
      } else res.setHeader("Access-Control-Allow-Origin", "*");
      if (method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (method !== "POST") return send(res, 405, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "only POST/OPTIONS" } });
      if (origins && origins.length > 0 && (!origin || !origins.includes(origin))) {
        return send(res, 403, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Origin not allowed." } });
      }
      const token = decodeURIComponent(m[1] ?? "");
      // A token that resolves to no credential is limited per IP only (review 3, M-3): keying on the token would give
      // every junk token a fresh bucket, and would let a flood fill the limiter table.
      const known = db.resolveCredential(token) !== null;
      const d = known ? limiters.rpc.check(`rpc:${sha(token).toString("hex").slice(0, 16)}:${ip(req)}`) : limiters.rpcUnknown.check(`rpc-unknown:${ip(req)}`);
      if (!d.ok) return send(res, 200, { jsonrpc: "2.0", id: null, error: { code: -32005, message: "rate limited", data: { retryAfterSeconds: d.retryAfterSeconds } } });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      return send(res, 200, await handleV2RpcBody(body, rpcConfig, token, origin, ip(req)));
    }

    cors(req, res);
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "POST" && path === "/v2/sponsor") {
      // Per-IP limit BEFORE the body is read or any credential lookup happens (review 3, M-3).
      throttle(limiters.sponsor, `sponsor:${ip(req)}`);
      let parsed;
      try {
        parsed = parseSponsorRequestBody(await readJson(req));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "malformed_request", e instanceof ZodError ? e.message : "malformed request");
      }
      const bearer = /^Bearer\s+(.+)$/i.exec(header(req, "authorization") ?? "")?.[1]?.trim() ?? null;
      const r = await deps.engine.evaluate({ appToken: header(req, "x-api-key"), origin: header(req, "origin"), clientIp: ip(req), privyToken: bearer, userOp: parsed.userOp });
      return send(res, r.status === "approved" ? 200 : statusForSponsorshipReason(r.reason), r);
    }

    // ---- public ----
    if (method === "GET" && ["/v2/config", "/v2/contract", "/v2/free-tier", "/v2/auth/nonce"].includes(path)) {
      throttle(path === "/v2/auth/nonce" ? limiters.auth : limiters.pub, `${path === "/v2/auth/nonce" ? "auth" : "pub"}:${ip(req)}`);
      if (path === "/v2/auth/nonce") return send(res, 200, deps.siwe.issueNonce());
      if (path === "/v2/contract") {
        return send(res, 200, { address: config.paymasterAddress, chainId: config.chainId, entryPoint: config.entryPointAddress, abi: PEPU_SPONSORED_PAYMASTER_ABI });
      }
      if (path === "/v2/free-tier") {
        try {
          return send(res, 200, await freePoolView());
        } catch {
          throw new HttpError(503, "chain_read_failed", "could not read on-chain state");
        }
      }
      const params = await chain.getContractParams().catch(() => null);
      return send(res, 200, {
        chainId: config.chainId,
        paymaster: config.paymasterAddress,
        entryPoint: config.entryPointAddress,
        adminChangeDelaySeconds: params?.adminChangeDelaySeconds ?? null,
        deposits: "one-way: anyone may deposit into any project (claimed or not) or the free pool; nobody can withdraw",
        ownership: "claim a project with a signer attestation (POST /v2/projects/verify, then prepare claimProject); the first claim of a project that holds funds, and every re-claim of an owned project, is timelocked on-chain",
        postOpOverheadGas: params?.postOpOverheadGas ?? null,
        maxPostOpOverheadGas: params?.maxPostOpOverheadGas ?? null,
        owner: params?.owner ?? null,
        manager: params?.manager ?? null,
        freeTier: "verified Privy account only; no chain-wide ceiling",
        siweDomains: config.siwe.domains,
        sessionTtlSeconds: config.siwe.sessionTtlSeconds,
        paymasterRpcPath: "/v2/paymaster/{token}",
        projectDefaults: { perUserDailyWei: config.project.defaultPerUserDailyWei, perUserDailyMaxWei: config.project.maxPerUserDailyWei },
      });
    }

    if (method === "POST" && path === "/v2/auth/login") {
      throttle(limiters.auth, `auth:${ip(req)}`);
      const body = z.object({ message: z.string(), signature: z.string() }).safeParse(await readJson(req));
      if (!body.success) throw new HttpError(400, "malformed_request", "expected { message, signature }");
      const r = await deps.siwe.login(body.data.message, body.data.signature as Hex);
      if (!r.ok) throw new HttpError(401, "login_failed", `SIWE login rejected: ${r.reason}`, { reason: r.reason });
      return send(res, 200, { token: r.token, address: r.address, expiresAt: new Date(r.expiresAtMs).toISOString() });
    }
    if (method === "POST" && path === "/v2/auth/logout") {
      const s = session(req);
      db.deleteSession(s.token);
      return send(res, 200, { status: "ok" });
    }
    if (method === "GET" && path === "/v2/me") {
      const s = session(req);
      return send(res, 200, { address: s.address });
    }

    // ---- ownership verification (Privy app secret -> signed claim attestation) ----
    if (method === "POST" && path === "/v2/projects/verify") {
      throttle(limiters.verifyIp, `verify:${ip(req)}`);
      const s = session(req);
      if (!deps.privySecretVerifier || !deps.signerAccount) throw new HttpError(501, "not_configured", "project verification is not configured on this deployment");
      // NOTE: error messages on this route are fixed strings: the body holds the Privy app secret, which must never be echoed.
      const body = z
        .object({ appId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), appSecret: z.string().min(1).max(512), ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })
        .strict()
        .safeParse(await readJson(req));
      if (!body.success) throw new HttpError(400, "malformed_request", "expected { appId, appSecret, ownerAddress }");
      const { appId, appSecret } = body.data;
      const ownerAddress = getAddress(body.data.ownerAddress);
      if (ownerAddress !== s.address) throw new HttpError(403, "owner_mismatch", "ownerAddress must be the signed-in (SIWE) address");
      // Brute-force protection WITHOUT letting a stranger spend the owner's budget (delta review L1): the budget is keyed
      // on (appId, SIWE address) and charged only for FAILED verifications. The per-IP limiter above still bounds how
      // fast any one client can guess. App ids are used exactly as given (case-sensitive; Privy ids are lower-case cuids).
      const failKey = `verify-app:${appId}:${s.address.toLowerCase()}`;
      const budget = limiters.verifyApp.peek(failKey);
      if (!budget.ok) throw new HttpError(429, "rate_limited", "too many failed verifications for this app from this account", { retryAfterSeconds: budget.retryAfterSeconds });
      let verdict: "valid" | "invalid";
      try {
        verdict = await deps.privySecretVerifier.verify(appId, appSecret);
      } catch {
        throw new HttpError(502, "privy_unavailable", "could not verify the credentials with Privy; try again later");
      }
      if (verdict !== "valid") {
        limiters.verifyApp.check(failKey);
        throw new HttpError(403, "invalid_privy_credentials", "Privy did not accept that app id and secret");
      }
      const projectId = projectIdOf(appId);
      const onchain = await onchainOrThrow(projectId);
      if (onchain.owner.toLowerCase() === ownerAddress.toLowerCase()) throw new HttpError(409, "already_owner", "this wallet already owns the project", { projectId });
      const attestation = await signClaimAttestation({
        signer: deps.signerAccount,
        chainId: config.chainId,
        paymaster: config.paymasterAddress,
        appId,
        newOwner: ownerAddress,
        deadlineSeconds: Math.floor(now() / 1000) + config.claimAttestationTtlSeconds,
      });
      const reclaim = onchain.owner !== ZERO;
      const pendingFirstClaim = !reclaim && onchain.balance > 0n;
      return send(res, 200, {
        projectId,
        appId,
        ownerAddress,
        action: reclaim ? "reclaimProject" : "claimProject",
        takesEffect: reclaim || pendingFirstClaim ? "after_admin_change_delay" : "immediately",
        attestation,
        expiresAt: new Date(Number(attestation.deadline) * 1000).toISOString(),
        note: reclaim
          ? "This project already has an owner. A re-claim takes effect only after the on-chain admin change delay (at least 48h), is announced by an event, and the current owner can cancel it. Submit it with POST /v2/projects/prepare {action:\"reclaimProject\", attestation}."
          : `Submit it with POST /v2/projects/prepare {action:"claimProject", attestation}. ${pendingFirstClaim ? "This project already holds deposited funds, so the claim is PENDING for the on-chain admin change delay (at least 48h): it is announced by a ProjectClaimProposed event, the contract owner or manager can cancel it, and you (or anyone) finish it with executeReclaim after the delay (prepare {action:\"executeReclaim\"}). " : "An empty project is claimed immediately. "}The claim sets no configuration: once you own the project, set your allowlist and limits (prepare setTargets, setDailyLimit, setSenderDailyLimit); nothing is sponsorable until you do. The attestation is single-use and expires within the hour. Your app secret was not stored or logged; you may rotate it in the Privy dashboard now if you wish.`,
      });
    }

    // ---- owner: projects ----
    if (method === "POST" && path === "/v2/projects/prepare") {
      const s = session(req);
      const parsed = prepareRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, "malformed_request", parsed.error.message);
      const r = parsed.data;
      if (actionNeedsOwner(r.action) && "projectId" in r) await ownerGate(req, r.projectId);
      return send(res, 200, prepareTransaction(r, { paymaster: config.paymasterAddress, chainId: config.chainId, sessionAddress: s.address }));
    }

    if (method === "POST" && path === "/v2/projects") {
      // Convenience layer ONLY: deposits are plain on-chain calls anyone can make with no API, and there are no
      // withdrawals. This endpoint indexes an already-CLAIMED project for its owner and issues the sponsorship credentials
      // (client token + server key) the policy service needs in order to sign. Identify the project either by
      // `projectId`, or by `appId` (the id is keccak256(appId)).
      const s = session(req);
      const body = z
        .object({
          projectId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
          appId: z.string().min(1).max(128).optional(),
          perUserDailyCapWei: z.string().regex(/^[0-9]+$/).optional(),
          requireIdentity: z.boolean().optional(),
          allowedOrigins: z.array(z.string().max(200)).max(20).optional(),
        })
        .refine((b) => b.projectId !== undefined || b.appId !== undefined, "provide projectId or appId")
        .safeParse(await readJson(req));
      if (!body.success) throw new HttpError(400, "malformed_request", body.error.message);
      const projectId = body.data.projectId ? parseProjectId(body.data.projectId) : projectIdOf(body.data.appId as string);
      const onchain = await onchainOrThrow(projectId);
      if (onchain.owner === ZERO) throw new HttpError(409, "not_claimed_onchain", "claim the project on-chain first (POST /v2/projects/verify, then prepare {action:\"claimProject\"}); a claim of a project that already holds funds is pending for the admin change delay, then needs executeReclaim");
      if (onchain.owner.toLowerCase() !== s.address.toLowerCase()) throw new HttpError(403, "not_project_owner", "the signed-in address is not this project's on-chain owner");
      if (db.getByProjectId(projectId)) throw new HttpError(409, "already_indexed", "project already indexed; rotate its credentials instead");
      const cap = body.data.perUserDailyCapWei ? BigInt(body.data.perUserDailyCapWei) : config.project.defaultPerUserDailyWei;
      if (cap > config.project.maxPerUserDailyWei) throw new HttpError(400, "cap_too_high", `perUserDailyCapWei exceeds the maximum ${config.project.maxPerUserDailyWei}`);
      // The app id comes from the chain (the claim event). A request-supplied appId is used only if it hashes to this
      // projectId (review 3, C-L1): otherwise a project could be indexed under someone else's Privy app id, which
      // is what identity verification and the free tier key on.
      const bodyAppId = body.data.appId !== undefined && projectIdOf(body.data.appId) === projectId ? body.data.appId : null;
      if (body.data.appId !== undefined && bodyAppId === null && body.data.projectId !== undefined) {
        throw new HttpError(400, "app_id_mismatch", "appId does not hash to projectId (projectId = keccak256(appId))");
      }
      const appId = (await chain.getProjectAppId(projectId).catch(() => null)) ?? bodyAppId ?? projectId;
      const origins = parseOrigins(body.data.allowedOrigins ?? []);
      const { project, token, serverKey } = db.createOnchainProject({
        projectId,
        appId,
        owner: onchain.owner,
        perUserDailyCapWei: cap,
        // A project may sponsor ANY wallet; requiring a verified Privy identity is an opt-in tightening.
        requireIdentity: body.data.requireIdentity ?? false,
        allowedOrigins: origins,
        nowMs: now(),
      });
      return send(res, 201, {
        projectId,
        appId: project.appId,
        serverKey,
        token,
        paymasterUrl: paymasterUrl(token),
        note: "serverKey is a SECRET for your backend (works for any wallet, no origin restriction); token/paymasterUrl is publishable and only spends your budget from allowedOrigins. Both are shown once; rotate to get new ones.",
        offchain: offchainView(project),
      });
    }

    if (method === "GET" && path === "/v2/projects") {
      const s = session(req);
      const rows = db.listByOwner(s.address);
      const out = [];
      for (const r of rows) {
        if (!r.projectId) continue;
        const o = await chain.getSponsor(r.projectId).catch(() => null);
        const stillOwner = o !== null && o.owner.toLowerCase() === s.address.toLowerCase();
        out.push({ projectId: r.projectId, appId: r.appId, stillOwner, balance: o?.balance ?? null, paused: o?.paused ?? null, offchain: offchainView(r) });
      }
      const onchainAll = await chain.getProjectsOwnedBy(s.address).catch(() => []);
      const indexed = new Set(rows.map((r) => r.projectId?.toLowerCase()));
      const unindexed = onchainAll.filter((p) => !indexed.has(p.projectId.toLowerCase()));
      return send(res, 200, { projects: out, onchainUnindexed: unindexed });
    }

    if ((m = /^\/v2\/projects\/(0x[0-9a-fA-F]+)(?:\/(token\/rotate|server-key\/rotate|settings|usage|events|allowlist))?$/.exec(path))) {
      const sub = m[2];
      const g = await ownerGate(req, m[1] as string);
      const row = db.getByProjectId(g.projectId);
      if (!sub && method === "GET") return send(res, 200, await projectDetail(g.projectId, g.onchain));
      if (sub === "allowlist" && method === "GET") {
        return send(res, 200, { projectId: g.projectId, source: "chain", targets: await chain.getProjectTargets(g.projectId), manage: "POST /v2/projects/prepare {action:\"setTargets\"}" });
      }
      if (sub === "events" && method === "GET") {
        const from = url.searchParams.get("fromBlock");
        const events = await chain.getSponsorEvents(g.projectId, from && /^[0-9]+$/.test(from) ? BigInt(from) : undefined).catch(() => {
          throw new HttpError(503, "chain_read_failed", "could not read events");
        });
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200) || 200, 1), 1000);
        return send(res, 200, { projectId: g.projectId, events: events.slice(-limit) });
      }
      if (!row) throw new HttpError(409, "not_indexed", "project is claimed on-chain but not indexed here; POST /v2/projects first");
      if (sub === "token/rotate" && method === "POST") {
        const token = db.rotateToken(row.key, now()) as string;
        db.appendAdminAudit(g.address, "owner_token_rotate", row.key, null, now());
        return send(res, 200, { token, paymasterUrl: paymasterUrl(token), note: "the previous token no longer works" });
      }
      if (sub === "server-key/rotate" && method === "POST") {
        const serverKey = db.rotateServerKey(row.key, now()) as string;
        db.appendAdminAudit(g.address, "owner_server_key_rotate", row.key, null, now());
        return send(res, 200, { serverKey, note: "the previous server key no longer works; store the new one in your backend only" });
      }
      if (sub === "settings" && method === "PATCH") {
        const body = z
          .object({ perUserDailyCapWei: z.string().regex(/^[0-9]+$/).optional(), requireIdentity: z.boolean().optional(), allowedOrigins: z.array(z.string().max(200)).max(20).optional() })
          .safeParse(await readJson(req));
        if (!body.success) throw new HttpError(400, "malformed_request", body.error.message);
        const cap = body.data.perUserDailyCapWei ? BigInt(body.data.perUserDailyCapWei) : undefined;
        if (cap !== undefined && (cap === 0n || cap > config.project.maxPerUserDailyWei)) throw new HttpError(400, "cap_out_of_range", `perUserDailyCapWei must be in (0, ${config.project.maxPerUserDailyWei}]`);
        db.updateSettings(row.key, { ...(cap !== undefined ? { perUserDailyCapWei: cap } : {}), ...(body.data.requireIdentity !== undefined ? { requireIdentity: body.data.requireIdentity } : {}), ...(body.data.allowedOrigins !== undefined ? { allowedOrigins: parseOrigins(body.data.allowedOrigins) } : {}) }, now());
        return send(res, 200, offchainView(db.getByKey(row.key) as ProjectRecord));
      }
      if (sub === "usage" && method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 500);
        const before = url.searchParams.get("before");
        const rows = db.listUsage(row.key, limit, before && /^[0-9]+$/.test(before) ? Number(before) : undefined);
        const s24 = db.projectSpendSince(row.key, now() - DAY_S * 1000);
        return send(res, 200, {
          projectId: g.projectId,
          last24h: { ops: s24.ops, projectFundedWei: s24.project, freeTierFundedWei: s24.free },
          rows: rows.map((r) => ({ id: r.id, time: new Date(r.tsMs).toISOString(), sponsor: r.sponsor === "free" ? "free" : "project", identity: r.identityKey, sender: r.sender, reservedWei: r.reservedWei, chargedWei: r.finalWei, status: r.status, userOpHash: r.epHash, settledTx: r.settledTx })),
          nextBefore: rows.length === limit ? (rows[rows.length - 1] as { id: number }).id : null,
        });
      }
    }

    // ---- admin ----
    if (path.startsWith("/v2/admin/")) {
      const actor = admin(req);
      if (method === "GET" && path === "/v2/admin/overview") {
        const [free, params] = await Promise.all([freePoolView().catch(() => null), chain.getContractParams().catch(() => null)]);
        return send(res, 200, { freeTier: free, contract: params, usage: db.usageCounts(), reconciler: deps.reconciler.status(), projects: db.listAllProjects().length, recentAdminActions: db.listAdminAudit(20), unauthenticated: deps.engine.stats() });
      }
      if (method === "GET" && path === "/v2/admin/projects") return send(res, 200, { projects: db.listAllProjects().map((p) => ({ projectId: p.projectId, appId: p.appId, owner: p.owner, ...offchainView(p) })) });
      if (method === "POST" && path === "/v2/admin/apps") {
        const body = z.object({ label: z.string().min(1).max(64), perUserDailyCapWei: z.string().regex(/^[0-9]+$/).optional(), allowedDestinations: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(100).optional() }).safeParse(await readJson(req));
        if (!body.success) throw new HttpError(400, "malformed_request", body.error.message);
        try {
          const { project, token } = db.createFreeApp({ label: body.data.label, perUserDailyCapWei: body.data.perUserDailyCapWei ? BigInt(body.data.perUserDailyCapWei) : config.project.defaultPerUserDailyWei, allowedDestinations: (body.data.allowedDestinations as Address[] | undefined) ?? null, nowMs: now() });
          db.appendAdminAudit(actor, "create_free_app", project.key, null, now());
          return send(res, 201, { key: project.key, token, paymasterUrl: paymasterUrl(token) });
        } catch (e) {
          if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new HttpError(409, "exists", "an app with that label already exists");
          throw e;
        }
      }
      if (method === "POST" && path === "/v2/admin/reconcile") {
        const r = await deps.reconciler.runOnce().catch(() => {
          throw new HttpError(503, "chain_read_failed", "reconcile failed");
        });
        return send(res, 200, r ?? { status: "already_running" });
      }
      if ((m = /^\/v2\/admin\/projects\/([^/]+)\/(status|token\/rotate|server-key\/rotate)$/.exec(path)) && method === "POST") {
        const key = decodeURIComponent(m[1] as string).toLowerCase();
        const row = db.getByKey(key);
        if (!row) throw new HttpError(404, "project_not_found", "no such project key");
        if (m[2] === "status") {
          const body = z.object({ status: z.enum(["active", "suspended"]) }).safeParse(await readJson(req));
          if (!body.success) throw new HttpError(400, "malformed_request", body.error.message);
          db.setStatus(key, body.data.status, now());
          db.appendAdminAudit(actor, `set_status:${body.data.status}`, key, null, now());
          return send(res, 200, { key, status: body.data.status });
        }
        if (m[2] === "server-key/rotate") {
          const serverKey = db.rotateServerKey(key, now());
          if (!serverKey) throw new HttpError(400, "no_server_key", "only on-chain projects have a server key");
          db.appendAdminAudit(actor, "admin_server_key_rotate", key, null, now());
          return send(res, 200, { key, serverKey });
        }
        const token = db.rotateToken(key, now()) as string;
        db.appendAdminAudit(actor, "admin_token_rotate", key, null, now());
        return send(res, 200, { key, token, paymasterUrl: paymasterUrl(token) });
      }
    }

    throw new HttpError(404, "not_found", "Not found.");
  }

  return {
    async handle(req, res) {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://localhost");
      } catch {
        return false;
      }
      if (!url.pathname.startsWith("/v2/")) return false;
      try {
        await route(req, res, url);
      } catch (error) {
        if (error instanceof HttpError) {
          if (error.status === 429 && typeof error.extra?.retryAfterSeconds === "number") res.setHeader("Retry-After", String(error.extra.retryAfterSeconds));
          cors(req, res);
          send(res, error.status, { error: error.code, message: error.message, ...(error.extra ?? {}) });
        } else {
          console.error("[sponsorship-api] unhandled error:", (error as Error).message);
          send(res, 500, { error: "internal_error", message: "Internal error." });
        }
      }
      return true;
    },
  };
}

