import { getAddress, isAddress } from "viem";
import type { Address, Hex } from "viem";

import { assertServerOnly } from "../internal/assert-server.js";
import { PepuPaymasterError } from "../errors.js";
import type { PaymasterApi } from "./api.js";
import type { ProjectClaimAttestation } from "./onchain.js";

assertServerOnly("@pepu-chain/sdk/paymaster/server");

/**
 * `@pepu-chain/sdk/paymaster/server`: the one paymaster call that carries a Privy app secret.
 *
 * SECURITY: `requestClaimAttestation` sends your Privy APP SECRET to the PEPU policy service (one outbound request,
 * which the service documents as never stored, logged or echoed). Use a dedicated Privy app for sponsorship if you
 * can, and rotate the secret afterwards in the Privy dashboard. This SDK never logs, returns or puts the secret in
 * an error message. Run it from a server or CLI, never from a browser.
 */

export interface RequestClaimAttestationParams {
  /** Privy app id, exactly as in the dashboard (case-sensitive; the project id is keccak256 of it). */
  appId: string;
  /** The wallet that should own the project. Must be the address of the signed-in SIWE session. */
  newOwner: Address;
  /** Privy APP SECRET. Used for one request and never stored, logged or echoed by this SDK. */
  privyAppSecret: string;
}

export interface ClaimAttestationResult {
  projectId: Hex;
  appId: string;
  ownerAddress: Address;
  /** `claimProject` for an unclaimed project, `reclaimProject` (timelocked, cancelable) for an owned one. */
  action: "claimProject" | "reclaimProject";
  /**
   * `immediately` for the first claim of a project that holds no funds, `after_admin_change_delay` for a re-claim or
   * for the first claim of a project that already holds deposits (pending for the admin change delay, at least 48
   * hours, then finished with `encodeExecuteReclaim`). Absent when talking to an older service.
   */
  takesEffect?: "immediately" | "after_admin_change_delay";
  attestation: ProjectClaimAttestation;
  /** ISO time the attestation expires (at most 1 hour out). */
  expiresAt: string;
  note?: string;
}

/**
 * `POST /v2/projects/verify`: prove control of a Privy app and receive the EIP-712 `ProjectClaim` attestation.
 * The `api` client must already be signed in (`api.v2.loginWithWallet`) as `newOwner`. Submit the result on-chain
 * with `encodeClaimFromVerification` (or `api.v2.projects.prepare`), then call `configureProject`.
 *
 * SERVER/CLI ONLY. Sends the Privy app secret to PEPU's service: use a dedicated app and rotate afterwards.
 *
 * @example
 * ```ts
 * const api = createPaymasterApi({ baseUrl });
 * await api.v2.loginWithWallet((m) => account.signMessage({ message: m }), { address: account.address, domain });
 * const v = await requestClaimAttestation(api, {
 *   appId: process.env.PRIVY_APP_ID!,
 *   newOwner: account.address,
 *   privyAppSecret: process.env.PRIVY_APP_SECRET!,
 * });
 * ```
 */
export async function requestClaimAttestation(
  api: PaymasterApi,
  params: RequestClaimAttestationParams,
): Promise<ClaimAttestationResult> {
  // Validation messages are static: they must never include the secret or the values passed in.
  if (typeof params.appId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(params.appId)) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "appId must be 1 to 128 characters of letters, digits, underscore or dash.");
  }
  if (typeof params.privyAppSecret !== "string" || params.privyAppSecret.length === 0 || params.privyAppSecret.length > 512) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "privyAppSecret must be a non-empty string of at most 512 characters.");
  }
  if (!isAddress(params.newOwner, { strict: false })) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "newOwner is not a valid address.");
  }
  const owner = getAddress(params.newOwner);
  const r = await api.v2.request<{
    projectId: Hex;
    appId: string;
    ownerAddress: Address;
    action: "claimProject" | "reclaimProject";
    takesEffect?: "immediately" | "after_admin_change_delay";
    attestation: ProjectClaimAttestation;
    expiresAt: string;
    note?: string;
  }>("POST", "/v2/projects/verify", {
    session: true,
    quietErrors: true,
    body: { appId: params.appId, appSecret: params.privyAppSecret, ownerAddress: owner },
  });
  return {
    projectId: r.projectId,
    appId: r.appId,
    ownerAddress: r.ownerAddress,
    action: r.action,
    ...(r.takesEffect !== undefined ? { takesEffect: r.takesEffect } : {}),
    attestation: r.attestation,
    expiresAt: r.expiresAt,
    ...(r.note !== undefined ? { note: r.note } : {}),
  };
}
