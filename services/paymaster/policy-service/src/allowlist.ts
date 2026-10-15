/**
 * Destination allowlist checks. Two layers, per the brief (Part 2 step 4):
 *
 *   - GLOBAL allowlist: paymaster-wide, config-driven, the hard backstop.
 *     Every sponsored destination must be on this list, no exceptions.
 *   - PER-APP allowlist: each registered app may further scope DOWN to its
 *     own subset. A destination must be allowed by BOTH lists — this is an
 *     AND relationship, not an OR. An app's `allowedDestinations: "*"` means
 *     "don't narrow further than the global list" (still subject to it).
 *
 * This AND-not-OR choice means the global list is a true ceiling no app can
 * exceed even by misconfiguration, which matches "global allowlist... the
 * hard backstop" in the brief. See README "Global vs per-app allowlist
 * relationship" for the same explanation in the shipped docs.
 */
import type { Address } from "viem";
import type { GlobalAllowlistConfig, RegisteredApp } from "./types.js";

export class Allowlist {
  private readonly globalSet: Set<string>;

  constructor(private readonly config: GlobalAllowlistConfig) {
    this.globalSet = new Set(config.destinations.map((address) => address.toLowerCase()));
  }

  isGloballyAllowed(target: Address): boolean {
    return this.globalSet.has(target.toLowerCase());
  }

  isAllowedForApp(app: RegisteredApp, target: Address): boolean {
    if (!this.isGloballyAllowed(target)) return false;
    if (app.allowedDestinations === "*") return true;
    const lower = target.toLowerCase();
    return app.allowedDestinations.some((address) => address.toLowerCase() === lower);
  }

  /** Convenience for tests/inspection. */
  get globalDestinations(): readonly Address[] {
    return this.config.destinations;
  }
}
