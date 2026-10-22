/**
 * Unit tests for PolicyEngine.evaluate() -- the ordered enforcement pipeline
 * described in policy.ts's module doc comment. Covers every DenialReason
 * (types.ts) that policy.ts itself can produce: auth ordering, app
 * resolution, the two-layer destination allowlist, every per-user/per-app
 * cap, the global circuit breaker, and the validity window baked into an
 * approval. db.ts's cap/spend accounting is exercised for real (an
 * in-memory sqlite PolicyDb), not mocked -- only Privy auth is faked (see
 * privyAuth.test.ts for that module's own dedicated tests).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { PolicyEngine, type PolicyEngineDeps } from "../src/policy.js";
import { PolicyDb } from "../src/db.js";
import { AppRegistry } from "../src/appRegistry.js";
import { Allowlist } from "../src/allowlist.js";
import { sha256HexOf } from "../src/appRegistry.js";
import type { AuthChecker } from "../src/privyAuth.js";
import type { RegisteredApp, SponsorUserOperationInput } from "../src/types.js";
import { buildSingleKernelExecuteCallData } from "./helpers/kernelCallData.js";

// Anvil/Hardhat's universally-published default account #0 test key -- same
// one the Solidity test suite uses (contracts/test/PepuVerifyingPaymasterV7.t.sol).
// Never a real secret.
const TEST_SIGNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const ALLOWED_TARGET = "0x0000000000000000000000000000000000000001" as Address;
const OTHER_ALLOWED_TARGET = "0x0000000000000000000000000000000000000002" as Address;
const NOT_GLOBALLY_ALLOWED_TARGET = "0x0000000000000000000000000000000000000009" as Address;

const SENDER = "0x0000000000000000000000000000000000000042" as Address;

function fakeAuth(overrides?: Partial<AuthChecker>): AuthChecker {
  const base: AuthChecker = {
    verifyToken: async () => ({ ok: true, userId: "user-1" }),
    verifySenderOwnership: async () => true,
    authenticate: async () => ({ ok: true, userId: "user-1" }),
  };
  return { ...base, ...overrides };
}

function makeApp(overrides: Partial<RegisteredApp> & { id: string; rawApiKey: string }): RegisteredApp & {
  rawApiKey: string;
} {
  return {
    apiKeyHashHex: sha256HexOf(overrides.rawApiKey),
    allowedDestinations: "*",
    dailySpendCapWei: 10n ** 18n,
    lifetimeSpendCapWei: null,
    ...overrides,
  };
}

const APP_ALL = makeApp({ id: "app-all", rawApiKey: "app-all-key" });
const APP_SCOPED = makeApp({
  id: "app-scoped",
  rawApiKey: "app-scoped-key",
  allowedDestinations: [ALLOWED_TARGET], // deliberately excludes OTHER_ALLOWED_TARGET
});
const APP_LOW_DAILY = makeApp({
  id: "app-low-daily",
  rawApiKey: "app-low-daily-key",
  dailySpendCapWei: 1_000_000n,
});
const APP_LOW_LIFETIME = makeApp({
  id: "app-low-lifetime",
  rawApiKey: "app-low-lifetime-key",
  dailySpendCapWei: 10n ** 18n,
  lifetimeSpendCapWei: 1_000_000n,
});

let nextNonce = 0n;
function buildUserOp(overrides: Partial<SponsorUserOperationInput> = {}): SponsorUserOperationInput {
  return {
    sender: SENDER,
    nonce: nextNonce++,
    callData: buildSingleKernelExecuteCallData(ALLOWED_TARGET),
    callGasLimit: 100_000n,
    verificationGasLimit: 100_000n,
    preVerificationGas: 50_000n,
    // Deliberately tiny fee so worstCaseCostWei stays small by default;
    // individual cap tests override maxFeePerGas to control cost precisely.
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    ...overrides,
  };
}

// paymasterVerificationGasLimit(100_000) + paymasterPostOpGasLimit(50_000)
// are fixed in `deps` below, so total gas for the default buildUserOp() is
// 100_000 + 100_000 + 50_000 + 100_000 + 50_000 = 400_000 gas units. Cost
// tests pick maxFeePerGas to land on round wei amounts against this.
const TOTAL_GAS_UNITS = 400_000n;

describe("PolicyEngine.evaluate", () => {
  let db: PolicyDb;
  let nowRef: { current: number };
  let engine: PolicyEngine;
  let deps: PolicyEngineDeps;

  beforeEach(() => {
    db = new PolicyDb(":memory:");
    nowRef = { current: Date.parse("2026-01-01T00:00:00.000Z") };
    deps = {
      db,
      auth: fakeAuth(),
      apps: new AppRegistry({ apps: [APP_ALL, APP_SCOPED, APP_LOW_DAILY, APP_LOW_LIFETIME] }),
      allowlist: new Allowlist({ destinations: [ALLOWED_TARGET, OTHER_ALLOWED_TARGET] }),
      signerAccount: privateKeyToAccount(TEST_SIGNER_KEY),
      chainId: 31337,
      paymasterAddress: "0x0000000000000000000000000000000000005678" as Address,
      paymasterVerificationGasLimit: 100_000n,
      paymasterPostOpGasLimit: 50_000n,
      validityWindowSeconds: 90,
      userAndGlobalCaps: {
        userHourlyCountCap: 100,
        userDailyCountCap: 1000,
        userLifetimeCountCap: 100_000,
        userHourlySpendCapWei: 10n ** 18n,
        userDailySpendCapWei: 10n ** 18n,
        userLifetimeSpendCapWei: 10n ** 18n,
        globalDailySpendCeilingWei: 10n ** 18n,
      },
      now: () => nowRef.current,
    };
    engine = new PolicyEngine(deps);
  });

  afterEach(() => {
    db.close();
  });

  // --- auth ordering (steps 1-2) ---

  it("denies with invalid_or_expired_token when no access token is supplied", async () => {
    const result = await engine.evaluate(null, "app-all-key", buildUserOp());
    expect(result).toMatchObject({ status: "denied", reason: "invalid_or_expired_token" });
  });

  it("denies with invalid_or_expired_token when the auth checker rejects the token", async () => {
    deps.auth = fakeAuth({ authenticate: async () => ({ ok: false, reason: "invalid_or_expired_token" }) });
    engine = new PolicyEngine(deps);
    const result = await engine.evaluate("some-token", "app-all-key", buildUserOp());
    expect(result).toMatchObject({ status: "denied", reason: "invalid_or_expired_token" });
  });

  it("denies with sender_not_owned_by_token_user when the token is valid but doesn't own the sender", async () => {
    deps.auth = fakeAuth({
      authenticate: async () => ({ ok: false, reason: "sender_not_owned_by_token_user" }),
    });
    engine = new PolicyEngine(deps);
    const result = await engine.evaluate("some-token", "app-all-key", buildUserOp());
    expect(result).toMatchObject({ status: "denied", reason: "sender_not_owned_by_token_user" });
  });

  // --- app resolution (step 3) ---

  it("denies with unknown_or_invalid_app_credential when no api key is supplied", async () => {
    const result = await engine.evaluate("token", null, buildUserOp());
    expect(result).toMatchObject({ status: "denied", reason: "unknown_or_invalid_app_credential" });
  });

  it("denies with unknown_or_invalid_app_credential when the api key doesn't match any registered app", async () => {
    const result = await engine.evaluate("token", "not-a-real-key", buildUserOp());
    expect(result).toMatchObject({ status: "denied", reason: "unknown_or_invalid_app_credential" });
  });

  // --- calldata decode (step 4a) ---

  it("denies with calldata_decode_failed for callData that isn't a recognized Kernel execute()", async () => {
    const result = await engine.evaluate("token", "app-all-key", buildUserOp({ callData: "0xdeadbeef" }));
    expect(result).toMatchObject({ status: "denied", reason: "calldata_decode_failed" });
  });

  // --- destination allowlist (step 4b) ---

  it("denies with destination_not_globally_allowed for a destination outside the global list", async () => {
    const result = await engine.evaluate(
      "token",
      "app-all-key",
      buildUserOp({ callData: buildSingleKernelExecuteCallData(NOT_GLOBALLY_ALLOWED_TARGET) }),
    );
    expect(result).toMatchObject({ status: "denied", reason: "destination_not_globally_allowed" });
  });

  it("denies with destination_not_allowed_for_app for a globally-allowed destination outside the app's own scoped list", async () => {
    const result = await engine.evaluate(
      "token",
      "app-scoped-key",
      buildUserOp({ callData: buildSingleKernelExecuteCallData(OTHER_ALLOWED_TARGET) }),
    );
    expect(result).toMatchObject({ status: "denied", reason: "destination_not_allowed_for_app" });
  });

  it("approves a globally-allowed destination that is also inside the app's own scoped list", async () => {
    const result = await engine.evaluate(
      "token",
      "app-scoped-key",
      buildUserOp({ callData: buildSingleKernelExecuteCallData(ALLOWED_TARGET) }),
    );
    expect(result.status).toBe("approved");
  });

  // --- successful approval shape + validity window (step 8) ---

  it("approves a well-formed request and returns the expected shape, including the validity window", async () => {
    const result = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(result.status).toBe("approved");
    if (result.status !== "approved") throw new Error("unreachable");

    expect(result.chainId).toBe(31337);
    expect(result.paymaster).toBe(deps.paymasterAddress);
    expect(result.validAfter).toBe(Math.floor(nowRef.current / 1000));
    expect(result.validUntil).toBe(Math.floor(nowRef.current / 1000) + 90);
    expect(result.paymasterData.startsWith("0x00")).toBe(true); // modeByte is always 0x00
    expect(result.userOpHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  // --- per-user counters (rolling windows) ---

  it("enforces the per-user hourly count cap", async () => {
    deps.userAndGlobalCaps.userHourlyCountCap = 1;
    engine = new PolicyEngine(deps);

    const first = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(first.status).toBe("approved");

    const second = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(second).toMatchObject({ status: "denied", reason: "user_hourly_count_cap_exceeded" });
  });

  it("a rolling hourly window clears once an hour has elapsed", async () => {
    deps.userAndGlobalCaps.userHourlyCountCap = 1;
    engine = new PolicyEngine(deps);

    await engine.evaluate("token", "app-all-key", buildUserOp());
    const blocked = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(blocked).toMatchObject({ reason: "user_hourly_count_cap_exceeded" });

    nowRef.current += 60 * 60 * 1000 + 1; // advance past the trailing hour
    const afterWindow = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(afterWindow.status).toBe("approved");
  });

  it("enforces the per-user daily count cap even when the hourly cap has room", async () => {
    deps.userAndGlobalCaps.userHourlyCountCap = 1000;
    deps.userAndGlobalCaps.userDailyCountCap = 1;
    engine = new PolicyEngine(deps);

    const first = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(first.status).toBe("approved");
    const second = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(second).toMatchObject({ status: "denied", reason: "user_daily_count_cap_exceeded" });
  });

  it("enforces the per-user lifetime count cap", async () => {
    deps.userAndGlobalCaps.userHourlyCountCap = 1000;
    deps.userAndGlobalCaps.userDailyCountCap = 1000;
    deps.userAndGlobalCaps.userLifetimeCountCap = 1;
    engine = new PolicyEngine(deps);

    const first = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(first.status).toBe("approved");
    const second = await engine.evaluate("token", "app-all-key", buildUserOp());
    expect(second).toMatchObject({ status: "denied", reason: "user_lifetime_count_cap_exceeded" });
  });

  // --- per-user spend (rolling windows) ---

  it("enforces the per-user hourly spend cap", async () => {
    // cost = TOTAL_GAS_UNITS * maxFeePerGas; pick a cap just under one op's cost.
    deps.userAndGlobalCaps.userHourlySpendCapWei = TOTAL_GAS_UNITS * 3n - 1n;
    engine = new PolicyEngine(deps);

    const result = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 3n }));
    expect(result).toMatchObject({ status: "denied", reason: "user_hourly_spend_cap_exceeded" });
  });

  it("enforces the per-user daily spend cap even when the hourly spend cap has room", async () => {
    deps.userAndGlobalCaps.userHourlySpendCapWei = 10n ** 18n;
    deps.userAndGlobalCaps.userDailySpendCapWei = TOTAL_GAS_UNITS * 3n - 1n;
    engine = new PolicyEngine(deps);

    const result = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 3n }));
    expect(result).toMatchObject({ status: "denied", reason: "user_daily_spend_cap_exceeded" });
  });

  it("enforces the per-user lifetime spend cap", async () => {
    deps.userAndGlobalCaps.userHourlySpendCapWei = 10n ** 18n;
    deps.userAndGlobalCaps.userDailySpendCapWei = 10n ** 18n;
    deps.userAndGlobalCaps.userLifetimeSpendCapWei = TOTAL_GAS_UNITS * 3n - 1n;
    engine = new PolicyEngine(deps);

    const result = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 3n }));
    expect(result).toMatchObject({ status: "denied", reason: "user_lifetime_spend_cap_exceeded" });
  });

  it("a within-cap request is approved and does record spend (proven by a subsequent request tripping the cap)", async () => {
    deps.userAndGlobalCaps.userDailySpendCapWei = TOTAL_GAS_UNITS * 1n + TOTAL_GAS_UNITS * 1n - 1n; // room for ~1.99 ops @ fee=1
    engine = new PolicyEngine(deps);

    const first = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(first.status).toBe("approved");
    const second = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(second).toMatchObject({ status: "denied", reason: "user_daily_spend_cap_exceeded" });
  });

  // --- per-app spend ---

  it("enforces the per-app daily spend cap", async () => {
    // APP_LOW_DAILY's dailySpendCapWei = 1_000_000n; TOTAL_GAS_UNITS(400_000) * fee(3) = 1_200_000 > cap.
    const result = await engine.evaluate("token", "app-low-daily-key", buildUserOp({ maxFeePerGas: 3n }));
    expect(result).toMatchObject({ status: "denied", reason: "app_daily_spend_cap_exceeded" });
  });

  it("enforces the per-app lifetime spend cap when set (non-null)", async () => {
    const result = await engine.evaluate("token", "app-low-lifetime-key", buildUserOp({ maxFeePerGas: 3n }));
    expect(result).toMatchObject({ status: "denied", reason: "app_lifetime_spend_cap_exceeded" });
  });

  it("does not enforce a per-app lifetime cap when it is null (no cap configured)", async () => {
    // APP_ALL has lifetimeSpendCapWei: null -- must never deny for that reason no matter the spend.
    const result = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1_000_000n }));
    // (it may still be denied by some OTHER cap at this fee level; what
    // matters is it's never app_lifetime_spend_cap_exceeded specifically)
    if (result.status === "denied") {
      expect(result.reason).not.toBe("app_lifetime_spend_cap_exceeded");
    }
  });

  it("per-app spend is scoped per app -- one app's spend does not count against another app's cap", async () => {
    // Spend heavily under app-all (no low cap), then confirm app-low-daily
    // still has its full cap available.
    await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 2n })); // 800_000 wei under app-all
    const result = await engine.evaluate("token", "app-low-daily-key", buildUserOp({ maxFeePerGas: 1n })); // 400_000 wei, cap 1_000_000
    expect(result.status).toBe("approved");
  });

  // --- global circuit breaker ---

  it("trips the global circuit breaker once aggregate spend across ALL apps/users crosses the ceiling", async () => {
    deps.userAndGlobalCaps.globalDailySpendCeilingWei = TOTAL_GAS_UNITS * 3n - 1n;
    engine = new PolicyEngine(deps);

    const result = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 3n }));
    expect(result).toMatchObject({ status: "denied", reason: "global_circuit_breaker_tripped" });
  });

  it("the circuit breaker aggregates spend across different apps and users, not just the current request's", async () => {
    deps.userAndGlobalCaps.globalDailySpendCeilingWei = TOTAL_GAS_UNITS * 1n + TOTAL_GAS_UNITS * 1n; // room for exactly 2 ops @ fee=1
    deps.auth = fakeAuth({
      authenticate: async (_token, sender) => ({ ok: true, userId: `user-for-${sender}` }),
    });
    engine = new PolicyEngine(deps);

    // Two different apps, two different (fake) users, same tiny cost each.
    const first = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(first.status).toBe("approved");
    const second = await engine.evaluate("token", "app-scoped-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(second.status).toBe("approved");
    // A third op of any app/user must now trip the GLOBAL ceiling, even
    // though neither individual app/user cap was anywhere near exceeded.
    const third = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(third).toMatchObject({ status: "denied", reason: "global_circuit_breaker_tripped" });
  });

  it("a manual circuit-breaker reset re-enables approvals", async () => {
    // Ceiling covers exactly one op's cost (fee=1n -> 400_000 wei). A first
    // approval consumes the whole ceiling; a second identical op then trips
    // it; only AFTER a reset does the window's accumulated spend go back to
    // zero, letting a third identical op through.
    deps.userAndGlobalCaps.globalDailySpendCeilingWei = TOTAL_GAS_UNITS * 1n;
    engine = new PolicyEngine(deps);

    const first = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(first.status).toBe("approved");

    const tripped = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(tripped).toMatchObject({ reason: "global_circuit_breaker_tripped" });

    // Advance by 1ms first: the window-start comparison is `ts_ms >=
    // windowStart` (see db.ts globalSpendSince), so resetting at the EXACT
    // same millisecond as the first approval would still count that event.
    nowRef.current += 1;
    db.manuallyResetCircuitBreaker(nowRef.current);

    const afterReset = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(afterReset.status).toBe("approved");
  });

  it("the circuit breaker also rolls over naturally at UTC midnight", async () => {
    // Same shape as the manual-reset test above: a first approval consumes
    // the whole daily ceiling, a second identical op trips it, and only
    // crossing into the next UTC day (not a manual reset) clears the window.
    deps.userAndGlobalCaps.globalDailySpendCeilingWei = TOTAL_GAS_UNITS * 1n;
    engine = new PolicyEngine(deps);

    const first = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(first.status).toBe("approved");

    const tripped = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(tripped).toMatchObject({ reason: "global_circuit_breaker_tripped" });

    nowRef.current = Date.parse("2026-01-02T00:00:00.001Z"); // next UTC day
    const nextDay = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(nextDay.status).toBe("approved");
  });

  // --- denials never consume budget ---

  it("a denied request does not record a sponsorship_events row (denials never consume budget)", async () => {
    // Deny via allowlist (a pre-cap-check denial) then confirm a full-cost
    // op still succeeds afterward against a cap that only allows exactly one.
    deps.userAndGlobalCaps.userDailySpendCapWei = TOTAL_GAS_UNITS * 1n; // room for exactly 1 op @ fee=1
    engine = new PolicyEngine(deps);

    const denied = await engine.evaluate(
      "token",
      "app-all-key",
      buildUserOp({ callData: buildSingleKernelExecuteCallData(NOT_GLOBALLY_ALLOWED_TARGET) }),
    );
    expect(denied).toMatchObject({ reason: "destination_not_globally_allowed" });

    const approved = await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 1n }));
    expect(approved.status).toBe("approved");
  });

  // --- audit trail ---

  it("writes an audit_log row for both approvals and denials", async () => {
    await engine.evaluate(null, "app-all-key", buildUserOp()); // denied, pre-auth
    await engine.evaluate("token", "app-all-key", buildUserOp()); // approved

    const audit = db.listAudit(10);
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.some((entry) => entry.decision === "denied" && entry.reason === "invalid_or_expired_token")).toBe(
      true,
    );
    expect(audit.some((entry) => entry.decision === "approved")).toBe(true);
  });

  // --- idempotency by userOpHash ---

  it("two concurrent evaluate calls for the same op produce exactly one charge", async () => {
    // Fee chosen so one op costs 800_000 wei: a double charge would breach the 1_000_000 hourly cap.
    deps.userAndGlobalCaps = { ...deps.userAndGlobalCaps, userHourlySpendCapWei: 1_000_000n };
    engine = new PolicyEngine(deps);
    const op = buildUserOp({ maxFeePerGas: 1n, nonce: 777n });
    const costly = { ...op, maxFeePerGas: 2n }; // 2 wei/gas * 400_000 = 800_000
    const [a, b] = await Promise.all([
      engine.evaluate("token", "app-all-key", costly),
      engine.evaluate("token", "app-all-key", costly),
    ]);
    expect(a).toMatchObject({ status: "approved" });
    expect(b).toMatchObject({ status: "approved" });
    expect((a as { userOpHash: string }).userOpHash).toBe((b as { userOpHash: string }).userOpHash);
    expect(db.resetSpendEvents()).toBe(1);
  });

  it("an expired, unexecuted approval does not count toward caps", async () => {
    deps.userAndGlobalCaps = { ...deps.userAndGlobalCaps, userHourlySpendCapWei: 1_000_000n };
    engine = new PolicyEngine(deps);
    const costly = buildUserOp({ maxFeePerGas: 2n }); // 800_000 wei
    expect(await engine.evaluate("token", "app-all-key", costly)).toMatchObject({ status: "approved" });
    // Within the 90s validity window the first approval still counts.
    nowRef.current += 30_000;
    expect(await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 2n }))).toMatchObject({
      status: "denied",
      reason: "user_hourly_spend_cap_exceeded",
    });
    // Past validUntil the paymaster signature is dead on-chain, so it no longer counts.
    nowRef.current += 61_000;
    expect(await engine.evaluate("token", "app-all-key", buildUserOp({ maxFeePerGas: 2n }))).toMatchObject({
      status: "approved",
    });
  });
});
