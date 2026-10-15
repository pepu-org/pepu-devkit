#!/usr/bin/env node
/**
 * Generates a P-256 key pair for a Privy authorization key quorum with the
 * SDK doctor's `generatePrivyAuthorizationKey()`: base64 PKCS8 private key
 * (for `PRIVY_AUTHORIZATION_KEY`) and base64 SPKI public key (for the Privy
 * Dashboard "New key" form), no PEM headers. Prints both to stdout and writes
 * nothing. Never commit the private key.
 *
 * Usage: `npm run generate-authorization-key`
 */
import { generatePrivyAuthorizationKey } from "@pepu-chain/sdk/doctor";

const { publicKey, privateKey } = await generatePrivyAuthorizationKey();

console.log('Public key (paste into the Privy Dashboard "New key" form):\n');
console.log(publicKey);
console.log("\nPrivate key (paste into .env.local as PRIVY_AUTHORIZATION_KEY, keep it secret, never commit it):\n");
console.log(privateKey);
