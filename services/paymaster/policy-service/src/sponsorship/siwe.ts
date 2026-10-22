/**
 * Sign-In With Ethereum (EIP-4361) login for project owners. A successful login proves control of an address and
 * yields a short-lived opaque session token. The session grants NO fund access (funds only move through on-chain
 * transactions the owner signs in their own wallet); it only authorises the API's owner endpoints, and every owner
 * call re-checks the address against the project's CURRENT on-chain owner.
 *
 * Checks, in order: message parses; version "1"; domain is one of the configured expected domains (anti-phishing
 * binding); chainId matches; nonce was issued by us, is unexpired and unused; issuedAt not in the future (skew) and
 * not older than the max message lifetime; expirationTime present, not passed, and no further than the max lifetime
 * from issuedAt; notBefore (if any) reached; signature verifies for the claimed address (EOA, or ERC-1271 for Safe
 * owners through the chain RPC). Only AFTER the signature verifies is the nonce consumed (atomically, single use), so
 * garbage requests cannot burn other users' nonces.
 */
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { ChainReader } from "./chain.js";
import type { SponsorshipDb } from "./db.js";

export interface SiweDeps {
  db: SponsorshipDb;
  chain: Pick<ChainReader, "verifySignature">;
  chainId: number;
  config: {
    domains: readonly string[];
    nonceTtlSeconds: number;
    sessionTtlSeconds: number;
    maxMessageLifetimeSeconds: number;
    clockSkewSeconds: number;
  };
  now?: () => number;
}

export type LoginResult =
  | { ok: true; token: string; address: Address; expiresAtMs: number }
  | { ok: false; reason: string };

export class SiweAuth {
  constructor(private readonly deps: SiweDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  issueNonce(): { nonce: string; expiresAt: string } {
    const { nonce, expiresAtMs } = this.deps.db.createNonce(this.now(), this.deps.config.nonceTtlSeconds);
    return { nonce, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  async login(message: string, signature: Hex): Promise<LoginResult> {
    const { config } = this.deps;
    const nowMs = this.now();
    if (typeof message !== "string" || message.length > 2_000 || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      return { ok: false, reason: "malformed_message" };
    }
    const m = parseSiweMessage(message);
    if (!m.address || !m.domain || !m.nonce || !m.issuedAt || !m.chainId || !m.uri || m.version !== "1") {
      return { ok: false, reason: "malformed_message" };
    }
    if (!isAddress(m.address, { strict: false })) return { ok: false, reason: "malformed_message" };
    if (!config.domains.includes(m.domain)) return { ok: false, reason: "domain_mismatch" };
    if (m.chainId !== this.deps.chainId) return { ok: false, reason: "chain_id_mismatch" };

    const skewMs = config.clockSkewSeconds * 1000;
    const maxLifeMs = config.maxMessageLifetimeSeconds * 1000;
    const issuedMs = m.issuedAt.getTime();
    if (issuedMs > nowMs + skewMs) return { ok: false, reason: "issued_in_future" };
    if (nowMs - issuedMs > maxLifeMs + skewMs) return { ok: false, reason: "message_too_old" };
    if (!m.expirationTime) return { ok: false, reason: "expiration_required" };
    const expMs = m.expirationTime.getTime();
    if (expMs <= nowMs - skewMs) return { ok: false, reason: "message_expired" };
    if (expMs - issuedMs > maxLifeMs) return { ok: false, reason: "expiration_too_far" };
    if (m.notBefore && m.notBefore.getTime() > nowMs + skewMs) return { ok: false, reason: "not_yet_valid" };

    if (!this.deps.db.nonceIsLive(m.nonce, nowMs)) return { ok: false, reason: "invalid_nonce" };

    const address = getAddress(m.address);
    const valid = await this.deps.chain.verifySignature(address, message, signature as Hex);
    if (!valid) return { ok: false, reason: "invalid_signature" };

    if (!this.deps.db.consumeNonce(m.nonce, nowMs)) return { ok: false, reason: "invalid_nonce" }; // lost a replay race
    const { token, expiresAtMs } = this.deps.db.createSession(address, nowMs, config.sessionTtlSeconds);
    return { ok: true, token, address, expiresAtMs };
  }
}

/** Helper for clients/tests: builds a well-formed login message the server will accept. */
export function buildLoginMessage(params: {
  address: Address;
  domain: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expirationTime: Date;
  statement?: string;
}): string {
  return createSiweMessage({
    address: params.address,
    chainId: params.chainId,
    domain: params.domain,
    nonce: params.nonce,
    uri: params.uri,
    version: "1",
    statement: params.statement ?? "Sign in to manage your PEPU gas sponsorship project. This does not move any funds.",
    issuedAt: params.issuedAt,
    expirationTime: params.expirationTime,
  });
}
