/**
 * Convenience CLI: prints the sha256 hex digest of an API key, for pasting
 * into config/apps.json's `apiKeyHashHex` field. Never stores or logs the
 * raw key anywhere else.
 *
 * Usage: node --experimental-strip-types src/cli/hash-api-key.ts <raw-api-key>
 */
import { sha256HexOf } from "../appRegistry.js";

const rawKey = process.argv[2];
if (!rawKey) {
  console.error("Usage: hash-api-key.ts <raw-api-key>");
  process.exit(1);
}
console.log(sha256HexOf(rawKey));
