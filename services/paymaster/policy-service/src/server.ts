/**
 * Minimal `node:http`-based HTTP layer. Deliberately no framework — this is
 * "a small TypeScript HTTP service" per the brief, not a showcase for one.
 *
 * Endpoints:
 *   POST /sponsor                        -> evaluate a sponsorship request
 *   POST /admin/circuit-breaker/reset    -> admin-only: clear the global breaker
 *   GET  /health                         -> liveness probe (cheap, no dependencies)
 *   GET  /ready                          -> readiness: DB + chain RPC + paymaster deposit (503 when not ready)
 *   POST /paymaster/:appToken            -> ERC-7677 paymaster JSON-RPC (see paymasterRpc.ts)
 *   OPTIONS /paymaster/:appToken         -> CORS preflight for the above (browser-called, see paymasterRpcAuth.ts)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import type { PolicyEngine } from "./policy.js";
import type { PolicyDb } from "./db.js";
import { parseSponsorRequestBody } from "./requestSchema.js";
import { handlePaymasterRpcBody, type PaymasterRpcConfig } from "./paymasterRpc.js";
import type { SponsorshipV2 } from "./sponsorship/api.js";
import type { ReadinessReport } from "./ready.js";
import { safeEqual } from "./safeEqual.js";

const MAX_BODY_BYTES = 256 * 1024; // 256 KiB is generous for a UserOp; guards against abuse.

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function headerValue(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The reason string returned to the client is intentionally specific (it
 * comes straight from `PolicyEngine`'s typed `DenialReason`) — this service
 * has no bot-detection heuristics to protect by being vague, and precise
 * reasons are what make the audit trail (and this API) actually debuggable.
 * The one thing that must NEVER leak into a response body is the signer
 * private key, which never enters this module at all (see policy.ts /
 * userOpHash.ts — only the resulting signature bytes ever return).
 */
function statusForDenialReason(reason: string): number {
  switch (reason) {
    case "invalid_or_expired_token":
      return 401;
    case "unknown_or_invalid_app_credential":
      return 401;
    case "sender_not_owned_by_token_user":
    case "destination_not_globally_allowed":
    case "destination_not_allowed_for_app":
      return 403;
    case "calldata_decode_failed":
    case "malformed_request":
      return 400;
    case "global_circuit_breaker_tripped":
      return 503;
    default:
      // every *_cap_exceeded reason
      return 429;
  }
}

export interface CreateServerDeps {
  policy: PolicyEngine;
  db: PolicyDb;
  adminToken: string | null;
  /**
   * The ERC-7677 paymaster JSON-RPC surface (see paymasterRpc.ts). `null`
   * disables the `/paymaster/:appToken` route entirely (e.g. in tests that
   * only exercise `/sponsor`). `config.policy` here is deliberately a
   * DIFFERENT `PolicyEngine` instance than the top-level `policy` field
   * above — see index.ts / paymasterRpcAuth.ts for why (no Privy access
   * token is available on this path).
   */
  paymasterRpc:
    | (PaymasterRpcConfig & {
        allowedOrigins: readonly string[] | null;
        /** Accept requests with no Origin header even when allowedOrigins is set (server-side callers). Default false. */
        allowMissingOrigin?: boolean;
      })
    | null;
  /** Backs GET /ready. When omitted, /ready only checks the database. */
  ready?: () => Promise<ReadinessReport>;
  /** Tiered-sponsorship (v2) API under /v2/*. Undefined unless SPONSORSHIP_V2_ENABLED=true: then no /v2 route exists and v1 is unchanged. */
  sponsorshipV2?: SponsorshipV2;
}

/**
 * CORS is required here, not optional: Privy's smart-wallet SDK calls a
 * dashboard-configured paymaster URL directly from the END USER'S browser
 * (see paymasterRpcAuth.ts's doc comment for the verification trail), so
 * without an `Access-Control-Allow-Origin` response header the browser
 * itself blocks the caller from ever reading the response — independent of
 * whether this service is willing to answer.
 *
 * IMPORTANT: this is a browser-enforced READER-side restriction, not an
 * authentication mechanism — it stops a page running JS from reading a
 * cross-origin response in a browser, it does nothing to stop a direct HTTP
 * client (curl, a script, a bot) from calling this endpoint regardless of
 * what `Access-Control-Allow-Origin` says. Real request-level protection is
 * the per-app URL token (the `:appToken` path segment) plus the policy
 * engine's own caps/allowlist/circuit-breaker — see paymasterRpcAuth.ts.
 *
 * Defaults to `Access-Control-Allow-Origin: *` (open) when
 * `allowedOrigins` is unset, because until the operator sets the exact
 * frontend domain(s), an unnecessarily-restrictive default would just make
 * the endpoint silently fail from the one browser context (Privy's own
 * dashboard-driven call) it exists to serve. See README/.env.example for
 * how to narrow this once the production frontend origin(s) are known.
 */
function applyPaymasterCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: readonly string[] | null,
): void {
  const origin = headerValue(req, "origin");
  if (allowedOrigins && allowedOrigins.length > 0) {
    res.setHeader("Vary", "Origin");
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    // else: no ACAO header at all -> browser blocks the read. No JSON-RPC
    // error is written for the disallowed-origin case here; the actual
    // POST handler below performs the real (non-CORS) origin check and
    // returns a proper JSON-RPC error body for same.
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function dbOnlyReadiness(db: PolicyDb): Promise<ReadinessReport> {
  let ok = true;
  let detail: string | undefined;
  try {
    db.ping();
  } catch (error) {
    ok = false;
    detail = (error as Error).message;
  }
  return {
    status: ok ? "ready" : "not_ready",
    checks: {
      db: { ok, ...(detail ? { detail } : {}) },
      rpc: { ok: true, detail: "skipped: readiness checker not configured" },
      deposit: { ok: true, detail: "skipped: readiness checker not configured" },
    },
    warnings: ["readiness checker not configured: RPC and deposit are not checked"],
  };
}

export function createPolicyHttpServer(deps: CreateServerDeps) {
  return createServer(async (req, res) => {
    try {
      // Only origin-form request targets ("/path?query") are served. new URL() would treat "//host/path" as a
      // protocol-relative URL and silently re-route it (e.g. "//x/admin/..." -> "/admin/..."), so refuse it outright.
      const rawTarget = req.url ?? "/";
      if (!rawTarget.startsWith("/") || rawTarget.startsWith("//")) {
        sendJson(res, 404, { status: "denied", message: "Not found." });
        return;
      }
      const url = new URL(rawTarget, "http://localhost");

      if (deps.sponsorshipV2 && url.pathname.startsWith("/v2/") && (await deps.sponsorshipV2.handle(req, res))) return;

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/ready") {
        let report: ReadinessReport;
        try {
          report = deps.ready ? await deps.ready() : await dbOnlyReadiness(deps.db);
        } catch (error) {
          // Never echo internals; the monitor only needs "not ready".
          console.error("[policy-service] readiness check threw:", (error as Error).message);
          sendJson(res, 503, { status: "not_ready", message: "Readiness check failed." });
          return;
        }
        sendJson(res, report.status === "ready" ? 200 : 503, report);
        return;
      }

      if (req.method === "POST" && url.pathname === "/sponsor") {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, {
            status: "denied",
            reason: "malformed_request",
            message: `Could not read request body: ${(error as Error).message}`,
          });
          return;
        }

        let parsed;
        try {
          parsed = parseSponsorRequestBody(body);
        } catch (error) {
          const message = error instanceof ZodError ? error.message : String(error);
          sendJson(res, 400, { status: "denied", reason: "malformed_request", message });
          return;
        }

        const accessToken = bearerToken(req);
        const apiKey = headerValue(req, "x-api-key");
        const result = await deps.policy.evaluate(accessToken, apiKey, parsed.userOp);
        const status = result.status === "approved" ? 200 : statusForDenialReason(result.reason);
        sendJson(res, status, result);
        return;
      }

      const paymasterRpcMatch = /^\/paymaster\/([^/]+)$/.exec(url.pathname);
      if (paymasterRpcMatch && deps.paymasterRpc) {
        const { allowedOrigins, allowMissingOrigin, ...rpcConfig } = deps.paymasterRpc;

        if (req.method === "OPTIONS") {
          applyPaymasterCorsHeaders(req, res, allowedOrigins);
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.method !== "POST") {
          applyPaymasterCorsHeaders(req, res, allowedOrigins);
          sendJson(res, 405, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid Request: only POST (and OPTIONS preflight) is supported." },
          });
          return;
        }

        applyPaymasterCorsHeaders(req, res, allowedOrigins);

        // Real (non-CORS) origin enforcement: unlike the CORS header above
        // (which only governs whether a BROWSER lets its own page read the
        // response), this actually refuses to evaluate the request at all
        // when an Origin header is present and not on the allowlist. See
        // paymasterRpcAuth.ts for why this is a supplementary speed bump,
        // not primary auth (a non-browser client can send any Origin it
        // likes, or omit it).
        if (allowedOrigins && allowedOrigins.length > 0) {
          const origin = headerValue(req, "origin");
          const missingButAllowed = !origin && allowMissingOrigin === true;
          if (!missingButAllowed && (!origin || !allowedOrigins.includes(origin))) {
            sendJson(res, 403, {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32001,
                message:
                  "Origin not allowed. Set PAYMASTER_RPC_ALLOWED_ORIGINS to include this request's Origin header if it is expected to call this endpoint.",
              },
            });
            return;
          }
        }

        const appToken = decodeURIComponent(paymasterRpcMatch[1] ?? "");

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: `Parse error: ${(error as Error).message}` },
          });
          return;
        }

        const rpcResponse = await handlePaymasterRpcBody(body, rpcConfig, { apiKey: appToken });
        // Per common JSON-RPC-over-HTTP convention, the HTTP status is 200
        // for any well-formed JSON-RPC response, whether it carries
        // `result` or `error` — the error, including "sponsorship denied",
        // lives inside the JSON body, not the HTTP status line.
        sendJson(res, 200, rpcResponse);
        return;
      }

      if (req.method === "POST" && url.pathname === "/admin/circuit-breaker/reset") {
        const provided = headerValue(req, "x-admin-token");
        if (!deps.adminToken || !provided || !safeEqual(provided, deps.adminToken)) {
          sendJson(res, 401, { status: "denied", message: "Missing or invalid X-Admin-Token." });
          return;
        }
        deps.db.manuallyResetCircuitBreaker(Date.now());
        sendJson(res, 200, { status: "ok", message: "Global circuit breaker manually reset." });
        return;
      }

      sendJson(res, 404, { status: "denied", message: "Not found." });
    } catch (error) {
      // Never let an unexpected error surface anything sensitive. In
      // particular this can never contain the signer private key: it never
      // exists as a JS value outside `signerAccount` (a viem LocalAccount),
      // and that object is never touched by this catch block or logged.
      // eslint-disable-next-line no-console
      console.error("[policy-service] unhandled request error:", (error as Error).message);
      sendJson(res, 500, { status: "denied", message: "Internal error." });
    }
  });
}
