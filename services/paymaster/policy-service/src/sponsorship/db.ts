/**
 * Persistence for the tiered-sponsorship (v2) path. A SEPARATE SQLite file from v1's `policy.db`
 * (default `data/sponsorship.db`), so enabling v2 can never touch v1's counters or audit log.
 *
 * Same conventions as v1's db.ts: node:sqlite (`DatabaseSync`, fetched via `process.getBuiltinModule` so vitest
 * does not mis-resolve it), every cap check + insert is one synchronous call (no await in between), monetary sums
 * are done in JS BigInt (never SQL SUM, which is floating point).
 *
 * Accounting model (SPEC section 5, "Off-chain accounting"): every approval writes a `usage_events` row holding the
 * WORST-CASE reservation. When the reconciler later sees `UserOpSettled` on-chain it records the ACTUAL charge in
 * `final_wei`; a user's budget is computed on `final_wei ?? reserved_wei`. An approval that can no longer execute
 * (its signature expired and the chain was scanned past that point with no reservation seen) is `voided` and stops
 * counting. `executed` is set when `SponsorReserved` is seen, so an op whose postOp reverted (sponsor charged the
 * full reservation) is never voided.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { Address, Hex } from "viem";
import type {
  CredentialKind,
  IdentityKind,
  ProjectRecord,
  ResolvedCredential,
  ResolvedIdentity,
  SponsorKind,
  SponsorshipDenialReason,
  UsageRow,
} from "./types.js";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function hexEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

function startOfUtcDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export type ApprovalLimits =
  | { kind: "project"; perUserDailyCapWei: bigint }
  | {
      kind: "free";
      perUserDailyWei: bigint;
      perUserHourlyWei: bigint;
      perUserDailyCount: number;
      perUserHourlyCount: number;
    };

export interface RecordApprovalInput {
  nowMs: number;
  sponsorKind: SponsorKind;
  /** bytes32 sponsor id: the project id, or the all-zero free pool id. */
  sponsorId: Hex;
  projectKey: string;
  identity: ResolvedIdentity;
  sender: Address;
  reservedWei: bigint;
  /** Unix seconds when the signature stops being usable. */
  validUntil: number;
  /** Hash of the paymaster-signed payload (the contract's getHash input); unique per approval. */
  pmHash: Hex;
  limits: ApprovalLimits;
  /** Which credential asked (client tokens are public, so their live reservations are capped). */
  credential: CredentialKind;
  /** Caller IP as seen by the API (null if unknown). */
  clientIp: string | null;
  /** The op's nonce: a new approval for the same (sponsor, sender, nonce) replaces the previous unexecuted one. */
  nonce: bigint;
}

/** Excludes one (sender, nonce) from outstanding sums: a re-request replaces its own earlier approval. */
export interface OutstandingExclude {
  sender: Address;
  nonce: bigint;
}

export type RecordApprovalResult =
  | { ok: true; idempotent: boolean }
  | { ok: false; reason: SponsorshipDenialReason; message: string };

export interface AuditEntry {
  tsMs: number;
  decision: "approved" | "denied";
  reason: string;
  projectKey: string | null;
  sponsor: string | null;
  identityKey: string | null;
  sender: Address | null;
  targets: readonly Address[];
  maxCostWei: string | null;
  epHash: Hex | null;
  detail: string | null;
}

export interface AuditRow extends AuditEntry {
  id: number;
}

interface ProjectRow {
  key: string;
  project_id: string | null;
  app_id: string;
  owner: string | null;
  token_hash: string | null;
  token_prefix: string | null;
  token_rotated_at: number | null;
  server_key_hash: string | null;
  server_key_prefix: string | null;
  server_key_rotated_at: number | null;
  allowed_origins: string | null;
  status: string;
  per_user_daily_cap_wei: string;
  require_identity: number;
  allowed_destinations: string | null;
  created_at: number;
  updated_at: number;
}

function toProject(r: ProjectRow): ProjectRecord {
  return {
    key: r.key,
    projectId: (r.project_id as Hex | null) ?? null,
    appId: r.app_id,
    owner: (r.owner as Address | null) ?? null,
    tokenPrefix: r.token_prefix,
    tokenRotatedAtMs: r.token_rotated_at,
    serverKeyPrefix: r.server_key_prefix,
    serverKeyRotatedAtMs: r.server_key_rotated_at,
    allowedOrigins: r.allowed_origins ? (JSON.parse(r.allowed_origins) as string[]) : [],
    status: r.status === "suspended" ? "suspended" : "active",
    perUserDailyCapWei: BigInt(r.per_user_daily_cap_wei),
    requireIdentity: r.require_identity === 1,
    allowedDestinations: r.allowed_destinations ? (JSON.parse(r.allowed_destinations) as Address[]) : null,
    createdAtMs: r.created_at,
    updatedAtMs: r.updated_at,
  };
}

interface UsageDbRow {
  id: number;
  ts_ms: number;
  sponsor: string;
  project_key: string;
  identity_key: string;
  identity_kind: string;
  sender: string;
  reserved_wei: string;
  final_wei: string | null;
  status: string;
  executed: number;
  valid_until: number;
  pm_hash: string;
  ep_hash: string | null;
  settled_block: number | null;
  settled_tx: string | null;
}

function toUsage(r: UsageDbRow): UsageRow {
  return {
    id: r.id,
    tsMs: r.ts_ms,
    sponsor: r.sponsor,
    projectKey: r.project_key,
    identityKey: r.identity_key,
    identityKind: r.identity_kind as IdentityKind,
    sender: r.sender as Address,
    reservedWei: BigInt(r.reserved_wei),
    finalWei: r.final_wei === null ? null : BigInt(r.final_wei),
    status: r.status as UsageRow["status"],
    executed: r.executed === 1,
    validUntil: r.valid_until,
    pmHash: r.pm_hash as Hex,
    epHash: (r.ep_hash as Hex | null) ?? null,
    settledBlock: r.settled_block,
    settledTx: (r.settled_tx as Hex | null) ?? null,
  };
}

function costOf(r: { reserved_wei: string; final_wei: string | null }): bigint {
  return BigInt(r.final_wei ?? r.reserved_wei);
}

export class SponsorshipDb {
  private readonly db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        key TEXT PRIMARY KEY,
        project_id TEXT UNIQUE,
        app_id TEXT NOT NULL,
        owner TEXT,
        token_hash TEXT UNIQUE,
        token_prefix TEXT,
        token_rotated_at INTEGER,
        server_key_hash TEXT,
        server_key_prefix TEXT,
        server_key_rotated_at INTEGER,
        allowed_origins TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        per_user_daily_cap_wei TEXT NOT NULL,
        require_identity INTEGER NOT NULL DEFAULT 0,
        allowed_destinations TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner);

      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        sponsor TEXT NOT NULL,
        project_key TEXT NOT NULL,
        identity_key TEXT NOT NULL,
        identity_kind TEXT NOT NULL,
        sender TEXT NOT NULL,
        reserved_wei TEXT NOT NULL,
        final_wei TEXT,
        status TEXT NOT NULL DEFAULT 'approved',
        executed INTEGER NOT NULL DEFAULT 0,
        valid_until INTEGER NOT NULL,
        pm_hash TEXT NOT NULL UNIQUE,
        ep_hash TEXT UNIQUE,
        settled_block INTEGER,
        settled_tx TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_usage_identity ON usage_events (sponsor, identity_key, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_events (project_key, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_usage_sponsor_ts ON usage_events (sponsor, ts_ms);

      CREATE TABLE IF NOT EXISTS audit_log_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        project_key TEXT,
        sponsor TEXT,
        identity_key TEXT,
        sender TEXT,
        targets_json TEXT NOT NULL,
        max_cost_wei TEXT,
        ep_hash TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit2_project ON audit_log_v2 (project_key, ts_ms);
      CREATE INDEX IF NOT EXISTS idx_audit2_ts ON audit_log_v2 (ts_ms);

      CREATE TABLE IF NOT EXISTS siwe_nonces (
        nonce TEXT PRIMARY KEY,
        expires_at_ms INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT
      );

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Databases created before the server-key / origin columns existed: add them in place.
    const existing = new Set((this.db.prepare(`PRAGMA table_info(projects)`).all() as unknown as { name: string }[]).map((c) => c.name));
    for (const [col, type] of [
      ["server_key_hash", "TEXT"],
      ["server_key_prefix", "TEXT"],
      ["server_key_rotated_at", "INTEGER"],
      ["allowed_origins", "TEXT"],
    ] as const) {
      if (!existing.has(col)) this.db.exec(`ALTER TABLE projects ADD COLUMN ${col} ${type}`);
    }
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_server_key ON projects (server_key_hash)`);
    // Reservation-cap columns (audit M-1) for databases created before they existed.
    const usageCols = new Set((this.db.prepare(`PRAGMA table_info(usage_events)`).all() as unknown as { name: string }[]).map((c) => c.name));
    for (const [col, type] of [
      ["credential", "TEXT"],
      ["client_ip", "TEXT"],
      ["nonce", "TEXT"],
    ] as const) {
      if (!usageCols.has(col)) this.db.exec(`ALTER TABLE usage_events ADD COLUMN ${col} ${type}`);
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_live ON usage_events (sponsor, status, executed, valid_until)`);
  }

  /* ----------------------------- key/value ----------------------------- */

  getKv(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setKv(key: string, value: string): void {
    this.db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  /* ------------------------------ projects ------------------------------ */

  /** Generates a fresh opaque CLIENT token (publishable). Returned in plaintext once; only its sha256 is stored. */
  static newToken(): string {
    return `ppt_${randomBytes(24).toString("base64url")}`;
  }

  /** Generates a fresh SERVER API key (secret). Returned in plaintext once; only its sha256 is stored. */
  static newServerKey(): string {
    return `ppk_${randomBytes(32).toString("base64url")}`;
  }

  private setTokenInternal(key: string, token: string, nowMs: number): void {
    this.db
      .prepare(`UPDATE projects SET token_hash = ?, token_prefix = ?, token_rotated_at = ?, updated_at = ? WHERE key = ?`)
      .run(sha256Hex(token), token.slice(0, 8), nowMs, nowMs, key);
  }

  private setServerKeyInternal(key: string, serverKey: string, nowMs: number): void {
    this.db
      .prepare(`UPDATE projects SET server_key_hash = ?, server_key_prefix = ?, server_key_rotated_at = ?, updated_at = ? WHERE key = ?`)
      .run(sha256Hex(serverKey), serverKey.slice(0, 8), nowMs, nowMs, key);
  }

  /**
   * Creates the DB record for an on-chain project (idempotency is the caller's job: see getByProjectId) and issues
   * BOTH credentials: the publishable client token and the secret server key. Each is returned in plaintext once.
   */
  createOnchainProject(input: {
    projectId: Hex;
    appId: string;
    owner: Address;
    perUserDailyCapWei: bigint;
    requireIdentity: boolean;
    allowedOrigins?: string[];
    nowMs: number;
  }): { project: ProjectRecord; token: string; serverKey: string } {
    const key = input.projectId.toLowerCase();
    const token = SponsorshipDb.newToken();
    const serverKey = SponsorshipDb.newServerKey();
    this.db
      .prepare(
        `INSERT INTO projects (key, project_id, app_id, owner, status, per_user_daily_cap_wei, require_identity, allowed_origins, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
      .run(
        key,
        key,
        input.appId,
        input.owner.toLowerCase(),
        input.perUserDailyCapWei.toString(),
        input.requireIdentity ? 1 : 0,
        JSON.stringify(input.allowedOrigins ?? []),
        input.nowMs,
        input.nowMs,
      );
    this.setTokenInternal(key, token, input.nowMs);
    this.setServerKeyInternal(key, serverKey, input.nowMs);
    return { project: this.getByKey(key) as ProjectRecord, token, serverKey };
  }

  /** Admin-created, free-tier-only app (no on-chain project; draws only on the free pool; no server key). */
  createFreeApp(input: {
    label: string;
    perUserDailyCapWei: bigint;
    allowedDestinations: Address[] | null;
    nowMs: number;
  }): { project: ProjectRecord; token: string } {
    const slug = input.label.toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 48);
    const key = `app:${slug}`;
    const token = SponsorshipDb.newToken();
    this.db
      .prepare(
        `INSERT INTO projects (key, project_id, app_id, owner, status, per_user_daily_cap_wei, require_identity, allowed_destinations, created_at, updated_at)
         VALUES (?, NULL, ?, NULL, 'active', ?, 0, ?, ?, ?)`,
      )
      .run(key, input.label, input.perUserDailyCapWei.toString(), input.allowedDestinations ? JSON.stringify(input.allowedDestinations.map((a) => a.toLowerCase())) : null, input.nowMs, input.nowMs);
    this.setTokenInternal(key, token, input.nowMs);
    return { project: this.getByKey(key) as ProjectRecord, token };
  }

  /** Replaces the client token; the previous one stops working immediately. Returns the new plaintext token. */
  rotateToken(key: string, nowMs: number): string | null {
    if (!this.getByKey(key)) return null;
    const token = SponsorshipDb.newToken();
    this.setTokenInternal(key, token, nowMs);
    return token;
  }

  /** Replaces the server key (on-chain projects only); the previous one stops working immediately. */
  rotateServerKey(key: string, nowMs: number): string | null {
    const p = this.getByKey(key);
    if (!p || !p.projectId) return null;
    const serverKey = SponsorshipDb.newServerKey();
    this.setServerKeyInternal(key, serverKey, nowMs);
    return serverKey;
  }

  getByKey(key: string): ProjectRecord | null {
    const r = this.db.prepare(`SELECT * FROM projects WHERE key = ?`).get(key) as ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  getByProjectId(projectId: Hex): ProjectRecord | null {
    const r = this.db.prepare(`SELECT * FROM projects WHERE project_id = ?`).get(projectId.toLowerCase()) as ProjectRow | undefined;
    return r ? toProject(r) : null;
  }

  /** Resolves a project from a raw CLIENT token (hash lookup + constant-time confirm). */
  resolveByToken(rawToken: string): ProjectRecord | null {
    if (!rawToken || rawToken.length > 256) return null;
    const hash = sha256Hex(rawToken);
    const r = this.db.prepare(`SELECT * FROM projects WHERE token_hash = ?`).get(hash) as ProjectRow | undefined;
    if (!r || !r.token_hash || !hexEqual(r.token_hash, hash)) return null;
    return toProject(r);
  }

  /** Resolves a project from a raw credential and says which kind it was (client token or server key). */
  resolveCredential(raw: string): ResolvedCredential | null {
    if (!raw || raw.length > 256) return null;
    const hash = sha256Hex(raw);
    const client = this.db.prepare(`SELECT * FROM projects WHERE token_hash = ?`).get(hash) as ProjectRow | undefined;
    if (client?.token_hash && hexEqual(client.token_hash, hash)) return { project: toProject(client), kind: "client" };
    const server = this.db.prepare(`SELECT * FROM projects WHERE server_key_hash = ?`).get(hash) as ProjectRow | undefined;
    if (server?.server_key_hash && hexEqual(server.server_key_hash, hash)) return { project: toProject(server), kind: "server" };
    return null;
  }

  listByOwner(owner: Address): ProjectRecord[] {
    return (this.db.prepare(`SELECT * FROM projects WHERE owner = ? ORDER BY created_at`).all(owner.toLowerCase()) as unknown as ProjectRow[]).map(toProject);
  }

  listAllProjects(): ProjectRecord[] {
    return (this.db.prepare(`SELECT * FROM projects ORDER BY created_at`).all() as unknown as ProjectRow[]).map(toProject);
  }

  setStatus(key: string, status: "active" | "suspended", nowMs: number): boolean {
    const r = this.db.prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE key = ?`).run(status, nowMs, key);
    return Number(r.changes) > 0;
  }

  updateSettings(
    key: string,
    patch: { perUserDailyCapWei?: bigint; requireIdentity?: boolean; allowedOrigins?: string[] },
    nowMs: number,
  ): boolean {
    const p = this.getByKey(key);
    if (!p) return false;
    this.db
      .prepare(`UPDATE projects SET per_user_daily_cap_wei = ?, require_identity = ?, allowed_origins = ?, updated_at = ? WHERE key = ?`)
      .run(
        (patch.perUserDailyCapWei ?? p.perUserDailyCapWei).toString(),
        (patch.requireIdentity ?? p.requireIdentity) ? 1 : 0,
        JSON.stringify(patch.allowedOrigins ?? p.allowedOrigins),
        nowMs,
        key,
      );
    return true;
  }

  /**
   * The on-chain owner changed (re-claim or voluntary transfer; delta review L4): the credentials issued to the previous
   * owner must stop working. Replaces BOTH the client token and the server key with values nobody receives (the new owner
   * gets fresh ones from the rotate routes), clears the previous owner's allowed origins, and records the new owner.
   */
  revokeCredentialsForOwnerChange(key: string, newOwner: Address, nowMs: number): void {
    this.setTokenInternal(key, SponsorshipDb.newToken(), nowMs);
    this.setServerKeyInternal(key, SponsorshipDb.newServerKey(), nowMs);
    this.db.prepare(`UPDATE projects SET allowed_origins = '[]', owner = ?, updated_at = ? WHERE key = ?`).run(newOwner.toLowerCase(), nowMs, key);
  }

  setOwnerSnapshot(key: string, owner: Address, nowMs: number): void {
    this.db.prepare(`UPDATE projects SET owner = ?, updated_at = ? WHERE key = ?`).run(owner.toLowerCase(), nowMs, key);
  }

  /* ----------------------------- usage / caps ----------------------------- */

  private rows(sql: string, ...params: (string | number)[]): { reserved_wei: string; final_wei: string | null }[] {
    return this.db.prepare(sql).all(...params) as unknown as { reserved_wei: string; final_wei: string | null }[];
  }

  private sum(rows: { reserved_wei: string; final_wei: string | null }[]): bigint {
    let t = 0n;
    for (const r of rows) t += costOf(r);
    return t;
  }

  private identitySince(sponsorWhere: string, sponsorParam: string, identityKey: string, sinceMs: number) {
    return this.rows(
      `SELECT reserved_wei, final_wei FROM usage_events WHERE ${sponsorWhere} AND identity_key = ? AND ts_ms >= ? AND status != 'voided'`,
      sponsorParam,
      identityKey,
      sinceMs,
    );
  }

  /** Spend (final ?? reserved, not voided) a given identity has drawn from a sponsor since `sinceMs`. */
  identitySpendWei(sponsorId: Hex, identityKey: string, sinceMs: number): bigint {
    return this.sum(this.identitySince("sponsor = ?", sponsorId.toLowerCase(), identityKey, sinceMs));
  }

  /** Free-tier usage a given identity has drawn since `sinceMs` (across all projects). */
  freeIdentitySpendWei(identityKey: string, sinceMs: number): bigint {
    return this.sum(this.identitySince("sponsor = ?", "free", identityKey, sinceMs));
  }

  /**
   * Live reservations: approved, not seen on-chain, signature not yet expired. `valid_until` IS the expiry: a
   * reservation stops counting the instant its signature can no longer execute (no waiting for the reconciler).
   */
  private liveSql(extra: string, exclude: OutstandingExclude | undefined, params: (string | number)[]): { sql: string; params: (string | number)[] } {
    let sql = `status = 'approved' AND executed = 0 AND valid_until * 1000 > ?${extra}`;
    const p = [...params];
    if (exclude) {
      sql += ` AND (nonce IS NULL OR sender != ? OR nonce != ?)`;
      p.push(exclude.sender.toLowerCase(), exclude.nonce.toString());
    }
    return { sql, params: p };
  }

  private sponsorKey(sponsorId: Hex): string {
    const sponsor = sponsorId.toLowerCase();
    return /^0x0+$/.test(sponsor) ? "free" : sponsor;
  }

  /**
   * Sum of approvals that are still live (signature unexpired) and not yet seen on-chain: money the chain balance does
   * not reflect yet. Subtracted from on-chain balance/ceiling so concurrent requests cannot all pass on one balance.
   */
  outstandingReservedWei(sponsorId: Hex, nowMs: number, exclude?: OutstandingExclude): bigint {
    const q = this.liveSql("", exclude, [nowMs]);
    return this.sum(this.rows(`SELECT reserved_wei, final_wei FROM usage_events WHERE sponsor = ? AND ${q.sql}`, this.sponsorKey(sponsorId), ...q.params));
  }

  /** Like `outstandingReservedWei`, restricted to one sender wallet (for the on-chain per-sender limit mirror). */
  outstandingReservedForSenderWei(sponsorId: Hex, sender: Address, nowMs: number, exclude?: OutstandingExclude): bigint {
    const q = this.liveSql(" AND sender = ?", exclude, [nowMs, sender.toLowerCase()]);
    return this.sum(this.rows(`SELECT reserved_wei, final_wei FROM usage_events WHERE sponsor = ? AND ${q.sql}`, this.sponsorKey(sponsorId), ...q.params));
  }

  /** Number of live reservations one sender holds on a sponsor. */
  outstandingCountForSender(sponsorId: Hex, sender: Address, nowMs: number, exclude?: OutstandingExclude): number {
    const q = this.liveSql(" AND sender = ?", exclude, [nowMs, sender.toLowerCase()]);
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM usage_events WHERE sponsor = ? AND ${q.sql}`).get(this.sponsorKey(sponsorId), ...q.params) as { n: number }).n;
  }

  /** Live reservations made through CLIENT-token requests from one IP on a sponsor. */
  outstandingReservedForIpWei(sponsorId: Hex, ip: string, nowMs: number, exclude?: OutstandingExclude): bigint {
    const q = this.liveSql(" AND credential = 'client' AND client_ip = ?", exclude, [nowMs, ip]);
    return this.sum(this.rows(`SELECT reserved_wei, final_wei FROM usage_events WHERE sponsor = ? AND ${q.sql}`, this.sponsorKey(sponsorId), ...q.params));
  }

  /** Live reservations made through CLIENT-token requests (any IP) on a sponsor. */
  outstandingReservedForClientCredentialWei(sponsorId: Hex, nowMs: number, exclude?: OutstandingExclude): bigint {
    const q = this.liveSql(" AND credential = 'client'", exclude, [nowMs]);
    return this.sum(this.rows(`SELECT reserved_wei, final_wei FROM usage_events WHERE sponsor = ? AND ${q.sql}`, this.sponsorKey(sponsorId), ...q.params));
  }

  /**
   * The atomic gate: checks the off-chain caps for the chosen sponsor and, only if every check passes, inserts the
   * approval row. Synchronous (no await between the reads and the insert), so within this process nothing interleaves.
   */
  recordApproval(input: RecordApprovalInput): RecordApprovalResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = this.recordApprovalInner(input);
      this.db.exec(r.ok ? "COMMIT" : "ROLLBACK");
      return r;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private recordApprovalInner(input: RecordApprovalInput): RecordApprovalResult {
    const sponsorColumn = input.sponsorKind === "free" ? "free" : input.sponsorId.toLowerCase();
    const existing = this.db.prepare(`SELECT status FROM usage_events WHERE pm_hash = ?`).get(input.pmHash.toLowerCase()) as { status: string } | undefined;
    if (existing) return { ok: true, idempotent: true };

    const { nowMs, identity, reservedWei, limits } = input;
    const deny = (reason: SponsorshipDenialReason, message: string): RecordApprovalResult => ({ ok: false, reason, message });

    // A re-request for the same (sponsor, sender, nonce) REPLACES the earlier unexecuted approval: only one op per nonce
    // can ever execute, so holding both would double-reserve (and double-count against the user's caps). Rolled back
    // together with everything else if a cap below denies the new request.
    //
    // The earlier signature stays VALID until its own valid_until, so only the LARGER reservation may be dropped (review 3,
    // L-4): the earlier approval is voided only if the new reservation is at least as large. When the new one is
    // smaller, the earlier (larger) approval keeps counting until it expires, so alternating an expensive and a cheap
    // request for one nonce cannot hold many live expensive signatures while the caps see only the cheap ones. (While
    // both are live the smaller one also counts: conservative, bounded by the signature lifetime.)
    const earlier = this.db
      .prepare(`SELECT id, reserved_wei FROM usage_events WHERE sponsor = ? AND sender = ? AND nonce = ? AND status = 'approved' AND executed = 0`)
      .all(sponsorColumn, input.sender.toLowerCase(), input.nonce.toString()) as unknown as { id: number; reserved_wei: string }[];
    for (const e of earlier) {
      if (BigInt(e.reserved_wei) <= reservedWei) this.db.prepare(`UPDATE usage_events SET status = 'voided' WHERE id = ?`).run(e.id);
    }

    if (limits.kind === "project") {
      const used = this.sum(this.identitySince("sponsor = ?", sponsorColumn, identity.key, nowMs - DAY_MS));
      if (used + reservedWei > limits.perUserDailyCapWei) {
        return deny("project_user_cap_exceeded", `identity ${identity.key} would draw ${used + reservedWei} wei from this project today, cap is ${limits.perUserDailyCapWei}`);
      }
    } else {
      // Free tier: ONLY verified Privy accounts. There is no anonymous tier and no chain-wide ceiling (by decision:
      // funds can only pay gas, and a ceiling would cap the whole chain at a handful of heavy users). The hard bounds
      // are the per-user limits below, the per-op cap, and the on-chain per-sender limit.
      if (identity.kind !== "privy") {
        return deny("free_tier_identity_required", "the free tier is only available to users with a verified Privy account");
      }
      const cnt = (since: number): number =>
        (this.db.prepare(`SELECT COUNT(*) AS n FROM usage_events WHERE sponsor = 'free' AND identity_key = ? AND ts_ms >= ? AND status != 'voided'`).get(identity.key, since) as { n: number }).n;
      if (cnt(nowMs - HOUR_MS) + 1 > limits.perUserHourlyCount) {
        return deny("free_tier_count_exceeded", `identity ${identity.key} reached ${limits.perUserHourlyCount} sponsored ops in the trailing hour`);
      }
      if (cnt(nowMs - DAY_MS) + 1 > limits.perUserDailyCount) {
        return deny("free_tier_count_exceeded", `identity ${identity.key} reached ${limits.perUserDailyCount} sponsored ops in the trailing day`);
      }
      const hour = this.sum(this.identitySince("sponsor = ?", "free", identity.key, nowMs - HOUR_MS));
      if (hour + reservedWei > limits.perUserHourlyWei) {
        return deny("free_tier_user_hourly_exceeded", `identity ${identity.key} trailing-hour free spend ${hour} + ${reservedWei} would exceed ${limits.perUserHourlyWei}`);
      }
      const day = this.sum(this.identitySince("sponsor = ?", "free", identity.key, nowMs - DAY_MS));
      if (day + reservedWei > limits.perUserDailyWei) {
        return deny("free_tier_user_daily_exceeded", `identity ${identity.key} trailing-day free spend ${day} + ${reservedWei} would exceed ${limits.perUserDailyWei}`);
      }
    }

    try {
      this.db
        .prepare(
          `INSERT INTO usage_events (ts_ms, sponsor, project_key, identity_key, identity_kind, sender, reserved_wei, valid_until, pm_hash, credential, client_ip, nonce)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          nowMs,
          sponsorColumn,
          input.projectKey,
          identity.key,
          identity.kind,
          input.sender.toLowerCase(),
          reservedWei.toString(),
          input.validUntil,
          input.pmHash.toLowerCase(),
          input.credential,
          input.clientIp,
          input.nonce.toString(),
        );
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return { ok: true, idempotent: true };
      throw error;
    }
    return { ok: true, idempotent: false };
  }

  setEpHash(pmHash: Hex, epHash: Hex): void {
    this.db.prepare(`UPDATE usage_events SET ep_hash = ? WHERE pm_hash = ?`).run(epHash.toLowerCase(), pmHash.toLowerCase());
  }

  /** `SponsorReserved` seen on-chain: the op was included, so it must never be voided. */
  markExecuted(epHash: Hex): boolean {
    const r = this.db.prepare(`UPDATE usage_events SET executed = 1 WHERE ep_hash = ?`).run(epHash.toLowerCase());
    return Number(r.changes) > 0;
  }

  /** `UserOpSettled` seen on-chain: record the actual charge. */
  markSettled(epHash: Hex, chargedWei: bigint, block: number, tx: Hex): boolean {
    const r = this.db
      .prepare(`UPDATE usage_events SET final_wei = ?, status = 'settled', executed = 1, settled_block = ?, settled_tx = ? WHERE ep_hash = ?`)
      .run(chargedWei.toString(), block, tx, epHash.toLowerCase());
    return Number(r.changes) > 0;
  }

  /** Voids approvals that can no longer execute: signature expired before `throughTimestampSec` and never seen on-chain. */
  voidExpiredApprovals(throughTimestampSec: number): number {
    const r = this.db
      .prepare(`UPDATE usage_events SET status = 'voided' WHERE status = 'approved' AND executed = 0 AND valid_until < ?`)
      .run(throughTimestampSec);
    return Number(r.changes);
  }

  getUsageByEpHash(epHash: Hex): UsageRow | null {
    const r = this.db.prepare(`SELECT * FROM usage_events WHERE ep_hash = ?`).get(epHash.toLowerCase()) as UsageDbRow | undefined;
    return r ? toUsage(r) : null;
  }

  listUsage(projectKey: string, limit: number, beforeId?: number): UsageRow[] {
    const rows =
      beforeId === undefined
        ? (this.db.prepare(`SELECT * FROM usage_events WHERE project_key = ? ORDER BY id DESC LIMIT ?`).all(projectKey, limit) as unknown as UsageDbRow[])
        : (this.db.prepare(`SELECT * FROM usage_events WHERE project_key = ? AND id < ? ORDER BY id DESC LIMIT ?`).all(projectKey, beforeId, limit) as unknown as UsageDbRow[]);
    return rows.map(toUsage);
  }

  /** Spend per sponsor type for one project since `sinceMs` (final ?? reserved, not voided). */
  projectSpendSince(projectKey: string, sinceMs: number): { project: bigint; free: bigint; ops: number } {
    const rows = this.db
      .prepare(`SELECT sponsor, reserved_wei, final_wei FROM usage_events WHERE project_key = ? AND ts_ms >= ? AND status != 'voided'`)
      .all(projectKey, sinceMs) as unknown as { sponsor: string; reserved_wei: string; final_wei: string | null }[];
    let project = 0n;
    let free = 0n;
    for (const r of rows) {
      if (r.sponsor === "free") free += costOf(r);
      else project += costOf(r);
    }
    return { project, free, ops: rows.length };
  }

  /** Chain-wide free-tier spend since UTC midnight (final ?? reserved). */
  freeSpendTodayWei(nowMs: number): bigint {
    return this.sum(this.rows(`SELECT reserved_wei, final_wei FROM usage_events WHERE sponsor = 'free' AND ts_ms >= ? AND status != 'voided'`, startOfUtcDayMs(nowMs)));
  }

  usageCounts(): { approved: number; settled: number; voided: number } {
    const rows = this.db.prepare(`SELECT status, COUNT(*) AS n FROM usage_events GROUP BY status`).all() as unknown as { status: string; n: number }[];
    const out = { approved: 0, settled: 0, voided: 0 };
    for (const r of rows) if (r.status in out) out[r.status as keyof typeof out] = r.n;
    return out;
  }

  /* ------------------------------- audit ------------------------------- */

  appendAudit(e: AuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO audit_log_v2 (ts_ms, decision, reason, project_key, sponsor, identity_key, sender, targets_json, max_cost_wei, ep_hash, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.tsMs, e.decision, e.reason, e.projectKey, e.sponsor, e.identityKey, e.sender, JSON.stringify(e.targets), e.maxCostWei, e.epHash, e.detail);
  }

  listAudit(limit = 100, projectKey?: string): AuditRow[] {
    const rows = (projectKey
      ? this.db.prepare(`SELECT * FROM audit_log_v2 WHERE project_key = ? ORDER BY id DESC LIMIT ?`).all(projectKey, limit)
      : this.db.prepare(`SELECT * FROM audit_log_v2 ORDER BY id DESC LIMIT ?`).all(limit)) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      tsMs: r.ts_ms as number,
      decision: r.decision as "approved" | "denied",
      reason: r.reason as string,
      projectKey: (r.project_key as string | null) ?? null,
      sponsor: (r.sponsor as string | null) ?? null,
      identityKey: (r.identity_key as string | null) ?? null,
      sender: (r.sender as Address | null) ?? null,
      targets: JSON.parse(r.targets_json as string) as Address[],
      maxCostWei: (r.max_cost_wei as string | null) ?? null,
      epHash: (r.ep_hash as Hex | null) ?? null,
      detail: (r.detail as string | null) ?? null,
    }));
  }

  /** Deletes `audit_log_v2` rows older than `beforeMs` (retention, review 3 M-3). Returns the number removed. */
  pruneAudit(beforeMs: number): number {
    const r = this.db.prepare(`DELETE FROM audit_log_v2 WHERE ts_ms < ?`).run(beforeMs);
    return Number(r.changes);
  }

  appendAdminAudit(actor: string, action: string, target: string | null, detail: string | null, nowMs: number): void {
    this.db.prepare(`INSERT INTO admin_audit (ts_ms, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)`).run(nowMs, actor, action, target, detail);
  }

  listAdminAudit(limit = 100): { tsMs: number; actor: string; action: string; target: string | null; detail: string | null }[] {
    const rows = this.db.prepare(`SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?`).all(limit) as unknown as Record<string, unknown>[];
    return rows.map((r) => ({ tsMs: r.ts_ms as number, actor: r.actor as string, action: r.action as string, target: (r.target as string | null) ?? null, detail: (r.detail as string | null) ?? null }));
  }

  /* --------------------------- nonces / sessions --------------------------- */

  createNonce(nowMs: number, ttlSeconds: number): { nonce: string; expiresAtMs: number } {
    this.db.prepare(`DELETE FROM siwe_nonces WHERE expires_at_ms < ? OR used = 1`).run(nowMs - DAY_MS);
    const nonce = randomBytes(16).toString("hex");
    const expiresAtMs = nowMs + ttlSeconds * 1000;
    this.db.prepare(`INSERT INTO siwe_nonces (nonce, expires_at_ms) VALUES (?, ?)`).run(nonce, expiresAtMs);
    return { nonce, expiresAtMs };
  }

  nonceIsLive(nonce: string, nowMs: number): boolean {
    const r = this.db.prepare(`SELECT 1 AS x FROM siwe_nonces WHERE nonce = ? AND used = 0 AND expires_at_ms > ?`).get(nonce, nowMs);
    return r !== undefined;
  }

  /** Atomically consumes a nonce (single use). Returns false if it is unknown, expired, or already used. */
  consumeNonce(nonce: string, nowMs: number): boolean {
    const r = this.db.prepare(`UPDATE siwe_nonces SET used = 1 WHERE nonce = ? AND used = 0 AND expires_at_ms > ?`).run(nonce, nowMs);
    return Number(r.changes) === 1;
  }

  createSession(address: Address, nowMs: number, ttlSeconds: number): { token: string; expiresAtMs: number } {
    this.db.prepare(`DELETE FROM sessions WHERE expires_at_ms < ?`).run(nowMs);
    const token = `pps_${randomBytes(32).toString("base64url")}`;
    const expiresAtMs = nowMs + ttlSeconds * 1000;
    this.db.prepare(`INSERT INTO sessions (token_hash, address, issued_at_ms, expires_at_ms) VALUES (?, ?, ?, ?)`).run(sha256Hex(token), address.toLowerCase(), nowMs, expiresAtMs);
    return { token, expiresAtMs };
  }

  getSession(token: string, nowMs: number): { address: Address; expiresAtMs: number } | null {
    if (!token || token.length > 256) return null;
    const r = this.db.prepare(`SELECT address, expires_at_ms FROM sessions WHERE token_hash = ? AND expires_at_ms > ?`).get(sha256Hex(token), nowMs) as { address: string; expires_at_ms: number } | undefined;
    return r ? { address: r.address as Address, expiresAtMs: r.expires_at_ms } : null;
  }

  deleteSession(token: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256Hex(token));
  }
}
