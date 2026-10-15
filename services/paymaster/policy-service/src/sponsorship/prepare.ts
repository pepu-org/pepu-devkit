/**
 * Encodes transaction requests for the project owner's WALLET to sign and send. The API never holds keys and never
 * sends deposits itself (there are no withdrawals anywhere); it only returns `{ chainId, to, data, value }` (plus a human description) so a
 * frontend can pass it straight to `wallet.sendTransaction`. A frontend may equally build these itself from
 * `GET /v2/contract` (address + ABI): this is a convenience, not a gate.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { z } from "zod";
import { PEPU_SPONSORED_PAYMASTER_ABI } from "./abi.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex id");
const U112_MAX = (1n << 112n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

function wei(max: bigint) {
  return z
    .string()
    .regex(/^[0-9]+$/, "expected a non-negative integer string (wei)")
    .transform((v) => BigInt(v))
    .refine((v) => v <= max, "amount out of range");
}

const targets = z.array(address).max(50);

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "expected 0x-prefixed hex");
const uint = z.string().regex(/^[0-9]+$/, "expected a non-negative integer string").transform((v) => BigInt(v));

/** The signer attestation returned by POST /v2/projects/verify (passed back verbatim). */
const attestation = z.object({
  appId: z.string().min(1).max(128),
  newOwner: address,
  nonce: uint,
  deadline: uint,
  signature: hex,
});

export const prepareRequestSchema = z.discriminatedUnion("action", [
  // First claim of a project with a signer attestation (from POST /v2/projects/verify). The claim sets NO configuration
  // (the attestation cannot bind caller-chosen settings, delta review L2): configure with setTargets/setDailyLimit/
  // setSenderDailyLimit afterwards. Unknown fields (the old targets/limits) are rejected rather than silently dropped.
  z.object({ action: z.literal("claimProject"), attestation }).strict(),
  // Timelocked re-claim of an already-owned project (attestation as above).
  z.object({ action: z.literal("reclaimProject"), attestation }),
  z.object({ action: z.literal("executeReclaim"), projectId: bytes32 }),
  z.object({ action: z.literal("cancelReclaim"), projectId: bytes32 }),
  // Deposits are one-way and open to anyone (no owner check, project may be unclaimed).
  z.object({ action: z.literal("depositFor"), projectId: bytes32, amountWei: wei(U128_MAX).refine((v) => v > 0n, "amount must be > 0") }),
  z.object({ action: z.literal("setTargets"), projectId: bytes32, targets, allowed: z.boolean() }),
  z.object({ action: z.literal("setDailyLimit"), projectId: bytes32, limitWei: wei(U112_MAX).refine((v) => v > 0n, "limitWei must be > 0") }),
  z.object({ action: z.literal("setSenderDailyLimit"), projectId: bytes32, limitWei: wei(U112_MAX).refine((v) => v > 0n, "limitWei must be > 0") }),
  z.object({ action: z.literal("setPaused"), projectId: bytes32, paused: z.boolean() }),
  z.object({ action: z.literal("proposeProjectOwner"), projectId: bytes32, newOwner: address }),
  z.object({ action: z.literal("acceptProjectOwnership"), projectId: bytes32 }),
]);

export type PrepareRequest = z.infer<typeof prepareRequestSchema>;

export interface PreparedTx {
  chainId: number;
  to: Address;
  data: Hex;
  /** Decimal wei string (the wallet sends this as the transaction value). */
  value: string;
  function: string;
  description: string;
}

/** Actions whose on-chain function is owner-gated (the API pre-checks the session address against the chain owner). */
export function actionNeedsOwner(action: PrepareRequest["action"]): boolean {
  return action === "cancelReclaim" || action === "setTargets" || action === "setDailyLimit" || action === "setSenderDailyLimit" || action === "setPaused" || action === "proposeProjectOwner";
}

export function prepareTransaction(req: PrepareRequest, ctx: { paymaster: Address; chainId: number; sessionAddress: Address }): PreparedTx {
  const base = { chainId: ctx.chainId, to: ctx.paymaster };
  const abi = PEPU_SPONSORED_PAYMASTER_ABI;
  switch (req.action) {
    case "claimProject": {
      const a = req.attestation;
      return {
        ...base,
        data: encodeFunctionData({
          abi,
          functionName: "claimProject",
          args: [{ appId: a.appId, newOwner: a.newOwner as Address, nonce: a.nonce, deadline: a.deadline, signature: a.signature as Hex }],
        }),
        value: "0",
        function: "claimProject((string,address,uint256,uint256,bytes))",
        description: `Claim "${a.appId}" for ${a.newOwner} (attested). A project that holds no funds is claimed immediately; a project that already holds deposited funds is PENDING for the on-chain admin change delay (at least 48h, event ProjectClaimProposed): finish it with executeReclaim, the contract owner or manager can cancel it. The claim sets no allowlist or limits: once you own the project call setTargets, setDailyLimit and setSenderDailyLimit; nothing is sponsorable until you do. Anyone may submit this transaction; the attestation fixes the owner.`,
      };
    }
    case "reclaimProject": {
      const a = req.attestation;
      return {
        ...base,
        data: encodeFunctionData({ abi, functionName: "reclaimProject", args: [{ appId: a.appId, newOwner: a.newOwner as Address, nonce: a.nonce, deadline: a.deadline, signature: a.signature as Hex }] }),
        value: "0",
        function: "reclaimProject((string,address,uint256,uint256,bytes))",
        description: `Start a re-claim of "${a.appId}" by ${a.newOwner}. It takes effect only after the on-chain admin change delay (at least 48h) via executeReclaim (and expires 30 days after that). The current owner can cancel it ONCE per new owner: a second attested re-claim by the same new owner cannot be cancelled.`,
      };
    }
    case "executeReclaim":
      return { ...base, data: encodeFunctionData({ abi, functionName: "executeReclaim", args: [req.projectId as Hex] }), value: "0", function: "executeReclaim(bytes32)", description: "Complete a pending claim or re-claim once its delay has passed and before it expires (anyone may call)." };
    case "cancelReclaim":
      return { ...base, data: encodeFunctionData({ abi, functionName: "cancelReclaim", args: [req.projectId as Hex] }), value: "0", function: "cancelReclaim(bytes32)", description: "Cancel the pending re-claim (current owner only, once per new owner). A pending FIRST claim of an unowned project is cancelled by the contract owner or manager instead." };
    case "depositFor":
      return { ...base, data: encodeFunctionData({ abi, functionName: "depositFor", args: [req.projectId as Hex] }), value: req.amountWei.toString(), function: "depositFor(bytes32)", description: `Deposit ${req.amountWei} wei to project ${req.projectId}. ONE-WAY: nothing can ever withdraw it; it can only pay gas for the project's sponsored operations, under the owner's settings.` };
    case "setTargets":
      return { ...base, data: encodeFunctionData({ abi, functionName: "setTargets", args: [req.projectId as Hex, req.targets as Address[], req.allowed] }), value: "0", function: "setTargets(bytes32,address[],bool)", description: `${req.allowed ? "Allow" : "Disallow"} ${req.targets.length} destination contract(s).` };
    case "setDailyLimit":
      return { ...base, data: encodeFunctionData({ abi, functionName: "setDailyLimit", args: [req.projectId as Hex, req.limitWei] }), value: "0", function: "setDailyLimit(bytes32,uint112)", description: `Set the on-chain daily spend limit to ${req.limitWei} wei.` };
    case "setSenderDailyLimit":
      return { ...base, data: encodeFunctionData({ abi, functionName: "setSenderDailyLimit", args: [req.projectId as Hex, req.limitWei] }), value: "0", function: "setSenderDailyLimit(bytes32,uint112)", description: `Set the on-chain per-wallet daily limit to ${req.limitWei} wei.` };
    case "setPaused":
      return { ...base, data: encodeFunctionData({ abi, functionName: "setPaused", args: [req.projectId as Hex, req.paused] }), value: "0", function: "setPaused(bytes32,bool)", description: req.paused ? "Pause sponsorship for this project (immediate)." : "Resume sponsorship for this project." };
    case "proposeProjectOwner":
      return { ...base, data: encodeFunctionData({ abi, functionName: "proposeProjectOwner", args: [req.projectId as Hex, req.newOwner as Address] }), value: "0", function: "proposeProjectOwner(bytes32,address)", description: req.newOwner.toLowerCase() === "0x0000000000000000000000000000000000000000" ? "Withdraw the pending ownership nomination." : `Propose ${req.newOwner} as the new owner (they must accept).` };
    case "acceptProjectOwnership":
      return { ...base, data: encodeFunctionData({ abi, functionName: "acceptProjectOwnership", args: [req.projectId as Hex] }), value: "0", function: "acceptProjectOwnership(bytes32)", description: "Accept ownership of the project." };
  }
}
