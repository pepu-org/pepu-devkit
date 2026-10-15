/**
 * ERC-7677 ("Paymaster Web Service Capability") JSON-RPC adapter — the
 * surface Privy's smart-wallet SDK (and every other modern ERC-4337 client:
 * viem's account-abstraction paymaster actions, permissionless.js, Alchemy's
 * aa-sdk `erc7677Middleware`, Base's account SDK) expects a "Paymaster URL"
 * to speak. This module does ONE thing: translate that wire format into
 * calls against the existing, UNMODIFIED `PolicyEngine` (policy.ts) — every
 * cap, the destination allowlist, the per-app budget, the circuit breaker,
 * the validity window, and the signing step all still run exactly as they
 * do for `POST /sponsor`. Nothing about the policy engine is forked or
 * reimplemented here.
 *
 * Spec sources (verified this session, 2026-09-30 — see README "Paymaster
 * JSON-RPC: spec sources" for the full citation list):
 *
 *   - ERC-7677 (https://eips.ethereum.org/EIPS/eip-7677): defines
 *     `pm_getPaymasterStubData` and `pm_getPaymasterData`, both taking
 *     positional params `[userOp, entryPoint, chainId, context?]` and
 *     returning an object with `paymaster` / `paymasterData` /
 *     `paymasterVerificationGasLimit` / `paymasterPostOpGasLimit` (v0.7
 *     "unpacked" shape) plus, for the stub call only, an optional
 *     `isFinal: boolean` telling the caller whether a second
 *     `pm_getPaymasterData` call is needed at all.
 *   - Pimlico's `permissionless.js` docs
 *     (docs.pimlico.io/references/permissionless/reference/pimlico-actions/getPaymasterStubData):
 *     confirms the same method/param/response shapes against a real
 *     implementation, including that `chainId` travels as a hex quantity
 *     string (their example: `"0x2105"`).
 *   - Base's docs (docs.base.org/base-account/reference/core/capabilities/paymasterService)
 *     independently confirm the same `pm_get*` method names and shapes.
 *
 * This service does NOT implement `pm_sponsorUserOperation` (an older,
 * single-call convention some providers use as an alternative to the
 * two-call ERC-7677 flow): no request in this session's research turned up
 * a citable, authoritative wire-format spec for it (as opposed to
 * `pm_getPaymasterStubData`/`pm_getPaymasterData`, which are pinned to the
 * ERC-7677 text above). Per this task's explicit instruction not to invent
 * an RPC wire format, it is left out rather than guessed at. If Privy's
 * runtime turns out to require it for this custom chain, that is a
 * follow-up with its own verified spec, not a silent guess bundled in here.
 *
 * ## Why there are two methods, and why they behave differently here
 *
 * `pm_getPaymasterStubData` is called BEFORE gas estimation, to produce
 * paymaster-shaped fields an `eth_estimateUserOperationGas` simulation can
 * run against without reverting. Per the ERC: "stub values ... MAY return
 * paymaster-specific gas values ... the second RPC call to
 * pm_getPaymasterData MAY be skipped, by returning isFinal: true". This
 * service always returns `isFinal: false` and a SYNTACTICALLY valid but
 * cryptographically meaningless dummy signature — built with the exact
 * fresh-throwaway-key technique already proven in
 * `test/dummyPaymasterSignature.test.ts` (a signature-shaped blob is not
 * enough: `PepuVerifyingPaymasterV7`'s OpenZeppelin v5 `ECDSA.recover`
 * reverts on a non-canonical/malformed signature rather than returning
 * `sigFailed=1`, so the dummy must be a REAL ECDSA signature over
 * *something*, just not from an authorized signer). Critically, the stub
 * path never calls `PolicyEngine.evaluate()` — it consumes no cap, records
 * no audit row, and enforces no policy, because it is not yet known whether
 * this UserOperation will ever be submitted. A client that (incorrectly,
 * against the ERC's own text) ignores `isFinal: false` and never calls
 * `pm_getPaymasterData` will simply fail on-chain validation with
 * `sigFailed=1` (a clean, safe failure) — it can never SUCCEED with the
 * dummy signature; only `PepuVerifyingPaymasterV7`'s own authorized-signer
 * mapping does the real approval.
 *
 * `pm_getPaymasterData` is called right before submission to a bundler and
 * "will be used during user operation submission" (ERC-7677's own words) —
 * this is exactly the REST `/sponsor` endpoint's existing contract, so it
 * maps 1:1 onto `PolicyEngine.evaluate()`, unchanged.
 */
import {
  concatHex,
  numberToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, sign as signRawHash } from "viem/accounts";
import { ZodError, z } from "zod";
import { hexAddress, hexBytes, userOpSchema } from "./requestSchema.js";
import { buildPaymasterData, computeValidityWindow } from "./paymasterData.js";
import type { PolicyEngine } from "./policy.js";
import type { SponsorUserOperationInput } from "./types.js";
import { UNAUTHENTICATED_PAYMASTER_RPC_TOKEN } from "./paymasterRpcAuth.js";

/** The only two methods this session found a citable, verified spec for — see module doc comment. */
export const PAYMASTER_RPC_METHODS = ["pm_getPaymasterStubData", "pm_getPaymasterData"] as const;
export type PaymasterRpcMethod = (typeof PAYMASTER_RPC_METHODS)[number];

function isPaymasterRpcMethod(value: string): value is PaymasterRpcMethod {
  return (PAYMASTER_RPC_METHODS as readonly string[]).includes(value);
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}
export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: unknown;
  result: unknown;
}
export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: unknown;
  error: JsonRpcErrorObject;
}
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * Error codes are the base JSON-RPC 2.0 spec's own reserved values
 * (https://www.jsonrpc.org/specification#error_object) — `-32700`
 * (parse error), `-32600` (invalid request), `-32601` (method not found),
 * `-32602` (invalid params), `-32603` (internal error), and the
 * `-32000..-32099` "Server error" band reserved for
 * implementation-defined errors, which is where "sponsorship denied" and
 * "origin not allowed" live. None of this is ERC-7677-specific invention —
 * it's the transport envelope every JSON-RPC service (including every
 * ERC-7677 paymaster) is already built on.
 */
export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  sponsorshipDenied: -32000,
  accountDeploymentDisabled: -32001,
} as const;

class JsonRpcProtocolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts either a hex quantity ("0x17dcd") or a decimal number/string — both are seen in the wild across client libraries. */
function parseChainId(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(value)) return Number(BigInt(value));
    if (/^[0-9]+$/.test(value)) return Number(value);
  }
  throw new JsonRpcProtocolError(
    JSON_RPC_ERROR_CODES.invalidParams,
    `Invalid params: chainId must be a hex quantity ("0x17dcd") or a decimal number/string, got ${JSON.stringify(value)}`,
  );
}

/** Minimal shape needed for a stub response: nothing about the stub result depends on any userOp field, but we still sanity-check `sender` is address-shaped for logging/diagnostics. */
const minimalUserOpSchema = z.object({ sender: hexAddress }).passthrough();

/** The full shape `pm_getPaymasterData` needs — identical field-level rules to REST `/sponsor`'s `userOpSchema` (imported, not re-declared), plus an ignored optional `signature` (the account's own dummy signature, irrelevant to what this paymaster signs over). */
const fullUserOpSchema = userOpSchema.extend({ signature: hexBytes.optional() });

function toSponsorUserOperationInput(parsed: z.infer<typeof fullUserOpSchema>): SponsorUserOperationInput {
  return {
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
}

interface ParsedCallEnvelope {
  rawUserOp: unknown;
  entryPoint: Address;
  chainId: number;
}

/** Parses the `[userOp, entryPoint, chainId, context?]` positional params ERC-7677 defines. `context` (params[3]) is accepted but never inspected — see module doc comment on why auth doesn't route through it. */
function parseEnvelope(params: unknown): ParsedCallEnvelope {
  if (!Array.isArray(params) || params.length < 3) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.invalidParams,
      `Invalid params: expected [userOp, entryPoint, chainId, context?], got ${
        Array.isArray(params) ? `an array of length ${params.length}` : typeof params
      }`,
    );
  }
  const [rawUserOp, rawEntryPoint, rawChainId] = params as [unknown, unknown, unknown];
  let entryPoint: Address;
  try {
    entryPoint = hexAddress.parse(rawEntryPoint) as Address;
  } catch (error) {
    const message = error instanceof ZodError ? error.message : String(error);
    throw new JsonRpcProtocolError(JSON_RPC_ERROR_CODES.invalidParams, `Invalid params: entryPoint - ${message}`);
  }
  const chainId = parseChainId(rawChainId);
  return { rawUserOp, entryPoint, chainId };
}

export interface PaymasterRpcConfig {
  /** The sender-keyed-auth `PolicyEngine` instance (see index.ts / paymasterRpcAuth.ts) — same db/apps/allowlist/signer/caps as `/sponsor`'s engine, different auth only. */
  policy: PolicyEngine;
  entryPointAddress: Address;
  chainId: number;
  paymasterAddress: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  validityWindowSeconds: number;
  /**
   * When `false`, denies sponsorship of any UserOperation carrying
   * `factory`/`factoryData` (i.e. new-account deployment) through this
   * public endpoint — see paymasterRpcAuth.ts's doc comment: minting a
   * fresh Kernel smart account is the cheapest way for an unauthenticated
   * caller to mint a fresh set of per-sender caps. Defaults to `true`
   * (allowed) in index.ts because disabling it also blocks a legitimate
   * first-time user's very first (deploy + call) sponsored transaction —
   * this is a real trade-off to tune, not a free win, see README.
   */
  allowAccountDeployment: boolean;
}

/** Per-request: which app this call is billed/capped against — see server.ts (resolved from the URL path, reusing the exact same `AppRegistry.resolveByApiKey` mechanism `/sponsor`'s `X-Api-Key` header already uses). */
export interface PaymasterRpcRequestContext {
  apiKey: string;
}

/**
 * viem's `Signature` type is a `OneOf<...>` union of a legacy `{r,s,v}`
 * shape and a `{r,s,v?,yParity}` shape, so `sig.v` alone types as `bigint |
 * undefined` even though `sign()` always populates one of the two at
 * runtime. Prefer `yParity` (the non-deprecated field) when present. Mirrors
 * test/dummyPaymasterSignature.test.ts's identical helper.
 */
function recoveryByteHex(sig: { v?: bigint | undefined; yParity?: number | undefined }): Hex {
  if (sig.yParity !== undefined) return toHex(sig.yParity + 27, { size: 1 });
  if (sig.v !== undefined) return toHex(sig.v, { size: 1 });
  throw new Error("secp256k1 signature has neither v nor yParity");
}

async function buildStubResult(config: PaymasterRpcConfig): Promise<Record<string, unknown>> {
  // Fresh throwaway key per call, exactly like
  // test/dummyPaymasterSignature.test.ts / integration-test.mjs's proven
  // gas-estimation fix: viem's secp256k1 signing always returns a canonical
  // low-s signature with v in {27,28}, which is what's needed for this to
  // reach `PepuVerifyingPaymasterV7`'s reverting `ECDSA.recover` without
  // reverting (it will simply fail authorization, `sigFailed=1`).
  const dummyKey = generatePrivateKey();
  const sig = await signRawHash({ hash: `0x${"00".repeat(32)}` as Hex, privateKey: dummyKey });
  const dummySignature = concatHex([sig.r, sig.s, recoveryByteHex(sig)]) as Hex;
  const window = computeValidityWindow(config.validityWindowSeconds);
  const paymasterData = buildPaymasterData(window, dummySignature);
  return {
    paymaster: config.paymasterAddress,
    paymasterData,
    paymasterVerificationGasLimit: numberToHex(config.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: numberToHex(config.paymasterPostOpGasLimit),
    // Per ERC-7677: false because the real (policy-checked, signed) data can
    // only come from a real pm_getPaymasterData call — see module doc comment.
    isFinal: false,
  };
}

function checkEnvelope(envelope: ParsedCallEnvelope, config: PaymasterRpcConfig): void {
  if (envelope.entryPoint.toLowerCase() !== config.entryPointAddress.toLowerCase()) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.invalidParams,
      `Invalid params: entryPoint ${envelope.entryPoint} is not supported; this paymaster only signs for ` +
        `EntryPoint v0.7 ${config.entryPointAddress}.`,
    );
  }
  if (envelope.chainId !== config.chainId) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.invalidParams,
      `Invalid params: chainId ${envelope.chainId} is not supported; this paymaster is configured for chain ` +
        `${config.chainId} (Pepe Unchained V2 mainnet). If you configured 97721 somewhere, that is a typo — ` +
        `the correct chain id is ${config.chainId}.`,
    );
  }
}

async function handleStubData(
  params: unknown,
  config: PaymasterRpcConfig,
): Promise<Record<string, unknown>> {
  const envelope = parseEnvelope(params);
  checkEnvelope(envelope, config);
  // Loosely validated on purpose — see module doc comment: a stub call may
  // legitimately precede gas estimation, so numeric gas/fee fields may be
  // placeholders or absent. Only `sender` is checked, and only for shape.
  try {
    minimalUserOpSchema.parse(envelope.rawUserOp);
  } catch (error) {
    const message = error instanceof ZodError ? error.message : String(error);
    throw new JsonRpcProtocolError(JSON_RPC_ERROR_CODES.invalidParams, `Invalid params: userOp - ${message}`);
  }
  return buildStubResult(config);
}

async function handlePaymasterData(
  params: unknown,
  config: PaymasterRpcConfig,
  context: PaymasterRpcRequestContext,
): Promise<Record<string, unknown>> {
  const envelope = parseEnvelope(params);
  checkEnvelope(envelope, config);

  let parsedUserOp: z.infer<typeof fullUserOpSchema>;
  try {
    parsedUserOp = fullUserOpSchema.parse(envelope.rawUserOp);
  } catch (error) {
    const message = error instanceof ZodError ? error.message : String(error);
    throw new JsonRpcProtocolError(JSON_RPC_ERROR_CODES.invalidParams, `Invalid params: userOp - ${message}`);
  }
  const userOp = toSponsorUserOperationInput(parsedUserOp);

  if (!config.allowAccountDeployment && (userOp.factory || userOp.factoryData)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.accountDeploymentDisabled,
      "Sponsorship of new-account deployment (factory/factoryData) is disabled on this public endpoint. " +
        "Submit this UserOperation once the smart account is already deployed.",
      { reason: "account_deployment_disabled_on_public_endpoint" },
    );
  }

  // The one call into the real, unmodified policy engine — every cap, the
  // destination allowlist, the per-app budget, the circuit breaker, and the
  // signing step all run exactly as they do for POST /sponsor.
  const result = await config.policy.evaluate(UNAUTHENTICATED_PAYMASTER_RPC_TOKEN, context.apiKey, userOp);
  if (result.status === "denied") {
    throw new JsonRpcProtocolError(JSON_RPC_ERROR_CODES.sponsorshipDenied, `Sponsorship denied: ${result.message}`, {
      reason: result.reason,
    });
  }
  return {
    paymaster: result.paymaster,
    paymasterData: result.paymasterData,
    paymasterVerificationGasLimit: result.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: result.paymasterPostOpGasLimit,
  };
}

/**
 * Handles exactly one JSON-RPC request object (not a batch array — see
 * `handlePaymasterRpcBody` for batch support). Never throws: every failure
 * mode, including an internal/unexpected error, is translated into a
 * JSON-RPC error response with the same `id` the request carried (or
 * `null` if the request itself was too malformed to have one).
 */
export async function handlePaymasterRpcRequest(
  rawRequest: unknown,
  config: PaymasterRpcConfig,
  context: PaymasterRpcRequestContext,
): Promise<JsonRpcResponse> {
  const id = isPlainObject(rawRequest) ? rawRequest.id ?? null : null;
  try {
    if (!isPlainObject(rawRequest)) {
      throw new JsonRpcProtocolError(
        JSON_RPC_ERROR_CODES.invalidRequest,
        "Invalid Request: expected a JSON-RPC request object.",
      );
    }
    const { method, params } = rawRequest;
    if (typeof method !== "string") {
      throw new JsonRpcProtocolError(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid Request: 'method' must be a string.");
    }
    if (!isPaymasterRpcMethod(method)) {
      throw new JsonRpcProtocolError(
        JSON_RPC_ERROR_CODES.methodNotFound,
        `Method not found: "${method}". Supported: ${PAYMASTER_RPC_METHODS.join(", ")}.`,
      );
    }

    const result =
      method === "pm_getPaymasterStubData"
        ? await handleStubData(params, config)
        : await handlePaymasterData(params, config, context);

    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (error instanceof JsonRpcProtocolError) {
      return { jsonrpc: "2.0", id, error: { code: error.code, message: error.message, data: error.data } };
    }
    // eslint-disable-next-line no-console
    console.error("[paymaster-rpc] unhandled request error:", (error as Error).message);
    return { jsonrpc: "2.0", id, error: { code: JSON_RPC_ERROR_CODES.internalError, message: "Internal error." } };
  }
}

/**
 * Body-level entry point: JSON-RPC allows a single request object OR a
 * batch (array of request objects) at the transport layer. Handles both,
 * returning either a single response object or an array of them —
 * mirroring the shape of whatever was sent, per JSON-RPC 2.0 batching
 * conventions.
 */
export async function handlePaymasterRpcBody(
  body: unknown,
  config: PaymasterRpcConfig,
  context: PaymasterRpcRequestContext,
): Promise<JsonRpcResponse | JsonRpcResponse[]> {
  if (Array.isArray(body)) {
    return Promise.all(body.map((entry) => handlePaymasterRpcRequest(entry, config, context)));
  }
  return handlePaymasterRpcRequest(body, config, context);
}
