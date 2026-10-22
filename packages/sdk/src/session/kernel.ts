import { deserializePermissionAccount, serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
import type { Policy } from "@zerodev/permissions";
import { CallPolicyVersion, toCallPolicy, toTimestampPolicy } from "@zerodev/permissions/policies";
import { toECDSASigner, toEmptyECDSASigner } from "@zerodev/permissions/signers";
import type { createKernelAccount } from "@zerodev/sdk";
import type { Abi, Address, Hex, PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ENTRY_POINT_V07 } from "../aa/clients.js";
import { KERNEL_VERSION, toPepuKernelAccount } from "../aa/kernel.js";
import type { KernelOwner, KernelSmartAccount } from "../aa/kernel.js";
import { assertCalls, findFunction } from "./scope.js";
import type { KernelSessionCall } from "./scope.js";

export { KERNEL_VERSION, getKernelAddress } from "../aa/kernel.js";
export type { KernelOwner, KernelSmartAccount } from "../aa/kernel.js";
export { createMemoryStore, isLive } from "./store.js";
export type { SessionRecord, SessionStore } from "./store.js";
export { checkApproval, describeKernelSessionScope, isCallInScope, parseApproval } from "./scope.js";
export type { ApprovalCheck, KernelSessionCall, KernelSessionScope, ParsedApproval } from "./scope.js";

/**
 * `@pepu-chain/sdk/session/kernel`: on-chain session keys with ZeroDev Kernel
 * permissions. Extracted from templates/sponsored-session-app/lib/{kernel,
 * session-policy,approval}.ts and built on `toPepuKernelAccount`
 * (`plugins.regular`).
 *
 * The scope is enforced ON-CHAIN by ZeroDev's policy contracts, which the
 * user's Kernel account calls during UserOperation validation:
 *
 * - Call policy v0.0.4: only the listed targets and function selectors, with a
 *   native value no larger than `valueLimit` (default 0).
 * - Timestamp policy: the permission is invalid outside `validAfter`..`validUntil`.
 *
 * A UserOperation outside this scope is rejected by the EntryPoint itself, no
 * matter who relays it or what the app backend does.
 *
 * Deployed on PEPU mainnet (eth_getCode verified 2026-10-02): Kernel v3.1
 * factory 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419, ECDSA validator
 * 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57, ECDSA signer module
 * 0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF, call policy v0.0.4 and the
 * timestamp policy below. Call policy v0.0.5 is NOT deployed on PEPU, so the
 * version is pinned.
 *
 * Optional peers: `@zerodev/sdk`, `@zerodev/permissions`, `@zerodev/ecdsa-validator`.
 */

/** Call policy v0.0.4. Pinned: v0.0.5 is not deployed on PEPU mainnet. */
export const CALL_POLICY_V0_0_4_ADDRESS: Address = "0x9a52283276A0ec8740DF50bF01B28A80D880eaf2";
/** ZeroDev timestamp policy on PEPU mainnet. */
export const TIMESTAMP_POLICY_ADDRESS: Address = "0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F";

/**
 * Worst-case gas the paymaster policy service RESERVES per sponsored operation,
 * measured on PEPU mainnet with the sponsored-session-app template: the first
 * operation of a session (account deploy plus enabling the permission) about
 * 20.5 PEPU, later operations about 6.9 PEPU. The real first-session cost was
 * about 12.8 PEPU for two operations. Size per-user hourly and daily spend
 * caps above these, or users hit `trailing-hour spend ... would exceed cap`
 * after their first action.
 */
export const SESSION_GAS_RESERVATION_PEPU = { firstOperation: 20.5, laterOperation: 6.9 } as const;

type ZeroDevClient = Parameters<typeof createKernelAccount>[0];

/** Type-level bridge for ZeroDev's own viem copy (same object at runtime). */
function zd(client: PublicClient): ZeroDevClient {
  return client as unknown as ZeroDevClient;
}

/**
 * The on-chain policies for one session: call policy v0.0.4 plus the timestamp
 * policy. Pure and deterministic given its input. Only the named function
 * fragments go into the policy, which keeps the grant small.
 *
 * @example
 * const policies = buildKernelSessionPolicies({
 *   calls: [{ target: tapScore, abi: tapScoreAbi, functionName: "tap" }],
 *   validUntil: Math.floor(Date.now() / 1000) + 900,
 * });
 */
export function buildKernelSessionPolicies(p: {
  calls: readonly KernelSessionCall[];
  validUntil: number;
  validAfter?: number;
}): Policy[] {
  assertCalls(p.calls);
  return [
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_4,
      permissions: p.calls.map((c) => ({
        target: c.target,
        valueLimit: c.valueLimit ?? 0n,
        abi: [findFunction(c)] as Abi,
        functionName: c.functionName,
      })),
    } as Parameters<typeof toCallPolicy>[0]),
    toTimestampPolicy({ validAfter: p.validAfter ?? 0, validUntil: p.validUntil }),
  ];
}

/**
 * A fresh random session key. SERVER ONLY: the private key must never reach
 * the browser. Only the address is sent to the owner for approval.
 *
 * @example
 * const { privateKey, address } = generateSessionKey();
 */
export function generateSessionKey(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

function permissionFor(publicClient: PublicClient, sessionKeyAddress: Address, policies: Policy[]) {
  return toPermissionValidator(zd(publicClient), {
    entryPoint: ENTRY_POINT_V07,
    kernelVersion: KERNEL_VERSION,
    signer: toEmptyECDSASigner(sessionKeyAddress),
    policies,
  });
}

/**
 * The permission id the chain derives for this session key plus these
 * policies. The server compares it with a browser-supplied approval.
 *
 * @example
 * const permissionId = await expectedPermissionId({ publicClient, sessionKeyAddress, policies });
 */
export async function expectedPermissionId(p: {
  publicClient: PublicClient;
  sessionKeyAddress: Address;
  policies: Policy[];
}): Promise<string> {
  const permission = await permissionFor(p.publicClient, p.sessionKeyAddress, p.policies);
  const { permissionId } = permission.getPluginSerializationParams();
  if (!permissionId) throw new Error("Could not derive the permission id.");
  return permissionId;
}

/**
 * In the user's browser: the owner (the Privy embedded wallet, the only thing
 * that can authorize a session) signs ONE EIP-712 message that enables a
 * permission validator on their Kernel account. That signature is the whole
 * grant. It names the session key's public address (never its private key)
 * and the policies. The returned `approval` holds no secret: it is the enable
 * signature plus the policy parameters, useless without the session key.
 *
 * @example
 * const { approval, kernelAddress } = await approveKernelSession({
 *   publicClient, owner: walletClient, sessionKeyAddress, policies,
 * });
 */
export async function approveKernelSession(p: {
  publicClient: PublicClient;
  owner: KernelOwner;
  sessionKeyAddress: Address;
  policies: Policy[];
}): Promise<{ approval: string; kernelAddress: Address }> {
  const regular = await permissionFor(p.publicClient, p.sessionKeyAddress, p.policies);
  const account = await toPepuKernelAccount({
    publicClient: p.publicClient,
    owner: p.owner,
    plugins: { regular },
  });
  const approval = await serializePermissionAccount(account as never);
  return { approval, kernelAddress: account.address };
}

/**
 * On the server: rebuild the session's Kernel account from the approval and
 * the server-held session key (an ECDSA signer for that key). No owner
 * signature is involved. Pass the result to `createPepuSponsoredClient`.
 *
 * @example
 * const account = await loadKernelSessionAccount({ publicClient, approval, sessionPrivateKey });
 */
export async function loadKernelSessionAccount(p: {
  publicClient: PublicClient;
  approval: string;
  sessionPrivateKey: Hex;
}): Promise<KernelSmartAccount> {
  const sessionSigner = await toECDSASigner({ signer: privateKeyToAccount(p.sessionPrivateKey) });
  const account = await deserializePermissionAccount(
    zd(p.publicClient),
    ENTRY_POINT_V07,
    KERNEL_VERSION,
    p.approval,
    sessionSigner,
  );
  return account as unknown as KernelSmartAccount;
}
