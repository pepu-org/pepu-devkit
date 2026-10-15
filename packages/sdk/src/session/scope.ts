import { toFunctionSelector, toFunctionSignature } from "viem";
import type { Abi, AbiFunction, Address, Hex } from "viem";

import { PepuPolicyError } from "../errors.js";

/**
 * Pure Kernel session helpers (scope types, consent-screen data, call-in-scope
 * check, approval parsing). They need only `viem`, so they load without any
 * `@zerodev/*` peer. Also re-exported from `@pepu-chain/sdk/session/kernel`.
 */

/** One function a session may call on one contract. */
export interface KernelSessionCall {
  target: Address;
  abi: Abi;
  functionName: string;
  /** Max native value per call, in wei. Default `0n`. */
  valueLimit?: bigint;
}

/** What a Kernel session allows, as plain data for a consent screen. */
export interface KernelSessionScope {
  calls: {
    target: Address;
    functionName: string;
    /** e.g. `tap()`. */
    signature: string;
    selector: Hex;
    /** Max value per call in wei, as a decimal string. */
    maxValueWei: string;
  }[];
  validAfter: number;
  validUntil: number;
}

export function findFunction(call: KernelSessionCall): AbiFunction {
  const fn = call.abi.find((item): item is AbiFunction => item.type === "function" && item.name === call.functionName);
  if (!fn) {
    throw new PepuPolicyError("POLICY_UNSCOPED", `The ABI has no function named "${call.functionName}".`);
  }
  return fn;
}

export function assertCalls(calls: readonly KernelSessionCall[]): void {
  if (calls.length === 0) {
    throw new PepuPolicyError("POLICY_UNSCOPED", "A session needs at least one allowed call.");
  }
  for (const c of calls) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(c.target)) {
      throw new PepuPolicyError("POLICY_UNSCOPED", "Every session call needs a valid 0x target address.");
    }
    findFunction(c);
  }
}

/**
 * Consent-screen data: each allowed call with its selector, the value limit
 * and the expiry. Pure.
 *
 * @example
 * const scope = describeKernelSessionScope({ calls, validUntil });
 * scope.calls[0]?.signature; // "tap()"
 */
export function describeKernelSessionScope(p: {
  calls: readonly KernelSessionCall[];
  validUntil: number;
  validAfter?: number;
}): KernelSessionScope {
  assertCalls(p.calls);
  return {
    calls: p.calls.map((c) => {
      const fn = findFunction(c);
      return {
        target: c.target,
        functionName: c.functionName,
        signature: toFunctionSignature(fn).replace(/^function /, ""),
        selector: toFunctionSelector(fn),
        maxValueWei: (c.valueLimit ?? 0n).toString(),
      };
    }),
    validAfter: p.validAfter ?? 0,
    validUntil: p.validUntil,
  };
}

/**
 * True when `call` (target plus 4-byte selector, value) is inside `scope`.
 * Used server-side to fail fast before sponsoring; the chain still enforces
 * the real limit. Pure.
 *
 * @example
 * isCallInScope(scope, { to, data, value: 0n });
 */
export function isCallInScope(
  scope: Pick<KernelSessionScope, "calls">,
  call: { to: Address; data: Hex; value?: bigint },
): boolean {
  const selector = call.data.slice(0, 10).toLowerCase();
  return scope.calls.some(
    (c) =>
      c.target.toLowerCase() === call.to.toLowerCase() &&
      c.selector.toLowerCase() === selector &&
      (call.value ?? 0n) <= BigInt(c.maxValueWei),
  );
}

/** Parsed fields of an `approval` string. */
export interface ParsedApproval {
  permissionId: string | null;
  accountAddress: string | null;
  isPreInstalled: boolean | null;
  hasPrivateKey: boolean;
}

function decodeBase64Json(text: string): unknown {
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Parse a serialized approval (base64 JSON from `serializePermissionAccount`)
 * without trusting it. Returns `null` when it is not an approval at all.
 *
 * @example
 * parseApproval(approval)?.permissionId;
 */
export function parseApproval(approval: string): ParsedApproval | null {
  try {
    const json = decodeBase64Json(approval);
    if (typeof json !== "object" || json === null) return null;
    const record = json as Record<string, unknown>;
    const permissionParams = record.permissionParams as { permissionId?: unknown } | undefined;
    const accountParams = record.accountParams as { accountAddress?: unknown } | undefined;
    return {
      permissionId: typeof permissionParams?.permissionId === "string" ? permissionParams.permissionId : null,
      accountAddress: typeof accountParams?.accountAddress === "string" ? accountParams.accountAddress : null,
      isPreInstalled: typeof record.isPreInstalled === "boolean" ? record.isPreInstalled : null,
      hasPrivateKey: typeof record.privateKey === "string" && record.privateKey.length > 0,
    };
  } catch {
    return null;
  }
}

/** Result of {@link checkApproval}. */
export type ApprovalCheck = { ok: true } | { ok: false; reason: string };

/**
 * Check a browser-supplied approval before the server stores it. It rejects a
 * payload that carries a private key, is not an enable-mode grant, is for
 * another account, or whose permission id differs from the one this server
 * issued (so scope, session key or expiry changed). The approval is untrusted
 * input; the chain enforces the real limits regardless.
 *
 * @example
 * const check = checkApproval(approval, { kernelAddress, permissionId });
 * if (!check.ok) console.log(check.reason);
 */
export function checkApproval(
  approval: string,
  expected: { kernelAddress: Address; permissionId: string },
): ApprovalCheck {
  if (approval.length === 0 || approval.length > 20_000) {
    return { ok: false, reason: "Approval has an unexpected size." };
  }
  const parsed = parseApproval(approval);
  if (!parsed) return { ok: false, reason: "Approval is not a valid session approval." };
  if (parsed.hasPrivateKey) return { ok: false, reason: "Approval must not contain a private key." };
  if (parsed.isPreInstalled !== false) return { ok: false, reason: "Approval must be an enable-mode grant." };
  if (parsed.accountAddress?.toLowerCase() !== expected.kernelAddress.toLowerCase()) {
    return { ok: false, reason: "Approval is for a different smart account than yours." };
  }
  if (parsed.permissionId?.toLowerCase() !== expected.permissionId.toLowerCase()) {
    return { ok: false, reason: "Approval does not match the scope, session key or expiry this server issued." };
  }
  return { ok: true };
}

