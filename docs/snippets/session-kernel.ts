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
