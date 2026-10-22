import { encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";
import {
  PEPU_ERROR_CATALOG,
  PepuAuthError,
  PepuBundlerError,
  PepuChainError,
  PepuConfigError,
  PepuError,
  PepuPaymasterError,
  PepuPolicyError,
  PepuSessionError,
  explainError,
  getErrorEntry,
  toErrorBody,
  toErrorResponse,
  toPepuError,
} from "../src/errors.js";
import type { PepuErrorCode } from "../src/errors.js";

describe("PepuError", () => {
  it("carries code, hint, docsUrl, retryable, status and cause", () => {
    const cause = new Error("boom");
    const e = new PepuConfigError("CONFIG_MISSING_ENV", "Missing required env: PRIVY_APP_SECRET", { cause });
    expect(e).toBeInstanceOf(PepuError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PepuConfigError");
    expect(e.code).toBe("CONFIG_MISSING_ENV");
    expect(e.hint.length).toBeGreaterThan(0);
    expect(e.docsUrl).toBe("https://docs.pepeunchained.com/reference/errors#CONFIG_MISSING_ENV");
    expect(e.status).toBe(500);
    expect(e.retryable).toBe(false);
    expect(e.cause).toBe(cause);
  });

  it("allows per-instance overrides", () => {
    const e = new PepuError("UNKNOWN", "x", {
      hint: "h",
      docsUrl: "https://x.test",
      retryable: true,
      status: 418,
      details: { a: 1 },
    });
    expect([e.hint, e.docsUrl, e.retryable, e.status, e.details]).toEqual([
      "h",
      "https://x.test",
      true,
      418,
      { a: 1 },
    ]);
  });
});

describe("PEPU_ERROR_CATALOG", () => {
  it("has exactly one entry per code, with an UNKNOWN fallback", () => {
    const codes = PEPU_ERROR_CATALOG.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(getErrorEntry("UNKNOWN").code).toBe("UNKNOWN");
    for (const e of PEPU_ERROR_CATALOG) {
      expect(Boolean(e.title && e.cause && e.fix), e.code).toBe(true);
    }
  });
});

// Messages follow the real captured wording (or its documented form).
const FIXTURES: ReadonlyArray<readonly [string, PepuErrorCode]> = [
  ["HTTP 401: No valid authorization keys or user signing keys available", "PRIVY_KEY_QUORUM_MISMATCH"],
  ["Invalid request: name must be fewer than 50 characters", "POLICY_NAME_TOO_LONG"],
  ["Coinbase Wallet SDK: unsupported chain 97741", "WALLET_COINBASE_UNSUPPORTED_CHAIN"],
  ["eth_sendTransaction failed: caip2 eip155:97741 is not supported", "PRIVY_CHAIN_REJECTED_97741"],
  ["denied: unknown_or_invalid_app_credential", "PAYMASTER_DENIED"],
  ["denied: sender_not_owned_by_token_user", "PAYMASTER_DENIED"],
  ["denied: origin_not_allowed", "PAYMASTER_ORIGIN_NOT_ALLOWED"],
  ["denied: destination_not_allowed", "PAYMASTER_DESTINATION_NOT_ALLOWED"],
  ["denied: project no_balance", "PAYMASTER_NO_BALANCE"],
  ["denied: daily cap exceeded", "PAYMASTER_CAP"],
  ["UserOperation reverted during simulation with reason: AA23 reverted", "BUNDLER_AA_FAILED"],
  ["TypeError: fetch failed", "BUNDLER_UNREACHABLE"],
  ["nonce too low: next nonce 5, tx nonce 4", "TX_NONCE_RACE"],
  ["intrinsic gas too low", "TX_GAS_UNDERSHOOT"],
  ["execution reverted: ERC20: transfer amount exceeds balance", "TX_REVERTED"],
  ["Multicall3 at 0xcA11bde05977b3631167028862bE2a173976CA11 has no code", "MULTICALL3_CANONICAL_ADDRESS"],
  ["ConnectorNotConnectedError: Connector not connected", "WALLET_INJECTED_ACTIVE"],
  ["createOnLogin is off, the embedded wallet never appears", "CONFIG_PRIVY_CREATE_ON_LOGIN"],
  ["Origin http://localhost:3001 not allowed", "CONFIG_ORIGIN_MISMATCH"],
  ["Missing required env: PRIVY_APP_SECRET", "CONFIG_MISSING_ENV"],
  ["invalid auth token", "AUTH_INVALID_TOKEN"],
];

describe("explainError", () => {
  it.each(FIXTURES)("%s -> %s", (message, code) => {
    const out = explainError(new Error(message));
    expect(out.code).toBe(code);
    expect(out.matched).toBe("catalog");
    expect(out.docsUrl).toContain(`#${code}`);
    expect(explainError(message).code).toBe(code);
  });

  it("walks the cause chain and viem-style shortMessage", () => {
    const inner = Object.assign(new Error("x"), { shortMessage: "nonce too low" });
    expect(explainError(new Error("wrapper", { cause: inner })).code).toBe("TX_NONCE_RACE");
  });

  it("decodes revert data (Error(string)) via the ABI", () => {
    const data = encodeErrorResult({
      abi: [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }],
      errorName: "Error",
      args: ["AA25 invalid account nonce"],
    });
    const out = explainError(data);
    expect(out.code).toBe("BUNDLER_AA_FAILED");
    expect(out.matched).toBe("abi-decode");
  });

  it("decodes an EntryPoint FailedOp", () => {
    const data = encodeErrorResult({
      abi: [
        {
          type: "error",
          name: "FailedOp",
          inputs: [
            { name: "opIndex", type: "uint256" },
            { name: "reason", type: "string" },
          ],
        },
      ],
      errorName: "FailedOp",
      args: [0n, "AA21 did not pay prefund"],
    });
    expect(explainError(data).code).toBe("BUNDLER_AA_FAILED");
  });

  it("falls back to UNKNOWN for unmatched text and undecodable hex", () => {
    expect(explainError(new Error("something novel")).matched).toBe("unknown");
    expect(explainError("0xdeadbeef").code).toBe("UNKNOWN");
    expect(explainError(undefined).code).toBe("UNKNOWN");
    expect(explainError(42).code).toBe("UNKNOWN");
  });

  it("passes PepuErrors through by code", () => {
    expect(explainError(new PepuSessionError("SESSION_EXPIRED")).code).toBe("SESSION_EXPIRED");
  });
});

describe("toPepuError", () => {
  it("returns PepuErrors unchanged", () => {
    const e = new PepuAuthError("AUTH_INVALID_TOKEN");
    expect(toPepuError(e)).toBe(e);
  });

  it.each([
    ["Missing required env: X", PepuConfigError],
    ["invalid auth token", PepuAuthError],
    ["AA23 reverted", PepuBundlerError],
    ["denied: origin_not_allowed", PepuPaymasterError],
    ["nonce too low", PepuChainError],
    ["No valid authorization keys or user signing keys available", PepuConfigError],
  ])("wraps %j into the right subclass", (message, Cls) => {
    const out = toPepuError(new Error(message), { op: "send" });
    expect(out).toBeInstanceOf(Cls);
    expect(out.message.startsWith("send: ")).toBe(true);
  });

  it("wraps unknown values as UNKNOWN and keeps the cause", () => {
    const raw = new Error("???");
    const out = toPepuError(raw);
    expect(out.code).toBe("UNKNOWN");
    expect(out.cause).toBe(raw);
    expect(toPepuError("plain string").message).toBe("plain string");
  });

  it("policy and session codes carry their statuses", () => {
    expect(new PepuPolicyError("POLICY_UNSCOPED").status).toBe(400);
    expect(new PepuSessionError("SESSION_EXPIRED").status).toBe(410);
  });
});

describe("route error helpers", () => {
  it("toErrorBody exposes only code, message and hint", () => {
    const body = toErrorBody(new PepuAuthError("AUTH_INVALID_TOKEN", "bad token"));
    expect(body).toEqual({ error: { code: "AUTH_INVALID_TOKEN", message: "bad token", hint: expect.any(String) } });
  });

  it("toErrorResponse uses the status from the model", async () => {
    const res = toErrorResponse(new PepuAuthError("AUTH_INVALID_TOKEN"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH_INVALID_TOKEN");
    expect(toErrorResponse(new Error("nonce too low")).status).toBe(409);
  });
});
