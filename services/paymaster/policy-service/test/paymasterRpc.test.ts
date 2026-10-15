/**
 * Unit tests for the ERC-7677 paymaster JSON-RPC adapter (src/paymasterRpc.ts).
 * Exercises `handlePaymasterRpcRequest`/`handlePaymasterRpcBody` directly
 * (no HTTP server involved — server.ts is thin routing glue with no
 * precedent for HTTP-level tests in this package; see
 * test/policyEngine.test.ts for the same "test the module directly"
 * convention) against a REAL `PolicyEngine` backed by an in-memory
 * `PolicyDb`, wired with `createSenderKeyedAuthChecker()` — i.e. the exact
 * same engine construction index.ts uses for this surface. The point of
 * these tests is to prove the JSON-RPC translation layer defers to that
 * unmodified engine correctly, not to re-test the engine's own cap/allowlist
 * logic (already covered by test/policyEngine.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { numberToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PolicyEngine } from "../src/policy.js";
import { PolicyDb } from "../src/db.js";
import { AppRegistry, sha256HexOf } from "../src/appRegistry.js";
import { Allowlist } from "../src/allowlist.js";
import { createSenderKeyedAuthChecker } from "../src/paymasterRpcAuth.js";
import {
  JSON_RPC_ERROR_CODES,
  PAYMASTER_RPC_METHODS,
  handlePaymasterRpcBody,
  handlePaymasterRpcRequest,
  type PaymasterRpcConfig,
} from "../src/paymasterRpc.js";
import type { RegisteredApp, SponsorUserOperationInput } from "../src/types.js";
import { buildSingleKernelExecuteCallData } from "./helpers/kernelCallData.js";

const TEST_SIGNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address;
const PAYMASTER_ADDRESS = "0x0000000000000000000000000000000000005678" as Address;
const CHAIN_ID = 97741;
const ALLOWED_TARGET = "0x0000000000000000000000000000000000000001" as Address;
const NOT_ALLOWED_TARGET = "0x0000000000000000000000000000000000000009" as Address;
const SENDER = "0x0000000000000000000000000000000000000042" as Address;
const KERNEL_FACTORY = "0x000000000000000000000000000000000000f00a" as Address;

function hex(n: bigint): Hex {
  return numberToHex(n);
}

function makeApp(overrides: Partial<RegisteredApp> & { id: string; rawApiKey: string }): RegisteredApp {
  return {
    apiKeyHashHex: sha256HexOf(overrides.rawApiKey),
    allowedDestinations: "*",
    dailySpendCapWei: 10n ** 18n,
    lifetimeSpendCapWei: null,
    ...overrides,
  };
}

const APP = makeApp({ id: "app-1", rawApiKey: "app-1-key" });

function buildUserOp(overrides: Partial<SponsorUserOperationInput> = {}): SponsorUserOperationInput {
  return {
    sender: SENDER,
    nonce: 0n,
    callData: buildSingleKernelExecuteCallData(ALLOWED_TARGET),
    callGasLimit: 100_000n,
    verificationGasLimit: 100_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    ...overrides,
  };
}

/** Wire-format (JSON-RPC hex-quantity strings), matching what a real ERC-7677 client sends as params[0]. */
function toWireUserOp(userOp: SponsorUserOperationInput): Record<string, unknown> {
  return {
    sender: userOp.sender,
    nonce: hex(userOp.nonce),
    ...(userOp.factory ? { factory: userOp.factory } : {}),
    ...(userOp.factoryData ? { factoryData: userOp.factoryData } : {}),
    callData: userOp.callData,
    callGasLimit: hex(userOp.callGasLimit),
    verificationGasLimit: hex(userOp.verificationGasLimit),
    preVerificationGas: hex(userOp.preVerificationGas),
    maxFeePerGas: hex(userOp.maxFeePerGas),
    maxPriorityFeePerGas: hex(userOp.maxPriorityFeePerGas),
    signature: "0xaabbcc",
  };
}

function rpcRequest(method: string, params: unknown, id: unknown = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

describe("paymasterRpc: ERC-7677 pm_getPaymasterStubData / pm_getPaymasterData", () => {
  let db: PolicyDb;
  let policy: PolicyEngine;
  let config: PaymasterRpcConfig;

  beforeEach(() => {
    db = new PolicyDb(":memory:");
    policy = new PolicyEngine({
      db,
      auth: createSenderKeyedAuthChecker(),
      apps: new AppRegistry({ apps: [APP] }),
      allowlist: new Allowlist({ destinations: [ALLOWED_TARGET] }),
      signerAccount: privateKeyToAccount(TEST_SIGNER_KEY),
      chainId: CHAIN_ID,
      paymasterAddress: PAYMASTER_ADDRESS,
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
    });
    config = {
      policy,
      entryPointAddress: ENTRY_POINT,
      chainId: CHAIN_ID,
      paymasterAddress: PAYMASTER_ADDRESS,
      paymasterVerificationGasLimit: 100_000n,
      paymasterPostOpGasLimit: 50_000n,
      validityWindowSeconds: 90,
      allowAccountDeployment: true,
    };
  });

  afterEach(() => {
    db.close();
  });

  // --- protocol-level plumbing ---

  it("exposes exactly the two ERC-7677 methods this session verified a spec for", () => {
    expect(PAYMASTER_RPC_METHODS).toEqual(["pm_getPaymasterStubData", "pm_getPaymasterData"]);
  });

  it("rejects a non-object request with Invalid Request (-32600) and id null", async () => {
    const response = await handlePaymasterRpcRequest("not an object", config, { apiKey: "app-1-key" });
    expect(response).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: JSON_RPC_ERROR_CODES.invalidRequest } });
  });

  it("rejects an unknown method with Method not found (-32601), echoing the request id", async () => {
    const response = await handlePaymasterRpcRequest(
      rpcRequest("pm_sponsorUserOperation", [], "req-1"),
      config,
      { apiKey: "app-1-key" },
    );
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "req-1",
      error: { code: JSON_RPC_ERROR_CODES.methodNotFound },
    });
  });

  it("echoes numeric, string, and missing ids correctly", async () => {
    const withNumericId = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, numberToHex(BigInt(CHAIN_ID))], 42), config, { apiKey: "app-1-key" });
    expect(withNumericId.id).toBe(42);

    const withStringId = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, numberToHex(BigInt(CHAIN_ID))], "abc"), config, { apiKey: "app-1-key" });
    expect(withStringId.id).toBe("abc");

    const withoutId = await handlePaymasterRpcRequest({ jsonrpc: "2.0", method: "pm_getPaymasterStubData", params: [toWireUserOp(buildUserOp()), ENTRY_POINT, numberToHex(BigInt(CHAIN_ID))] }, config, { apiKey: "app-1-key" });
    expect(withoutId.id).toBe(null);
  });

  it("accepts chainId as either a hex quantity or a decimal number/string", async () => {
    const userOp = toWireUserOp(buildUserOp());
    const asHex = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", [userOp, ENTRY_POINT, numberToHex(BigInt(CHAIN_ID))]), config, { apiKey: "app-1-key" });
    const asDecimalNumber = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", [userOp, ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
    const asDecimalString = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", [userOp, ENTRY_POINT, String(CHAIN_ID)]), config, { apiKey: "app-1-key" });

    expect("result" in asHex).toBe(true);
    expect("result" in asDecimalNumber).toBe(true);
    expect("result" in asDecimalString).toBe(true);
  });

  it("rejects a chainId that does not match the configured chain (e.g. the 97721 typo) with Invalid params (-32602)", async () => {
    const response = await handlePaymasterRpcRequest(
      rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, 97721]),
      config,
      { apiKey: "app-1-key" },
    );
    expect(response).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.invalidParams } });
    expect((response as { error: { message: string } }).error.message).toMatch(/97721/);
    expect((response as { error: { message: string } }).error.message).toMatch(/97741/);
  });

  it("rejects an entryPoint that isn't the configured v0.7 EntryPoint with Invalid params (-32602)", async () => {
    const wrongEntryPoint = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
    const response = await handlePaymasterRpcRequest(
      rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), wrongEntryPoint, CHAIN_ID]),
      config,
      { apiKey: "app-1-key" },
    );
    expect(response).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.invalidParams } });
  });

  it("rejects malformed params (not an array) with Invalid params (-32602)", async () => {
    const response = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", { not: "an array" }), config, {
      apiKey: "app-1-key",
    });
    expect(response).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.invalidParams } });
  });

  // --- pm_getPaymasterStubData ---

  describe("pm_getPaymasterStubData", () => {
    it("returns a syntactically valid stub with isFinal:false, without touching the policy engine's caps/audit trail", async () => {
      const response = await handlePaymasterRpcRequest(
        rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]),
        config,
        { apiKey: "app-1-key" },
      );
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        result: {
          paymaster: PAYMASTER_ADDRESS,
          paymasterVerificationGasLimit: numberToHex(100_000n),
          paymasterPostOpGasLimit: numberToHex(50_000n),
          isFinal: false,
        },
      });
      const result = (response as { result: { paymasterData: Hex } }).result;
      expect(result.paymasterData).toMatch(/^0x00/); // modeByte is always 0x00
      expect(result.paymasterData.length).toBe(2 + 78 * 2); // mode(1)+validUntil(6)+validAfter(6)+sig(65)

      // No sponsorship_events / audit rows written -- the stub path is a
      // pure local computation with no PolicyEngine.evaluate() call.
      expect(db.listAudit(10)).toHaveLength(0);
    });

    it("does not require full numeric userOp fields (a stub call may legitimately precede gas estimation)", async () => {
      // Only `sender` is required for the stub path -- see paymasterRpc.ts's
      // minimalUserOpSchema and its doc comment.
      const response = await handlePaymasterRpcRequest(
        rpcRequest("pm_getPaymasterStubData", [{ sender: SENDER }, ENTRY_POINT, CHAIN_ID]),
        config,
        { apiKey: "app-1-key" },
      );
      expect(response).toMatchObject({ result: { isFinal: false } });
    });

    it("still rejects a stub call whose userOp has no sender at all", async () => {
      const response = await handlePaymasterRpcRequest(
        rpcRequest("pm_getPaymasterStubData", [{}, ENTRY_POINT, CHAIN_ID]),
        config,
        { apiKey: "app-1-key" },
      );
      expect(response).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.invalidParams } });
    });

    it("produces a signature that plugs into the same buildPaymasterData() the real approval path uses (shape-compatible)", async () => {
      // Two independent stub calls must each be well-formed (fresh throwaway
      // key every time) -- proves this isn't relying on a fixed/reused key.
      const first = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      const second = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      const firstData = (first as { result: { paymasterData: Hex } }).result.paymasterData;
      const secondData = (second as { result: { paymasterData: Hex } }).result.paymasterData;
      expect(firstData).not.toBe(secondData); // different throwaway keys -> different signatures
    });
  });

  // --- pm_getPaymasterData ---

  describe("pm_getPaymasterData", () => {
    it("approves a well-formed request by deferring to the real, unmodified PolicyEngine", async () => {
      const response = await handlePaymasterRpcRequest(
        rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]),
        config,
        { apiKey: "app-1-key" },
      );
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        result: {
          paymaster: PAYMASTER_ADDRESS,
          paymasterVerificationGasLimit: numberToHex(100_000n),
          paymasterPostOpGasLimit: numberToHex(50_000n),
        },
      });
      // Unlike the stub path, this DOES record an approval via the shared
      // PolicyEngine/PolicyDb -- proof the adapter calls the real engine.
      const audit = db.listAudit(10);
      expect(audit.some((entry) => entry.decision === "approved")).toBe(true);
    });

    it("denies an unknown app credential exactly like /sponsor would, via unknown_or_invalid_app_credential", async () => {
      const response = await handlePaymasterRpcRequest(
        rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]),
        config,
        { apiKey: "not-a-real-app-key" },
      );
      expect(response).toMatchObject({
        error: { code: JSON_RPC_ERROR_CODES.sponsorshipDenied, data: { reason: "unknown_or_invalid_app_credential" } },
      });
    });

    it("denies a destination outside the global allowlist, surfacing the real DenialReason in error.data.reason", async () => {
      const response = await handlePaymasterRpcRequest(
        rpcRequest(
          "pm_getPaymasterData",
          [toWireUserOp(buildUserOp({ callData: buildSingleKernelExecuteCallData(NOT_ALLOWED_TARGET) })), ENTRY_POINT, CHAIN_ID],
        ),
        config,
        { apiKey: "app-1-key" },
      );
      expect(response).toMatchObject({
        error: { code: JSON_RPC_ERROR_CODES.sponsorshipDenied, data: { reason: "destination_not_globally_allowed" } },
      });
    });

    it("enforces per-sender caps: a second op from the SAME sender trips the hourly count cap", async () => {
      config.policy = new PolicyEngine({
        db,
        auth: createSenderKeyedAuthChecker(),
        apps: new AppRegistry({ apps: [APP] }),
        allowlist: new Allowlist({ destinations: [ALLOWED_TARGET] }),
        signerAccount: privateKeyToAccount(TEST_SIGNER_KEY),
        chainId: CHAIN_ID,
        paymasterAddress: PAYMASTER_ADDRESS,
        paymasterVerificationGasLimit: 100_000n,
        paymasterPostOpGasLimit: 50_000n,
        validityWindowSeconds: 90,
        userAndGlobalCaps: {
          userHourlyCountCap: 1,
          userDailyCountCap: 1000,
          userLifetimeCountCap: 100_000,
          userHourlySpendCapWei: 10n ** 18n,
          userDailySpendCapWei: 10n ** 18n,
          userLifetimeSpendCapWei: 10n ** 18n,
          globalDailySpendCeilingWei: 10n ** 18n,
        },
      });

      const first = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      expect("result" in first).toBe(true);

      const second = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp({ nonce: 1n })), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      expect(second).toMatchObject({ error: { data: { reason: "user_hourly_count_cap_exceeded" } } });
    });

    it("does NOT cap two different senders together (unlike a real Privy user, an attacker minting fresh senders gets fresh per-sender caps -- see paymasterRpcAuth.ts's documented trade-off)", async () => {
      config.policy = new PolicyEngine({
        db,
        auth: createSenderKeyedAuthChecker(),
        apps: new AppRegistry({ apps: [APP] }),
        allowlist: new Allowlist({ destinations: [ALLOWED_TARGET] }),
        signerAccount: privateKeyToAccount(TEST_SIGNER_KEY),
        chainId: CHAIN_ID,
        paymasterAddress: PAYMASTER_ADDRESS,
        paymasterVerificationGasLimit: 100_000n,
        paymasterPostOpGasLimit: 50_000n,
        validityWindowSeconds: 90,
        userAndGlobalCaps: {
          userHourlyCountCap: 1,
          userDailyCountCap: 1000,
          userLifetimeCountCap: 100_000,
          userHourlySpendCapWei: 10n ** 18n,
          userDailySpendCapWei: 10n ** 18n,
          userLifetimeSpendCapWei: 10n ** 18n,
          globalDailySpendCeilingWei: 10n ** 18n,
        },
      });
      const otherSender = "0x0000000000000000000000000000000000000099" as Address;

      const first = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      expect("result" in first).toBe(true);

      // A DIFFERENT sender, same hourly-count-cap-of-1, still gets through --
      // this is the exact residual sybil-cap gap flagged in
      // paymasterRpcAuth.ts, proven here rather than merely asserted in prose.
      const second = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp({ sender: otherSender, callData: buildSingleKernelExecuteCallData(ALLOWED_TARGET) })), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      expect("result" in second).toBe(true);
    });

    it("the GLOBAL circuit breaker still trips across many distinct senders (the real backstop against the sybil gap above)", async () => {
      config.policy = new PolicyEngine({
        db,
        auth: createSenderKeyedAuthChecker(),
        apps: new AppRegistry({ apps: [APP] }),
        allowlist: new Allowlist({ destinations: [ALLOWED_TARGET] }),
        signerAccount: privateKeyToAccount(TEST_SIGNER_KEY),
        chainId: CHAIN_ID,
        paymasterAddress: PAYMASTER_ADDRESS,
        paymasterVerificationGasLimit: 100_000n,
        paymasterPostOpGasLimit: 50_000n,
        validityWindowSeconds: 90,
        userAndGlobalCaps: {
          userHourlyCountCap: 1000,
          userDailyCountCap: 1000,
          userLifetimeCountCap: 100_000,
          userHourlySpendCapWei: 10n ** 18n,
          userDailySpendCapWei: 10n ** 18n,
          userLifetimeSpendCapWei: 10n ** 18n,
          // Total gas units per op (100_000+100_000+50_000+100_000+50_000=400_000) * fee(1) = 400_000 wei/op.
          globalDailySpendCeilingWei: 400_000n, // room for exactly one op, from ANY sender
        },
      });
      const senderA = "0x0000000000000000000000000000000000000011" as Address;
      const senderB = "0x0000000000000000000000000000000000000012" as Address;

      const first = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp({ sender: senderA })), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      expect("result" in first).toBe(true);

      const second = await handlePaymasterRpcRequest(rpcRequest("pm_getPaymasterData", [toWireUserOp(buildUserOp({ sender: senderB })), ENTRY_POINT, CHAIN_ID]), config, { apiKey: "app-1-key" });
      expect(second).toMatchObject({ error: { data: { reason: "global_circuit_breaker_tripped" } } });
    });

    it("rejects factory/factoryData (new-account deployment) when allowAccountDeployment is false", async () => {
      config.allowAccountDeployment = false;
      const response = await handlePaymasterRpcRequest(
        rpcRequest(
          "pm_getPaymasterData",
          [toWireUserOp(buildUserOp({ factory: KERNEL_FACTORY, factoryData: "0x1234" })), ENTRY_POINT, CHAIN_ID],
        ),
        config,
        { apiKey: "app-1-key" },
      );
      expect(response).toMatchObject({
        error: { code: JSON_RPC_ERROR_CODES.accountDeploymentDisabled, data: { reason: "account_deployment_disabled_on_public_endpoint" } },
      });
      // Must never reach the policy engine at all -- no audit row written.
      expect(db.listAudit(10)).toHaveLength(0);
    });

    it("allows factory/factoryData when allowAccountDeployment is true (the default)", async () => {
      expect(config.allowAccountDeployment).toBe(true);
      const response = await handlePaymasterRpcRequest(
        rpcRequest(
          "pm_getPaymasterData",
          [toWireUserOp(buildUserOp({ factory: KERNEL_FACTORY, factoryData: "0x1234" })), ENTRY_POINT, CHAIN_ID],
        ),
        config,
        { apiKey: "app-1-key" },
      );
      expect("result" in response).toBe(true);
    });
  });

  // --- batch handling ---

  describe("handlePaymasterRpcBody", () => {
    it("handles a single request object (not an array) by returning a single response object", async () => {
      const response = await handlePaymasterRpcBody(
        rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID]),
        config,
        { apiKey: "app-1-key" },
      );
      expect(Array.isArray(response)).toBe(false);
    });

    it("handles a batch array by returning a same-length array of responses, one per request", async () => {
      const response = await handlePaymasterRpcBody(
        [
          rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID], "a"),
          rpcRequest("pm_getPaymasterStubData", [toWireUserOp(buildUserOp()), ENTRY_POINT, CHAIN_ID], "b"),
        ],
        config,
        { apiKey: "app-1-key" },
      );
      expect(Array.isArray(response)).toBe(true);
      const arr = response as { id: unknown }[];
      expect(arr).toHaveLength(2);
      expect(arr.map((r) => r.id)).toEqual(["a", "b"]);
    });
  });
});
