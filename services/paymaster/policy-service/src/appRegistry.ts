/**
 * Resolves the requesting app from a raw API key, verified against a stored
 * sha256 hash — never a client-declared appId taken at face value. See
 * README "How an app is identified" for the reasoning.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { AppRegistryConfig, RegisteredApp } from "./types.js";

export function sha256HexOf(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export class AppRegistry {
  private readonly apps: readonly RegisteredApp[];

  constructor(config: AppRegistryConfig) {
    this.apps = config.apps;
  }

  /** Returns the app whose stored hash matches `rawApiKey`, or `null` if none does. */
  resolveByApiKey(rawApiKey: string): RegisteredApp | null {
    const candidateHash = sha256HexOf(rawApiKey);
    for (const app of this.apps) {
      if (hashesEqual(app.apiKeyHashHex, candidateHash)) return app;
    }
    return null;
  }

  getById(id: string): RegisteredApp | undefined {
    return this.apps.find((app) => app.id === id);
  }
}
