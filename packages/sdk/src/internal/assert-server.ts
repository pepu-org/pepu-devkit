import { PepuConfigError } from "../errors.js";

/**
 * Called at import time by every server-only entry point
 * (`@pepu-chain/sdk/server`, `/privy/server`, `/session/server`,
 * `/paymaster/server`, `/combo`). Those entries sit next to secrets (Privy app
 * secret, authorization key, paymaster server keys) and must never be bundled
 * for the browser. A browser bundle that reaches one fails loudly here instead
 * of silently shipping the module.
 */
export function assertServerOnly(entry: string): void {
  if ((globalThis as { window?: unknown }).window !== undefined) {
    throw new PepuConfigError(
      "CONFIG_SERVER_ONLY",
      `${entry} is server-only and was imported in a browser bundle. Import it from a route handler, server action or script, never from client code.`,
    );
  }
}
