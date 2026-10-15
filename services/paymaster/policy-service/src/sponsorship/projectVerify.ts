/**
 * Project ownership verification (SPEC section 9.2). A developer proves they control a Privy app by presenting its
 * app secret; the service checks it against Privy's REST API and, if valid, signs an EIP-712 `ProjectClaim`
 * attestation naming the developer's wallet as the project owner. The contract (not this service) enforces the
 * attestation: chain id and paymaster address are in the EIP-712 domain, each attestation is single-use and has a
 * deadline, the first claim is immediate and a re-claim is timelocked on-chain.
 *
 * SECRET HANDLING: the app secret is used for exactly one outbound request and is never stored, logged, echoed or
 * placed in an error message. Every failure path here throws/returns a fixed string that does not contain it.
 */
import { randomBytes } from "node:crypto";
import type { Address, Hex, LocalAccount } from "viem";

export type SecretCheck = "valid" | "invalid";

export interface PrivySecretVerifier {
  /** Resolves "valid"/"invalid"; THROWS (with a fixed, secret-free message) when Privy cannot be reached or misbehaves. */
  verify(appId: string, appSecret: string): Promise<SecretCheck>;
}

export const PRIVY_API_BASE = "https://api.privy.io";

/**
 * Checks the secret with the cheapest authenticated READ Privy documents: `GET /v1/users?limit=1` (HTTP Basic
 * `appId:appSecret` plus the `privy-app-id` header). Privy documents no dedicated "get app settings" endpoint for
 * server credentials, so listing one user is the least-privilege read; 200 means the credentials are valid for that
 * app, 401/403 means they are not. Any other status is an upstream problem, not a verdict.
 */
export function createPrivyRestSecretVerifier(opts: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): PrivySecretVerifier {
  const base = (opts.baseUrl ?? PRIVY_API_BASE).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  return {
    async verify(appId, appSecret) {
      let status: number;
      try {
        const res = await doFetch(`${base}/v1/users?limit=1`, {
          method: "GET",
          headers: {
            Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`, "utf8").toString("base64")}`,
            "privy-app-id": appId,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = res.status;
        // drain without reading into logs
        await res.arrayBuffer().catch(() => undefined);
      } catch {
        // deliberately discard the original error: it could echo request details
        throw new Error("privy_unreachable");
      }
      if (status === 200) return "valid";
      if (status === 401 || status === 403) return "invalid";
      throw new Error("privy_unexpected_response");
    },
  };
}

export const CLAIM_DOMAIN_NAME = "PepuSponsoredPaymaster";
export const CLAIM_DOMAIN_VERSION = "1";

export const CLAIM_TYPES = {
  ProjectClaim: [
    { name: "appId", type: "string" },
    { name: "newOwner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface ClaimAttestation {
  appId: string;
  newOwner: Address;
  nonce: string;
  deadline: string;
  signature: Hex;
}

/** Signs the contract's `ProjectClaim` EIP-712 message with the policy signer (must be a current on-chain signer). */
export async function signClaimAttestation(params: {
  signer: LocalAccount;
  chainId: number;
  paymaster: Address;
  appId: string;
  newOwner: Address;
  deadlineSeconds: number;
  nonce?: bigint;
}): Promise<ClaimAttestation> {
  const nonce = params.nonce ?? BigInt(`0x${randomBytes(32).toString("hex")}`);
  const deadline = BigInt(params.deadlineSeconds);
  const signature = await params.signer.signTypedData({
    domain: { name: CLAIM_DOMAIN_NAME, version: CLAIM_DOMAIN_VERSION, chainId: params.chainId, verifyingContract: params.paymaster },
    types: CLAIM_TYPES,
    primaryType: "ProjectClaim",
    message: { appId: params.appId, newOwner: params.newOwner, nonce, deadline },
  });
  return { appId: params.appId, newOwner: params.newOwner, nonce: nonce.toString(), deadline: deadline.toString(), signature };
}
