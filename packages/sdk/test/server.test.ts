import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData } from "viem";
import type { AbiFunction, Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  PRIVY_POLICY_NAME_MAX_LENGTH,
  assertWithinPolicyNameLimit,
  broadcastSignedTransaction,
  buildSessionPolicy,
  signAndBroadcast,
  withGasLimitBuffer,
} from "../src/session/policy.js";
import type { PrivyUnsignedTransaction, SignAndBroadcastClient } from "../src/session/policy.js";

const contract: Address = "0x261eA5971B93237a56990206A46Bc80318e4d078";
const tap: AbiFunction = { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] };
const reset: AbiFunction = { type: "function", name: "reset", stateMutability: "nonpayable", inputs: [], outputs: [] };
const HASH = `0x${"ab".repeat(32)}` as Hex;

describe("policy name limit", () => {
  it("is 49: Privy rejects 50 or more", () => {
    expect(PRIVY_POLICY_NAME_MAX_LENGTH).toBe(49);
    expect(assertWithinPolicyNameLimit("a".repeat(49), "n")).toBe("a".repeat(49));
    expect(() => assertWithinPolicyNameLimit("a".repeat(50), "Policy name")).toThrow(/Policy name is 50/);
  });
});

describe("buildSessionPolicy", () => {
  it("builds one scoped ALLOW rule: contract, function, zero value, expiry", () => {
    const policy = buildSessionPolicy({ contractAddress: contract, functions: [tap], expiresAtUnixSeconds: 1_900_000_000 });
    expect(policy.version).toBe("1.0");
    expect(policy.chain_type).toBe("ethereum");
    expect(policy.rules).toHaveLength(1);
    const rule = policy.rules[0]!;
    expect(rule.method).toBe("eth_signTransaction");
    expect(rule.action).toBe("ALLOW");
    expect(rule.conditions).toEqual([
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: contract },
      { field_source: "ethereum_calldata", field: "function_name", abi: [tap], operator: "eq", value: "tap" },
      { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0x0" },
      { field_source: "system", field: "current_unix_timestamp", operator: "lte", value: "1900000000" },
    ]);
    expect(policy.name.length).toBeLessThanOrEqual(49);
    expect(rule.name.length).toBeLessThanOrEqual(49);
  });

  it("emits one rule per function", () => {
    const policy = buildSessionPolicy({ contractAddress: contract, functions: [tap, reset], expiresAtUnixSeconds: 1_900_000_000 });
    expect(policy.rules).toHaveLength(2);
  });

  it("refuses to build an unscoped policy", () => {
    const base = { contractAddress: contract, functions: [tap], expiresAtUnixSeconds: 1_900_000_000 };
    expect(() => buildSessionPolicy({ ...base, functions: [] })).toThrow(/unscoped/);
    expect(() => buildSessionPolicy({ ...base, contractAddress: "0x12" as Address })).toThrow(/unscoped/);
    expect(() => buildSessionPolicy({ ...base, expiresAtUnixSeconds: 0 })).toThrow(/expiry/);
    expect(() => buildSessionPolicy({ ...base, expiresAtUnixSeconds: 1.5 })).toThrow(/expiry/);
    expect(() =>
      buildSessionPolicy({ ...base, functions: [{ type: "event" } as unknown as AbiFunction] }),
    ).toThrow(/function fragment/);
  });

  it("enforces the name limit on a custom name and on derived rule names", () => {
    const base = { contractAddress: contract, functions: [tap], expiresAtUnixSeconds: 1_900_000_000 };
    expect(() => buildSessionPolicy({ ...base, name: "x".repeat(50) })).toThrow(/Policy name/);
    const longFn: AbiFunction = { ...tap, name: "aVeryLongFunctionNameThatBlowsTheRuleBudget" };
    expect(() => buildSessionPolicy({ ...base, functions: [longFn], name: "ok" })).toThrow(/Rule name/);
  });
});

function mockClient(): SignAndBroadcastClient {
  return {
    getTransactionCount: vi.fn(async () => 5),
    estimateGas: vi.fn(async () => 100_000n),
    getGasPrice: vi.fn(async () => 12_500n * 10n ** 9n),
    sendRawTransaction: vi.fn(async () => HASH),
  };
}

describe("broadcastSignedTransaction", () => {
  it("broadcasts raw hex or Privy's { signed_transaction } and returns the hash", async () => {
    const client = mockClient();
    const hash1 = await broadcastSignedTransaction(client, "0x02f8");
    const hash2 = await broadcastSignedTransaction(client, { signed_transaction: "0x02f8" });
    expect(hash1).toBe(HASH);
    expect(hash2).toBe(hash1);
    expect(client.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0x02f8" });
  });

  it("rejects non-hex input without calling the network", async () => {
    const client = mockClient();
    await expect(broadcastSignedTransaction(client, { signed_transaction: "nope" })).rejects.toThrow(/hex/);
    await expect(broadcastSignedTransaction(client, "0x")).rejects.toThrow(/hex/);
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("signAndBroadcast", () => {
  it("resolves fields, signs a legacy tx with a 20% gas buffer, broadcasts, and returns the hash", async () => {
    const client = mockClient();
    const sign = vi.fn(async (_tx: PrivyUnsignedTransaction) => ({ signed_transaction: "0xdeadbeef" }));
    const data = encodeFunctionData({ abi: [tap], functionName: "tap" });
    const hash = await signAndBroadcast({ client, from: contract, to: contract, data, chainId: 97741, sign });
    expect(hash).toBe(HASH);
    expect(client.getTransactionCount).toHaveBeenCalledWith({ address: contract, blockTag: "pending" });
    const tx = sign.mock.calls[0]![0];
    expect(tx).toMatchObject({
      to: contract,
      data,
      value: "0x0",
      chain_id: 97741,
      type: 0,
      nonce: 5,
      gas_limit: `0x${(120_000n).toString(16)}`,
    });
    expect(client.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0xdeadbeef" });
  });

  it("encodes calldata from abi + functionName and requires some calldata", async () => {
    const client = mockClient();
    const sign = vi.fn(async (_tx: PrivyUnsignedTransaction) => "0x01" as Hex);
    await signAndBroadcast({ client, from: contract, to: contract, abi: [tap], functionName: "tap", chainId: 97741, sign });
    expect(sign.mock.calls[0]![0].data).toBe(encodeFunctionData({ abi: [tap], functionName: "tap" }));
    await expect(signAndBroadcast({ client, from: contract, to: contract, chainId: 97741, sign })).rejects.toThrow(/data/);
  });

  it("surfaces a signing failure (policy denial) and does not broadcast", async () => {
    const client = mockClient();
    const sign = vi.fn(async (_tx: PrivyUnsignedTransaction): Promise<Hex> => {
      throw new Error("policy denied");
    });
    await expect(
      signAndBroadcast({ client, from: contract, to: contract, data: "0x12", chainId: 97741, sign }),
    ).rejects.toThrow(/policy denied/);
    expect(client.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("withGasLimitBuffer adds 20%", () => {
    expect(withGasLimitBuffer(100n)).toBe(120n);
  });
});

describe("server entry stays out of client entries", () => {
  it("no other src module imports ./server", () => {
    const srcDir = fileURLToPath(new URL("../src", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : [],
      );
    const offenders = walk(srcDir).filter(
      (f) => !f.endsWith("server.ts") && /from\s+["'][^"']*\/server(\.js)?["']/.test(readFileSync(f, "utf-8")),
    );
    expect(offenders).toEqual([]);
  });
});
