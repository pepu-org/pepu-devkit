/**
 * Request validation for POST /sponsor. UserOp numeric fields are accepted
 * as 0x-prefixed hex strings, matching the ERC-4337 JSON-RPC convention
 * (`eth_sendUserOperation` etc.) bundlers and clients already use — this
 * service is a drop-in step in that pipeline, not a bespoke format.
 */
import { z } from "zod";
import type { SponsorUserOperationInput } from "./types.js";

// Exported so paymasterRpc.ts's ERC-7677 adapter can build the SAME
// per-field validation on top of (`.extend()`) rather than re-declaring it —
// the wire format differs (JSON-RPC positional params vs. a REST body), the
// per-field hex/bigint rules must not drift between the two entry points.
export const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");
export const hexBytes = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "expected 0x-prefixed even-length hex");
export const hexQuantity = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "expected a 0x-prefixed hex quantity")
  .transform((value) => BigInt(value));

export const userOpSchema = z.object({
  sender: hexAddress,
  nonce: hexQuantity,
  factory: hexAddress.optional(),
  factoryData: hexBytes.optional(),
  callData: hexBytes,
  callGasLimit: hexQuantity,
  verificationGasLimit: hexQuantity,
  preVerificationGas: hexQuantity,
  maxFeePerGas: hexQuantity,
  maxPriorityFeePerGas: hexQuantity,
});

export const sponsorRequestSchema = z.object({
  userOp: userOpSchema,
});

export type ParsedSponsorRequest = {
  userOp: SponsorUserOperationInput;
};

export function parseSponsorRequestBody(body: unknown): ParsedSponsorRequest {
  const parsed = sponsorRequestSchema.parse(body);
  return {
    userOp: {
      sender: parsed.userOp.sender as `0x${string}`,
      nonce: parsed.userOp.nonce,
      factory: parsed.userOp.factory as `0x${string}` | undefined,
      factoryData: parsed.userOp.factoryData as `0x${string}` | undefined,
      callData: parsed.userOp.callData as `0x${string}`,
      callGasLimit: parsed.userOp.callGasLimit,
      verificationGasLimit: parsed.userOp.verificationGasLimit,
      preVerificationGas: parsed.userOp.preVerificationGas,
      maxFeePerGas: parsed.userOp.maxFeePerGas,
      maxPriorityFeePerGas: parsed.userOp.maxPriorityFeePerGas,
    },
  };
}
