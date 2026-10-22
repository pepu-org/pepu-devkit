# /session/kernel

`@pepu-chain/sdk/session/kernel` is the **on-chain** session key: a ZeroDev Kernel permission whose scope is enforced by policy contracts during UserOperation validation. A UserOperation outside the scope is rejected by the EntryPoint itself, whoever relays it and whatever your backend does. Most apps use [/combo](combo.md), which wires these primitives to routes and hooks. Use this page when you build a custom flow.

Pinned to call policy v0.0.4 because v0.0.5 is not deployed on PEPU.

## Import, peers and boundary

| Item | Value |
|---|---|
| Import | `@pepu-chain/sdk/session/kernel` |
| Server or client | Mixed by function. `approveKernelSession` runs in the browser. `generateSessionKey` and `loadKernelSessionAccount` are **server only** by contract: the session private key must never reach a browser. The module itself has no server-only guard |
| Peer dependencies | `@zerodev/sdk` `^5.5.0`, `@zerodev/permissions` `^5.6.0`, `@zerodev/ecdsa-validator` `^5.4.0`, `viem` |
| Avoid the peers | Import the pure helpers from [/session](session.md) instead |

## Exports

| Export | Signature | Server or client | What it abstracts |
|---|---|---|---|
| `buildKernelSessionPolicies` | `(p: { calls: readonly KernelSessionCall[]; validUntil: number; validAfter?: number }) => Policy[]` | Both | Call policy v0.0.4 plus the timestamp policy. Pure and deterministic |
| `generateSessionKey` | `() => { privateKey: Hex; address: Address }` | Server | A fresh random key. Send only the address to the owner |
| `expectedPermissionId` | `(p: { publicClient; sessionKeyAddress; policies }) => Promise<string>` | Server | The permission id the chain derives, to compare with the browser's approval |
| `approveKernelSession` | `(p: { publicClient; owner: KernelOwner; sessionKeyAddress; policies }) => Promise<{ approval: string; kernelAddress: Address }>` | Browser | The owner signs ONE EIP-712 message. The `approval` holds no secret |
| `loadKernelSessionAccount` | `(p: { publicClient; approval: string; sessionPrivateKey: Hex }) => Promise<KernelSmartAccount>` | Server | Rebuilds the session's Kernel account. Pass it to `createPepuSponsoredClient` |
| `describeKernelSessionScope` | `(p: { calls; validUntil; validAfter? }) => KernelSessionScope` | Both | Consent-screen data: target, function, signature, selector, max value |
| `isCallInScope` | `(scope, call: { to; data; value? }) => boolean` | Both | Fail-fast check before sponsoring. The chain enforces the real limit |
| `parseApproval`, `checkApproval` | `(approval) => ParsedApproval \| null`, `(approval, { kernelAddress, permissionId }) => ApprovalCheck` | Server | Reject an approval that carries a private key, is for another account, or whose permission id differs from the one issued |
| `createMemoryStore`, `isLive` | `() => SessionStore`, `(record, nowSeconds) => boolean` | Server | Dev-grade store and the liveness test |
| `SessionStore`, `SessionRecord` | interfaces | Server | `get`, `set`, `delete`, `tryLock`, `unlock`. Implement on a database with the session key encrypted at rest |
| `KernelSessionCall` | `{ target: Address; abi: Abi; functionName: string; valueLimit?: bigint }` | Both | One function a session may call. Default value limit `0n` |
| `CALL_POLICY_V0_0_4_ADDRESS`, `TIMESTAMP_POLICY_ADDRESS` | addresses | Both | `0x9a52283276A0ec8740DF50bF01B28A80D880eaf2` and `0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F` |
| `SESSION_GAS_RESERVATION_PEPU` | `{ firstOperation: 20.5, laterOperation: 6.9 }` | Both | Worst-case gas the paymaster reserves per operation. Size spend caps above these |
| `KERNEL_VERSION`, `getKernelAddress`, `KernelOwner`, `KernelSmartAccount` | re-exported from `/aa/kernel` | | |

## Errors

| Code | Where |
|---|---|
| `POLICY_UNSCOPED` | A scope with no calls or a call outside it |
| `SESSION_APPROVAL_MISMATCH` | Raised by the `/combo` routes when `checkApproval` fails |
| `SESSION_EXPIRED`, `SESSION_NONE` | Raised by the `/combo` routes for an expired offer or no live session |

`checkApproval` returns `{ ok: false, reason }` and does not throw.

## Example

```ts
// Pillar 2 (Kernel mode), the low-level primitives behind /combo.
// Most apps use createSponsoredSessionRoutes instead (see combo-server.ts).
// See docs/sdk/session-kernel.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import {
  approveKernelSession,
  buildKernelSessionPolicies,
  checkApproval,
  describeKernelSessionScope,
  expectedPermissionId,
  generateSessionKey,
  isCallInScope,
  loadKernelSessionAccount,
} from "@pepu-chain/sdk/session/kernel";
import type { KernelOwner, KernelSessionCall } from "@pepu-chain/sdk/session/kernel";
import { encodeFunctionData } from "viem";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

const publicClient = getPublicClient(pepuMainnet);

const calls: KernelSessionCall[] = [{ target: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }];
const validUntil = Math.floor(Date.now() / 1000) + 15 * 60;

// --- SERVER: create the session key. The private key never leaves the server. ---
export const sessionKey = generateSessionKey();
export const policies = buildKernelSessionPolicies({ calls, validUntil });

// Consent-screen data, plain JSON.
export const scope = describeKernelSessionScope({ calls, validUntil });

// --- BROWSER: the owner signs ONE EIP-712 message. No gas, no private key leaves the wallet. ---
export function grant(owner: KernelOwner) {
  return approveKernelSession({ publicClient, owner, sessionKeyAddress: sessionKey.address, policies });
}

// --- SERVER: verify the approval before storing it, then act with the session key. ---
export async function activate(approval: string, kernelAddress: `0x${string}`) {
  const permissionId = await expectedPermissionId({ publicClient, sessionKeyAddress: sessionKey.address, policies });
  const check = checkApproval(approval, { kernelAddress, permissionId });
  if (!check.ok) throw new Error(check.reason);
  return loadKernelSessionAccount({ publicClient, approval, sessionPrivateKey: sessionKey.privateKey });
}

// Pure, fails fast before sponsoring. The chain enforces the real limit.
export const tapIsAllowed = isCallInScope(scope, {
  to: TAPSCORE_ADDRESS,
  data: encodeFunctionData({ abi: tapScoreAbi, functionName: "tap" }),
  value: 0n,
});
```

Source: `docs/snippets/session-kernel.ts`, type-checked against the SDK.

## What the chain enforces

- **Call policy v0.0.4:** only the listed targets and function selectors, with native value at most `valueLimit`.
- **Timestamp policy:** the permission is invalid outside `validAfter` to `validUntil`.
- Revoking server-side deletes the session key and approval at once. The on-chain grant stays valid until its expiry, but only the deleted key could use it and only within the scope.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Sponsorship denied with a spend-cap message right after the first action | Caps below the reserved worst case | Size caps above `SESSION_GAS_RESERVATION_PEPU` |
| `SESSION_APPROVAL_MISMATCH` | The browser built different policies than the server issued | Share one `scope` object between server and browser |
| A production store loses sessions | `createMemoryStore` is lost on restart and not shared across instances | Implement `SessionStore` on a database and encrypt `sessionPrivateKey` |

## Related

- [Session Keys: No Popup Per Transaction](../onboarding/session-keys.md)
- [/combo](combo.md), [/aa](aa.md)
- [EntryPoints and Kernel](../contracts/entrypoints-and-kernel.md)
