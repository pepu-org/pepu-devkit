import { encodeFunctionData, isAddress, isHex, toFunctionSelector, toFunctionSignature, toHex } from "viem";
import type { Abi, AbiFunction, Address, Hash, Hex } from "viem";
import { PepuPolicyError } from "../errors.js";

/**
 * SERVER-ONLY helpers (`@pepu-chain/sdk/server`). Nothing here holds a secret,
 * but these run on a backend that does hold Privy's app secret and
 * authorization key; keep this entry point out of client bundles. No module
 * in `src/` imports the `./server` barrel (enforced by a test). This file is the pure policy builder; it is re-exported from `@pepu-chain/sdk/session` and `@pepu-chain/sdk/server`.
 */

/**
 * Privy rejects policy and rule names of 50 characters or more. Its published
 * OpenAPI spec says `maxLength: 50`, but the live validator says "must be
 * fewer than 50 characters", so the real limit is 49 (measured on a real
 * `POST /policies` 400). Using 49 is safe under both readings.
 */
export const PRIVY_POLICY_NAME_MAX_LENGTH = 49;

/** Throws if `value` is over {@link PRIVY_POLICY_NAME_MAX_LENGTH}; returns it otherwise. */
export function assertWithinPolicyNameLimit(value: string, field: string): string {
  if (value.length > PRIVY_POLICY_NAME_MAX_LENGTH) {
    throw new PepuPolicyError("POLICY_NAME_TOO_LONG", 
      `${field} is ${value.length} characters ("${value}"), but Privy rejects policy/rule names ` +
        `of ${PRIVY_POLICY_NAME_MAX_LENGTH + 1} or more (max ${PRIVY_POLICY_NAME_MAX_LENGTH}). Shorten it.`,
    );
  }
  return value;
}

export type SessionPolicyCondition =
  | { field_source: "ethereum_transaction"; field: "to" | "value"; operator: "eq"; value: string }
  | {
      field_source: "ethereum_calldata";
      field: "function_name";
      abi: AbiFunction[];
      operator: "eq";
      value: string;
    }
  | { field_source: "system"; field: "current_unix_timestamp"; operator: "lte"; value: string };

export interface SessionPolicyRule {
  name: string;
  method: "eth_signTransaction";
  action: "ALLOW";
  conditions: SessionPolicyCondition[];
}

/** Body for `privy.policies().create(...)`. */
export interface SessionPolicy {
  version: "1.0";
  name: string;
  chain_type: "ethereum";
  rules: SessionPolicyRule[];
}

export interface BuildSessionPolicyParams {
  /** The one contract the session may call. */
  contractAddress: Address;
  /** The function(s) the session may call, as ABI function fragments. At least one. */
  functions: readonly AbiFunction[];
  /** Unix seconds after which Privy's engine denies every request. */
  expiresAtUnixSeconds: number;
  /** Optional dashboard label; must be at most 49 characters. */
  name?: string;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Build the scoped Privy session-signer policy: ONE `ALLOW` rule per function,
 * each requiring `to` equals the contract, calldata decodes to that function,
 * `value` is exactly zero, and the clock is before expiry. Privy ANDs the
 * conditions in a rule, ORs the rules, and denies by default.
 *
 * Refuses to build an unscoped policy: it throws on an invalid contract
 * address, no functions, a non-function ABI item, or a bad expiry. Names are
 * checked against {@link PRIVY_POLICY_NAME_MAX_LENGTH}. The method is
 * `eth_signTransaction` (a rule for `eth_sendTransaction` never matches the
 * sign-and-broadcast flow).
 *
 * The scope is enforced by Privy's backend policy engine, not on-chain.
 */
export function buildSessionPolicy({
  contractAddress,
  functions,
  expiresAtUnixSeconds,
  name,
}: BuildSessionPolicyParams): SessionPolicy {
  if (!isAddress(contractAddress, { strict: false })) {
    throw new PepuPolicyError("POLICY_UNSCOPED", 
      "buildSessionPolicy: contractAddress must be a valid 0x address; refusing to build an unscoped policy.",
    );
  }
  if (functions.length === 0) {
    throw new PepuPolicyError("POLICY_UNSCOPED", 
      "buildSessionPolicy: at least one function is required; refusing to build an unscoped policy.",
    );
  }
  for (const fn of functions) {
    if (fn.type !== "function" || !fn.name) {
      throw new PepuPolicyError("POLICY_UNSCOPED", 
        "buildSessionPolicy: every entry in `functions` must be an ABI function fragment with a name.",
      );
    }
  }
  if (!Number.isInteger(expiresAtUnixSeconds) || expiresAtUnixSeconds <= 0) {
    throw new PepuPolicyError("POLICY_UNSCOPED", 
      "buildSessionPolicy: expiresAtUnixSeconds must be a positive integer (unix seconds); refusing to build a policy with no expiry.",
    );
  }

  const short = truncateAddress(contractAddress);
  const policyName = assertWithinPolicyNameLimit(
    name ?? `session: ${functions.map((f) => f.name).join("/")} on ${short}`,
    "Policy name",
  );

  const rules: SessionPolicyRule[] = functions.map((fn, index) => ({
    name: assertWithinPolicyNameLimit(
      `Allow ${fn.name}() on ${short}, 0 value, expires`,
      `Rule name ("rules[${index}].name")`,
    ),
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: contractAddress },
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        abi: [fn],
        operator: "eq",
        value: fn.name,
      },
      { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0x0" },
      {
        field_source: "system",
        field: "current_unix_timestamp",
        operator: "lte",
        value: String(expiresAtUnixSeconds),
      },
    ],
  }));

  return { version: "1.0", name: policyName, chain_type: "ethereum", rules };
}

/** The unsigned legacy transaction body Privy's `eth_signTransaction` takes (snake_case, hex quantities). */
export interface PrivyUnsignedTransaction {
  readonly to: Address;
  readonly data: Hex;
  readonly value: Hex;
  readonly chain_id: number;
  readonly type: 0;
  readonly nonce: number;
  readonly gas_limit: Hex;
  readonly gas_price: Hex;
}

/** What Privy's `signTransaction` returns, or just the raw hex. */
export type SignedTransactionLike = Hex | { signed_transaction: string };

/** Minimal viem client surface needed to broadcast. */
export interface BroadcastClient {
  sendRawTransaction(args: { serializedTransaction: Hex }): Promise<Hash>;
}

/** Minimal viem client surface needed to resolve nonce/gas and broadcast. */
export interface SignAndBroadcastClient extends BroadcastClient {
  getTransactionCount(args: { address: Address; blockTag: "pending" }): Promise<number>;
  estimateGas(args: { account: Address; to: Address; data: Hex; value: bigint }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
}

/** Estimate plus 20%: Nitro gas estimates can undershoot slightly. */
export function withGasLimitBuffer(estimatedGas: bigint): bigint {
  return estimatedGas + (estimatedGas * 20n) / 100n;
}

/**
 * Broadcast a raw signed transaction (from Privy `eth_signTransaction`) to
 * PEPU through a viem client and return the transaction hash. Accepts the raw
 * hex or Privy's `{ signed_transaction }` object. A failure here is a failed
 * TRANSACTION (revert, nonce race), not proof the session signer is gone.
 */
export async function broadcastSignedTransaction(
  client: BroadcastClient,
  signed: SignedTransactionLike,
): Promise<Hash> {
  const raw = typeof signed === "string" ? signed : signed.signed_transaction;
  if (!isHex(raw) || raw.length <= 2) {
    throw new Error("broadcastSignedTransaction: expected a 0x-prefixed hex signed transaction.");
  }
  return client.sendRawTransaction({ serializedTransaction: raw });
}

export interface SignAndBroadcastParams {
  client: SignAndBroadcastClient;
  /** The wallet that signs (the session-signer wallet's address). */
  from: Address;
  to: Address;
  /** Pre-encoded calldata, or use `abi` + `functionName` + `args`. */
  data?: Hex;
  abi?: Abi;
  functionName?: string;
  args?: readonly unknown[];
  /** Native value in wei. Default 0n. */
  value?: bigint;
  chainId: number;
  /**
   * Performs the signing, e.g. a call to
   * `privy.wallets().ethereum().signTransaction(walletId, { params: { transaction }, authorization_context })`
   * and returns its result. Injected so this package has no Privy dependency.
   */
  sign: (transaction: PrivyUnsignedTransaction) => Promise<SignedTransactionLike>;
}

/**
 * The full sign-with-Privy, broadcast-yourself flow: resolve nonce (pending),
 * gas (+20%) and gas price against PEPU's RPC, build the unsigned legacy
 * transaction, hand it to `sign`, then broadcast the result and return the hash.
 * Privy's server-side `eth_sendTransaction` rejects chain 97741, which is why
 * this exists.
 */
export async function signAndBroadcast(params: SignAndBroadcastParams): Promise<Hash> {
  const { client, from, to, chainId, sign } = params;
  const value = params.value ?? 0n;
  const data =
    params.data ??
    (params.abi && params.functionName
      ? encodeFunctionData({
          abi: params.abi,
          functionName: params.functionName,
          ...(params.args ? { args: params.args } : {}),
        } as Parameters<typeof encodeFunctionData>[0])
      : undefined);
  if (!data) {
    throw new Error("signAndBroadcast: provide `data`, or `abi` + `functionName`.");
  }

  const [nonce, estimatedGas, gasPrice] = await Promise.all([
    client.getTransactionCount({ address: from, blockTag: "pending" }),
    client.estimateGas({ account: from, to, data, value }),
    client.getGasPrice(),
  ]);

  const transaction: PrivyUnsignedTransaction = {
    to,
    data,
    value: toHex(value),
    chain_id: chainId,
    type: 0,
    nonce,
    gas_limit: toHex(withGasLimitBuffer(estimatedGas)),
    gas_price: toHex(gasPrice),
  };

  return broadcastSignedTransaction(client, await sign(transaction));
}

/** Default session length when `SESSION_DURATION_MINUTES` is unset or invalid. */
export const DEFAULT_SESSION_MINUTES = 15;
/** Upper bound for a session: 24 hours. Larger requests are clamped. */
export const MAX_SESSION_MINUTES = 1440;

/**
 * Parse a session duration (an env value or number) into minutes: anything
 * missing, non-numeric, zero or negative falls back to
 * {@link DEFAULT_SESSION_MINUTES}; anything above {@link MAX_SESSION_MINUTES} is clamped.
 * Lifted from templates/game-app/lib/env.server.ts.
 *
 * @example
 * resolveSessionMinutes(process.env.SESSION_DURATION_MINUTES); // 15 when unset
 * resolveSessionMinutes("99999"); // 1440
 */
export function resolveSessionMinutes(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return DEFAULT_SESSION_MINUTES;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SESSION_MINUTES;
  return Math.min(n, MAX_SESSION_MINUTES);
}

/**
 * The unix-seconds expiry for a session that starts at `nowSeconds` and lasts
 * `minutes`. Whole seconds, rounded down.
 *
 * @example
 * sessionExpiry(1_700_000_000, 15); // 1_700_000_900
 */
export function sessionExpiry(nowSeconds: number, minutes: number): number {
  return Math.floor(nowSeconds + minutes * 60);
}

/** One callable function in a session's scope, ready for a consent screen. */
export interface SessionScopeFunction {
  name: string;
  /** e.g. `tap()` or `transfer(address,uint256)`. */
  signature: string;
  /** 4-byte selector. */
  selector: Hex;
  /** Always `"0"`: a session call never carries native value. */
  valueWei: "0";
}

/** What a session may do, as plain data for a consent screen. */
export interface SessionScope {
  contractAddress: Address;
  functions: SessionScopeFunction[];
  expiresAtUnixSeconds: number;
}

/**
 * Consent-screen data for a session: the one contract, each allowed function
 * (name, signature, selector), zero value, and the expiry. Throws on an
 * invalid address or an empty or non-function list, same as {@link buildSessionPolicy}.
 *
 * @example
 * const scope = describeSessionScope({ contractAddress, functions: [tapAbi], expiresAtUnixSeconds });
 * scope.functions[0]?.signature; // "tap()"
 */
export function describeSessionScope(p: {
  contractAddress: Address;
  functions: readonly AbiFunction[];
  expiresAtUnixSeconds: number;
}): SessionScope {
  if (!isAddress(p.contractAddress, { strict: false })) {
    throw new PepuPolicyError("POLICY_UNSCOPED", "describeSessionScope: contractAddress must be a valid 0x address.");
  }
  if (p.functions.length === 0) {
    throw new PepuPolicyError("POLICY_UNSCOPED", "describeSessionScope: at least one function is required.");
  }
  return {
    contractAddress: p.contractAddress,
    expiresAtUnixSeconds: p.expiresAtUnixSeconds,
    functions: p.functions.map((fn) => {
      if (fn.type !== "function" || !fn.name) {
        throw new PepuPolicyError("POLICY_UNSCOPED", 
          "describeSessionScope: every entry in `functions` must be an ABI function fragment with a name.",
        );
      }
      return {
        name: fn.name,
        signature: toFunctionSignature(fn).replace(/^function /, ""),
        selector: toFunctionSelector(fn),
        valueWei: "0" as const,
      };
    }),
  };
}

/**
 * The mandatory honest statements about who enforces a session's limits. Show
 * the one for the mode in use on the consent screen. Adapted from
 * templates/game-app/components/session-consent-screen.tsx.
 *
 * @example
 * <p>{SESSION_TRUST_NOTICE["privy-offchain"]}</p>
 */
export const SESSION_TRUST_NOTICE: Record<"privy-offchain" | "kernel-onchain", string> = {
  "privy-offchain":
    "This scope is enforced by Privy's backend policy engine when it receives each transaction request, not by an on-chain contract. You are trusting Privy's policy engine and this app's policy configuration to enforce the limits correctly. Gas is paid by your wallet and is not capped by the policy.",
  "kernel-onchain":
    "This scope is enforced on-chain by your smart account's permission validator (call and timestamp policies). The limits hold even if this app's backend is compromised, but the session key can still act within them until it expires or you revoke it.",
};
