import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { backupDatabase } from "../src/cli/backup-db.js";
import { generateKeyFile } from "../src/cli/gen-key.js";
import { PolicyDb } from "../src/db.js";

describe("gen-key", () => {
  it("writes a valid key file and returns only the matching address", () => {
    const dir = mkdtempSync(join(tmpdir(), "pepu-genkey-"));
    const path = join(dir, "signer");
    const address = generateKeyFile(path);
    const key = readFileSync(path, "utf8").trim() as `0x${string}`;
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(privateKeyToAccount(key).address).toBe(address);
    expect(address).not.toContain(key.slice(2));
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o400);
  });

  it("never overwrites an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pepu-genkey-"));
    const path = join(dir, "signer");
    writeFileSync(path, "existing");
    expect(() => generateKeyFile(path)).toThrow(/refusing to overwrite/);
    expect(readFileSync(path, "utf8")).toBe("existing");
  });
});

describe("backup-db", () => {
  it("writes a consistent, openable snapshot with the same data", () => {
    const dir = mkdtempSync(join(tmpdir(), "pepu-backup-"));
    const dbPath = join(dir, "policy.db");
    const db = new PolicyDb(dbPath);
    db.setReconcilerState("k", "v");
    // Snapshot while the source handle is still open (online backup).
    const out = backupDatabase(dbPath, join(dir, "backups"), new Date("2026-10-09T12:34:56.789Z"));
    expect(out).toMatch(/policy-20261009T123456Z\.db$/);
    expect(existsSync(out)).toBe(true);
    const copy = new PolicyDb(out);
    expect(copy.getReconcilerState("k")).toBe("v");
    copy.close();
    db.close();
  });

  it("fails clearly when the database does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pepu-backup-"));
    expect(() => backupDatabase(join(dir, "missing.db"), dir)).toThrow(/database not found/);
  });
});
