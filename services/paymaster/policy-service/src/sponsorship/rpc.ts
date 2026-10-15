/**
 * ERC-7677 JSON-RPC surface for the v2 paymaster (`POST /v2/paymaster/:appToken`). Same two methods as v1's
 * adapter (src/paymasterRpc.ts, untouched), different engine and layout:
 *
 *  - `pm_getPaymasterStubData`: dummy signature in the REAL v2 layout (same length, so preVerificationGas estimates
 *    match). If the URL token resolves to an on-chain project the stub carries its sponsorId, otherwise the free
 *    pool id. The contract returns SIG_VALIDATION_FAILED without touching state for a non-signer, so a stub can never
 *    be exchanged for sponsorship. No policy runs, nothing is recorded.
 *  - `pm_getPaymasterData`: runs `SponsorshipEngine.evaluate`. The optional ERC-7677 `context` (params[3]) may carry
 *    `privyAccessToken`, which is REQUIRED for the chain free tier (verified Privy account only; SPEC section 7).
 *    Project budgets need no identity but are bound to the project's allowed Origins when a client token is used.
 */
import { concatHex, numberToHex, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, sign as signRawHash } from "viem/accounts";
import { ZodError, z } from "zod";
import { JSON_RPC_ERROR_CODES, type JsonRpcResponse } from "../paymasterRpc.js";
import { hexAddress, hexBytes, userOpSchema } from "../requestSchema.js";
import { computeValidityWindow } from "../paymasterData.js";
import type { SponsorUserOperationInput } from "../types.js";
import type { SponsorshipDb } from "./db.js";
import type { SponsorshipEngine } from "./engine.js";
import { FREE_POOL_ID, buildSponsoredPaymasterData } from "./paymasterData.js";

export const V2_RPC_METHODS = ["pm_getPaymasterStubData", "pm_getPaymasterData"] as const;

export interface V2RpcConfig {
  engine: Pick<SponsorshipEngine, "evaluate">;
  db: Pick<SponsorshipDb, "resolveCredential">;
  entryPointAddress: Address;
  chainId: number;
  paymasterAddress: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  validityWindowSeconds: number;
}

class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fullUserOp = userOpSchema.extend({ signature: hexBytes.optional() });
const stubUserOp = z.object({ sender: hexAddress }).passthrough();

function parseChainId(v: unknown): number {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(v)) return Number(BigInt(v));
    if (/^[0-9]+$/.test(v)) return Number(v);
  }
  throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, "Invalid params: chainId must be a hex quantity or decimal.");
}

function envelope(params: unknown, cfg: V2RpcConfig): { rawUserOp: unknown; context: unknown } {
  if (!Array.isArray(params) || params.length < 3) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, "Invalid params: expected [userOp, entryPoint, chainId, context?].");
  }
  let ep: string;
  try {
    ep = hexAddress.parse(params[1]);
  } catch {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, "Invalid params: entryPoint.");
  }
  if (ep.toLowerCase() !== cfg.entryPointAddress.toLowerCase()) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `Invalid params: entryPoint ${ep} is not supported; expected ${cfg.entryPointAddress}.`);
  }
  if (parseChainId(params[2]) !== cfg.chainId) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `Invalid params: chainId is not supported; expected ${cfg.chainId}.`);
  }
  return { rawUserOp: params[0], context: params[3] };
}

async function stub(params: unknown, cfg: V2RpcConfig, appToken: string): Promise<Record<string, unknown>> {
  const env = envelope(params, cfg);
  try {
    stubUserOp.parse(env.rawUserOp);
  } catch (e) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `Invalid params: userOp - ${e instanceof ZodError ? e.message : String(e)}`);
  }
  const project = cfg.db.resolveCredential(appToken)?.project;
  const sponsorId = project?.status === "active" && project.projectId ? project.projectId : FREE_POOL_ID;
  const sig = await signRawHash({ hash: `0x${"00".repeat(32)}` as Hex, privateKey: generatePrivateKey() });
  const v = sig.yParity !== undefined ? sig.yParity + 27 : Number(sig.v);
  const dummy = concatHex([sig.r, sig.s, toHex(v, { size: 1 })]);
  return {
    paymaster: cfg.paymasterAddress,
    paymasterData: buildSponsoredPaymasterData(computeValidityWindow(cfg.validityWindowSeconds), sponsorId, dummy),
    paymasterVerificationGasLimit: numberToHex(cfg.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: numberToHex(cfg.paymasterPostOpGasLimit),
    isFinal: false,
  };
}

async function data(params: unknown, cfg: V2RpcConfig, appToken: string, origin: string | null, clientIp: string | null): Promise<Record<string, unknown>> {
  const env = envelope(params, cfg);
  let parsed: z.infer<typeof fullUserOp>;
  try {
    parsed = fullUserOp.parse(env.rawUserOp);
  } catch (e) {
    throw new RpcError(JSON_RPC_ERROR_CODES.invalidParams, `Invalid params: userOp - ${e instanceof ZodError ? e.message : String(e)}`);
  }
  const userOp: SponsorUserOperationInput = {
    sender: parsed.sender as Address,
    nonce: parsed.nonce,
    factory: parsed.factory as Address | undefined,
    factoryData: parsed.factoryData as Hex | undefined,
    callData: parsed.callData as Hex,
    callGasLimit: parsed.callGasLimit,
    verificationGasLimit: parsed.verificationGasLimit,
    preVerificationGas: parsed.preVerificationGas,
    maxFeePerGas: parsed.maxFeePerGas,
    maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
  };
  const privyToken = isObj(env.context) && typeof env.context.privyAccessToken === "string" ? env.context.privyAccessToken : null;
  const result = await cfg.engine.evaluate({ appToken, origin, clientIp, privyToken, userOp });
  if (result.status === "denied") {
    // the engine enforces the deployment switch (review 3, L-5); keep this route's established JSON-RPC error shape
    if (result.reason === "account_deployment_disabled") {
      throw new RpcError(JSON_RPC_ERROR_CODES.accountDeploymentDisabled, "Sponsorship of new-account deployment is disabled on this endpoint.", { reason: "account_deployment_disabled_on_public_endpoint" });
    }
    throw new RpcError(JSON_RPC_ERROR_CODES.sponsorshipDenied, `Sponsorship denied: ${result.message}`, { reason: result.reason, detail: result.detail });
  }
  return {
    paymaster: result.paymaster,
    paymasterData: result.paymasterData,
    paymasterVerificationGasLimit: result.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: result.paymasterPostOpGasLimit,
  };
}

export async function handleV2RpcRequest(raw: unknown, cfg: V2RpcConfig, appToken: string, origin: string | null = null, clientIp: string | null = null): Promise<JsonRpcResponse> {
  const id = isObj(raw) ? (raw.id ?? null) : null;
  try {
    if (!isObj(raw)) throw new RpcError(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid Request.");
    const { method, params } = raw;
    if (typeof method !== "string") throw new RpcError(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid Request: method must be a string.");
    if (!(V2_RPC_METHODS as readonly string[]).includes(method)) {
      throw new RpcError(JSON_RPC_ERROR_CODES.methodNotFound, `Method not found: "${method}". Supported: ${V2_RPC_METHODS.join(", ")}.`);
    }
    const result = method === "pm_getPaymasterStubData" ? await stub(params, cfg, appToken) : await data(params, cfg, appToken, origin, clientIp);
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (error instanceof RpcError) return { jsonrpc: "2.0", id, error: { code: error.code, message: error.message, data: error.data } };
    console.error("[sponsorship-rpc] unhandled request error:", (error as Error).message);
    return { jsonrpc: "2.0", id, error: { code: JSON_RPC_ERROR_CODES.internalError, message: "Internal error." } };
  }
}

export async function handleV2RpcBody(body: unknown, cfg: V2RpcConfig, appToken: string, origin: string | null = null, clientIp: string | null = null): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  if (Array.isArray(body)) return Promise.all(body.slice(0, 20).map((e) => handleV2RpcRequest(e, cfg, appToken, origin, clientIp)));
  return handleV2RpcRequest(body, cfg, appToken, origin, clientIp);
}
