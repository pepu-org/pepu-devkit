/**
 * Identity resolution (SPEC section 7). The chain free tier is available ONLY to users with a Privy account, proven
 * by a verified Privy access token (REST `Authorization: Bearer`, or ERC-7677 `context.privyAccessToken`). There is no
 * anonymous tier and no address-based identity: smart-account addresses are free to mint and are public, so neither
 * "a fresh sender" nor "a sender Privy happens to know" proves anything. With `requireSenderOwnership`, the token's
 * user must also own `userOp.sender`, proven either (a) as the Kernel v3.1 account derived from one of the user's own
 * Privy EMBEDDED wallets (what the PEPU SDK builds; see kernelOwnership.ts) or (b) as a Privy smart wallet the user
 * owns (a Privy lookup). Positive results are cached; failures are not cached and fail closed.
 *
 * Wallets without a verifiable Privy token get a bare `sender` identity, which project budgets accept (a project may
 * sponsor ANY wallet) and the free tier never does.
 *
 * Everything is injected (`IdentityResolver`) so tests never touch Privy.
 */
import { isAddress, type Address } from "viem";
import type { ResolvedIdentity } from "./types.js";

export interface IdentityResolver {
  /** Verifies a Privy access token for this app. Never throws. */
  verifyToken(token: string): Promise<{ ok: true; userId: string } | { ok: false }>;
  /**
   * The Privy user id that owns this smart wallet, or null if Privy has no such smart wallet.
   * THROWS on infrastructure errors (network, 5xx) so they are not mistaken for "no identity".
   */
  findOwnerBySmartWallet(sender: Address): Promise<string | null>;
  /**
   * The Ethereum EMBEDDED wallet addresses linked to this Privy user. THROWS on infrastructure errors.
   * Optional: a resolver without it can only prove ownership through Privy smart wallets.
   */
  listEmbeddedWallets?(userId: string): Promise<Address[]>;
}


export type IdentityResult =
  | { ok: true; identity: ResolvedIdentity; verified: boolean }
  | { ok: false; reason: "invalid_or_expired_token" | "sender_not_owned_by_token_user" };

export function privyIdentity(userId: string): ResolvedIdentity {
  return { kind: "privy", key: `privy:${userId}` };
}

export function senderIdentity(sender: Address): ResolvedIdentity {
  return { kind: "sender", key: `sender:${sender.toLowerCase()}` };
}

interface CacheEntry {
  userId: string | null;
  expiresAt: number;
}

export interface IdentityServiceOptions {
  /** Privy app id -> resolver. Apps without an entry cannot be identity-verified. */
  resolvers: ReadonlyMap<string, IdentityResolver>;
  requireSenderOwnership: boolean;
  cacheTtlMs: number;
  negativeCacheTtlMs: number;
  /** owner EOA -> its counterfactual Kernel v3.1 address (kernelOwnership.ts). Absent: Kernel ownership is not recognized. */
  deriveKernelAddress?: (owner: Address) => Promise<Address>;
  now?: () => number;
}

export class IdentityService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly opts: IdentityServiceOptions) {}

  /** True if tokens/lookups can be verified for this Privy app (we hold its credentials). */
  canVerify(appId: string): boolean {
    return this.opts.resolvers.has(appId);
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private async lookup(resolver: IdentityResolver, sender: Address): Promise<string | null> {
    const key = sender.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.userId;
    const userId = await resolver.findOwnerBySmartWallet(sender); // throws on infrastructure errors; NOT cached
    if (this.cache.size > 20_000) this.cache.clear();
    this.cache.set(key, { userId, expiresAt: this.now() + (userId ? this.opts.cacheTtlMs : this.opts.negativeCacheTtlMs) });
    return userId;
  }

  /**
   * True if `sender` is the Kernel account of one of the user's own embedded wallets. Any infrastructure error is
   * swallowed into `false` here; the caller then falls back to the Privy smart-wallet lookup, and denies if that fails.
   */
  private async ownsKernelAccount(resolver: IdentityResolver, userId: string, sender: Address): Promise<boolean> {
    const derive = this.opts.deriveKernelAddress;
    if (!derive || !resolver.listEmbeddedWallets) return false;
    try {
      const wallets = await resolver.listEmbeddedWallets(userId);
      const want = sender.toLowerCase();
      for (const wallet of wallets) {
        if ((await derive(wallet)).toLowerCase() === want) {
          if (this.cache.size > 20_000) this.cache.clear();
          this.cache.set(want, { userId, expiresAt: this.now() + this.opts.cacheTtlMs });
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the identity for a request. `appId` is the PROJECT's Privy app id.
   *
   *  - A Privy access token that verifies for this app yields a `privy` identity (the only kind the free tier accepts).
   *  - A token that does not verify is DENIED (`invalid_or_expired_token`).
   *  - No token, or a token for a Privy app whose credentials this process does not hold (a third-party project's
   *    own Privy app), yields a bare `sender` identity: fine for project budgets, never accepted by the free tier.
   *    (A third-party token is ignored rather than trusted; nothing is granted on its strength.)
   *  - There is NO sender-to-user lookup without a token: a public smart-wallet address is not proof of identity.
   */
  async resolve(params: { appId: string; privyToken: string | null; sender: Address }): Promise<IdentityResult> {
    const resolver = this.opts.resolvers.get(params.appId);
    if (!params.privyToken || !resolver) return { ok: true, identity: senderIdentity(params.sender), verified: false };

    const verified = await resolver.verifyToken(params.privyToken);
    if (!verified.ok) return { ok: false, reason: "invalid_or_expired_token" };
    if (this.opts.requireSenderOwnership) {
      const hit = this.cache.get(params.sender.toLowerCase());
      const cachedOwner = hit !== undefined && hit.expiresAt > this.now() && hit.userId === verified.userId;
      if (!cachedOwner && !(await this.ownsKernelAccount(resolver, verified.userId, params.sender))) {
        let owner: string | null;
        try {
          owner = await this.lookup(resolver, params.sender);
        } catch {
          return { ok: false, reason: "sender_not_owned_by_token_user" }; // fail closed
        }
        if (owner !== verified.userId) return { ok: false, reason: "sender_not_owned_by_token_user" };
      }
    }
    return { ok: true, identity: privyIdentity(verified.userId), verified: true };
  }
}

/** Minimal slice of `@privy-io/node`'s client used here, so tests (and this file) never import the SDK. */
export interface PrivyLike {
  utils(): { auth(): { verifyAccessToken(token: string): Promise<{ user_id: string }> } };
  users(): {
    getBySmartWalletAddress(body: { address: string }): Promise<{ id: string }>;
    _get(userId: string): Promise<{ linked_accounts: readonly unknown[] }>;
  };
}

function isNotFound(error: unknown): boolean {
  const e = error as { status?: number; name?: string; constructor?: { name?: string } };
  return e?.status === 404 || e?.name === "NotFoundError" || e?.constructor?.name === "NotFoundError";
}

/** Ethereum EMBEDDED wallet addresses in a Privy user's linked accounts (same test as `@privy-io/node`). */
export function embeddedEthereumAddresses(accounts: readonly unknown[]): Address[] {
  const out: Address[] = [];
  for (const a of accounts) {
    const w = a as { type?: string; wallet_client_type?: string; connector_type?: string; chain_type?: string; address?: string } | null;
    if (w?.type === "wallet" && w.wallet_client_type === "privy" && w.connector_type === "embedded" && w.chain_type === "ethereum" && isAddress(w.address ?? "")) {
      out.push(w.address as Address);
    }
  }
  return out;
}

export function createPrivyIdentityResolver(privy: PrivyLike): IdentityResolver {
  return {
    async verifyToken(token) {
      try {
        const claims = await privy.utils().auth().verifyAccessToken(token);
        return claims.user_id ? { ok: true, userId: claims.user_id } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
    async listEmbeddedWallets(userId) {
      const user = await privy.users()._get(userId); // throws on network/5xx: the caller treats that as "not proven"
      return embeddedEthereumAddresses(user.linked_accounts);
    },
    async findOwnerBySmartWallet(sender) {
      try {
        const user = await privy.users().getBySmartWalletAddress({ address: sender });
        return user?.id ?? null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}
