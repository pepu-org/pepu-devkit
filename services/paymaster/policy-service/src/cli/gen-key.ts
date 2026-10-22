/**
 * Generates a fresh secp256k1 private key and writes it to a file (mode 0400,
 * never overwriting an existing file). Prints ONLY the derived public address.
 * The key is never printed, logged, or returned on stdout.
 *
 * Intended use (see deploy/hosting/RUNBOOK.md, "Keys"): run once on the host to
 * create the dedicated paymaster signer key and the bundler executor key(s) as
 * secret files that the containers mount.
 *
 *   docker compose run --rm --no-deps -v "$PWD/secrets:/out" policy-service \
 *     node dist/cli/gen-key.js /out/paymaster_signer_private_key
 *
 * Usage: node dist/cli/gen-key.js <output-file>
 */
import { existsSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** Writes a new key to `path` (exclusive create, mode 0400) and returns its address. Throws if the file exists. */
export function generateKeyFile(path: string): string {
  if (existsSync(path)) {
    throw new Error(`refusing to overwrite existing file: ${path}`);
  }
  const key = generatePrivateKey();
  writeFileSync(path, `${key}\n`, { mode: 0o400, flag: "wx" });
  return privateKeyToAccount(key).address;
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: gen-key <output-file>");
    process.exit(2);
  }
  try {
    const address = generateKeyFile(path);
    console.log(`address: ${address}`);
    console.log(`key written to ${path} (mode 0400). Back it up in your secrets manager; it is not shown again.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

// Run only as an entry point, not when imported by tests.
if (process.argv[1] && /gen-key\.(js|ts)$/.test(process.argv[1])) main();
