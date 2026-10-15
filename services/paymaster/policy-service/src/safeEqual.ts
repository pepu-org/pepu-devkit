/**
 * Constant-time string comparison for shared secrets (admin tokens).
 *
 * Both inputs are hashed with SHA-256 first, so the comparison runs over two
 * equal-length 32-byte buffers regardless of the input lengths. That removes
 * both the early-exit timing signal of `===` and the length leak that
 * `crypto.timingSafeEqual` has on its own (it throws on unequal lengths).
 */
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}
