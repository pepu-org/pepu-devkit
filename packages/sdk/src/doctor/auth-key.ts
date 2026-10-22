/**
 * P-256 authorization key generator for Privy session signers. Ported from
 * templates/game-app/scripts/generate-authorization-key.mjs, which used
 * `@privy-io/node`'s `generateP256KeyPair()`. Same output format, implemented
 * with WebCrypto so this entry needs no peer dependency.
 */

function toBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface PrivyAuthorizationKeyPair {
  /** Base64 SPKI, no PEM headers. Paste into the Privy dashboard "New key" form. */
  publicKey: string;
  /** Base64 PKCS8, no PEM headers. A real secret: put it in PRIVY_AUTHORIZATION_KEY. */
  privateKey: string;
}

/**
 * Generate a P-256 key pair in the exact format Privy expects. Writes and
 * logs nothing; the caller decides where each half goes. Register the public
 * half in the Privy dashboard, keep the private half in server env only.
 *
 * @example
 * ```ts
 * const { publicKey, privateKey } = await generatePrivyAuthorizationKey();
 * // show publicKey; write privateKey straight to .env.local, never print it
 * ```
 */
export async function generatePrivyAuthorizationKey(): Promise<PrivyAuthorizationKeyPair> {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const [spki, pkcs8] = await Promise.all([
    globalThis.crypto.subtle.exportKey("spki", pair.publicKey),
    globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ]);
  return { publicKey: toBase64(spki), privateKey: toBase64(pkcs8) };
}
