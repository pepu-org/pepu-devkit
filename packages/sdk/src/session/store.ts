import type { Address, Hex } from "viem";

/**
 * Server-side session records for the Kernel (on-chain) session flow, keyed by
 * Privy user id. Ported from templates/sponsored-session-app/lib/session-store.ts.
 *
 * WHAT IS STORED: the session private key (a hot key whose power is limited
 * ON-CHAIN by the call and timestamp policies until `validUntil`) and the
 * public approval. The owner's key never reaches the server.
 *
 * PRODUCTION: {@link createMemoryStore} is DEV-GRADE. It is lost on every
 * restart (the user simply starts a new session) and is not shared between
 * serverless instances. A production deployment must implement
 * {@link SessionStore} on a persistent database or KV AND keep
 * `sessionPrivateKey` encrypted at rest (KMS or an envelope key). Nothing else
 * in the SDK changes.
 */
export interface SessionRecord {
  userId: string;
  ownerAddress: Address;
  kernelAddress: Address;
  /** The session key's private half. Encrypt it at rest in any persistent store. */
  sessionPrivateKey: Hex;
  sessionKeyAddress: Address;
  permissionId: string;
  /** Unix seconds. The on-chain permission is invalid at and after this time. */
  validUntil: number;
  /** Present once the owner has signed the grant. */
  approval: string | null;
  /** Number of successful sponsored actions in this session. */
  actions: number;
}

type MaybePromise<T> = T | Promise<T>;

/**
 * Pluggable storage for {@link SessionRecord}s. Every method may be sync or
 * async. `tryLock` must be atomic per user: it returns `false` when an action
 * is already running for that user (a multi-instance deployment needs a
 * distributed lock, for example a Redis `SET NX PX`).
 */
export interface SessionStore {
  get(userId: string): MaybePromise<SessionRecord | undefined>;
  set(record: SessionRecord): MaybePromise<void>;
  delete(userId: string): MaybePromise<void>;
  tryLock(userId: string): MaybePromise<boolean>;
  unlock(userId: string): MaybePromise<void>;
}

/**
 * An in-memory {@link SessionStore} for development and tests. DEV-GRADE: not
 * persistent, not shared across instances, and the session key is held in
 * plaintext in process memory. Production needs an encrypted persistent store.
 *
 * @example
 * const store = createMemoryStore();
 */
export function createMemoryStore(): SessionStore {
  const records = new Map<string, SessionRecord>();
  const locks = new Set<string>();
  return {
    get: (userId) => records.get(userId),
    set: (record) => {
      records.set(record.userId, record);
    },
    delete: (userId) => {
      records.delete(userId);
    },
    tryLock: (userId) => {
      if (locks.has(userId)) return false;
      locks.add(userId);
      return true;
    },
    unlock: (userId) => {
      locks.delete(userId);
    },
  };
}

/**
 * True while the on-chain permission is still valid: approved and before expiry.
 *
 * @example
 * isLive(record, Math.floor(Date.now() / 1000));
 */
export function isLive(record: SessionRecord, nowSeconds: number): boolean {
  return record.approval !== null && nowSeconds < record.validUntil;
}
