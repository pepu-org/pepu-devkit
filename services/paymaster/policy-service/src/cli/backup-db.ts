/**
 * Consistent online backup of the policy service's SQLite database.
 *
 * Uses `VACUUM INTO`, which writes a transactionally consistent snapshot while the
 * service keeps running (WAL mode), then verifies the copy with
 * `PRAGMA integrity_check` and removes it if the check fails. Cap accounting,
 * the audit trail and the circuit-breaker state all live in this file, so it is
 * the one thing worth backing up.
 *
 * Usage (inside the policy-service container, where DB_PATH is set):
 *   node dist/cli/backup-db.js <output-dir>
 * Prints the path of the snapshot it wrote.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

/** Snapshots `dbPath` into `outDir` as policy-<UTC timestamp>.db. Returns the new file's path. */
export function backupDatabase(dbPath: string, outDir: string, now: Date = new Date()): string {
  if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const target = join(outDir, `policy-${stamp}.db`);
  if (existsSync(target)) throw new Error(`backup target already exists: ${target}`);

  const source = new DatabaseSync(dbPath);
  try {
    source.prepare("VACUUM INTO ?").run(target);
  } finally {
    source.close();
  }

  const copy = new DatabaseSync(target);
  try {
    const row = copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
    if (row?.integrity_check !== "ok") {
      throw new Error(`integrity_check failed on ${target}`);
    }
  } catch (error) {
    copy.close();
    rmSync(target, { force: true });
    throw error;
  }
  copy.close();
  return target;
}

function main(): void {
  const outDir = process.argv[2];
  const dbPath = process.env.DB_PATH?.trim();
  if (!outDir || !dbPath) {
    console.error("usage: DB_PATH=<db> backup-db <output-dir>");
    process.exit(2);
  }
  try {
    console.log(backupDatabase(dbPath, outDir));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

if (process.argv[1] && /backup-db\.(js|ts)$/.test(process.argv[1])) main();
