import { describe, expect, it } from "vitest";
import { buildSessionPolicy, describeSessionScope, PRIVY_POLICY_NAME_MAX_LENGTH } from "@pepu-chain/sdk/session";
import { tapFunction } from "./scope";

/**
 * AGENTS.md rule 1, as tests: the game's scope always yields a scoped policy
 * (contract + function + zero value + expiry), and Privy's policy-name limit
 * (at most 49 characters, stricter than its published 50) holds for a real
 * 42-character address. The policy builder itself is `@pepu-chain/sdk/session`.
 */
const CONTRACT = "0x261eA5971B93237a56990206A46Bc80318e4d078";
const scope = { contractAddress: CONTRACT as `0x${string}`, functions: [tapFunction] };

describe("game session scope", () => {
  it("builds one ALLOW rule with all four conditions", () => {
    const policy = buildSessionPolicy({ ...scope, expiresAtUnixSeconds: 1_800_000_000 });
    expect(policy.rules).toHaveLength(1);
    const conditions = policy.rules[0]?.conditions ?? [];
    expect(conditions.map((c) => `${c.field_source}:${c.field}`)).toEqual([
      "ethereum_transaction:to",
      "ethereum_calldata:function_name",
      "ethereum_transaction:value",
      "system:current_unix_timestamp",
    ]);
    expect(policy.rules[0]?.method).toBe("eth_signTransaction");
  });

  it("keeps policy and rule names within Privy's 49-character limit", () => {
    const policy = buildSessionPolicy({ ...scope, expiresAtUnixSeconds: 1_800_000_000 });
    expect(PRIVY_POLICY_NAME_MAX_LENGTH).toBe(49);
    expect(policy.name.length).toBeLessThanOrEqual(PRIVY_POLICY_NAME_MAX_LENGTH);
    expect(policy.rules[0]?.name.length).toBeLessThanOrEqual(PRIVY_POLICY_NAME_MAX_LENGTH);
  });

  it("refuses to build an unscoped policy", () => {
    expect(() => buildSessionPolicy({ ...scope, functions: [], expiresAtUnixSeconds: 1 })).toThrow();
    expect(() => buildSessionPolicy({ ...scope, contractAddress: "0x" as `0x${string}`, expiresAtUnixSeconds: 1 })).toThrow();
  });

  it("describes tap() with zero value for the consent screen", () => {
    const described = describeSessionScope({ ...scope, expiresAtUnixSeconds: 1 });
    expect(described.functions[0]?.signature).toBe("tap()");
    expect(described.functions[0]?.valueWei).toBe("0");
  });
});
