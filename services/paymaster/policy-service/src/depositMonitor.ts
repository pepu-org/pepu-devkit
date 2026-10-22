/**
 * Pure logic for the deposit-monitor CLI (`src/cli/monitor-deposit.ts`),
 * factored out so it can be unit-tested without a chain connection or a
 * funding key. Everything chain/network-shaped (reading the live deposit,
 * sending the top-up transaction) lives in the CLI entry point itself.
 *
 * Threat-model context (see README.md "Deposit management" + "Threat
 * model"): the deployed contract enforces NO on-chain spending cap, so the
 * EntryPoint deposit is the entire blast radius of a signer-key compromise.
 * The operational answer is to keep that deposit deliberately small and
 * top it up incrementally rather than funding it once with a large amount
 * -- this module's `computeTopUpWei` is the arithmetic behind "top up back
 * to a small target, and never past a hard ceiling even if invoked
 * repeatedly or with a stale/wrong reading".
 */

export interface TopUpDecisionInput {
  /** Current EntryPoint deposit for the paymaster, in wei. */
  currentDepositWei: bigint;
  /** Alert / top-up trigger threshold, in wei. Top up only when deposit is strictly below this. */
  lowWaterMarkWei: bigint;
  /** The deposit level a top-up should bring the balance back to, in wei. */
  targetWei: bigint;
  /** Hard ceiling: a top-up must never push the resulting deposit above this, in wei. */
  maxCeilingWei: bigint;
}

export interface TopUpDecision {
  /** true iff currentDepositWei < lowWaterMarkWei. */
  isLow: boolean;
  /** Wei to send. 0n means "no top-up needed or possible". */
  topUpWei: bigint;
  /** Human-readable explanation, safe to log (no secrets). */
  reason: string;
}

/**
 * Decides whether/how much to top up. Deliberately conservative:
 *   - Never tops up when the deposit is already >= lowWaterMarkWei (even if
 *     below targetWei) -- top-ups are a response to being LOW, not a
 *     continuous rebalancing act.
 *   - Never sends an amount that would push the deposit above
 *     maxCeilingWei, even if that means topping up by less than
 *     (targetWei - currentDepositWei) or not at all. This is the hard
 *     backstop against a misconfigured target/ceiling or a runaway caller
 *     invoking top-up in a loop.
 *   - Malformed input (negative-implying invariants, e.g. maxCeilingWei <
 *     lowWaterMarkWei) is treated as "do not act" rather than guessed at.
 */
export function computeTopUpWei(input: TopUpDecisionInput): TopUpDecision {
  const { currentDepositWei, lowWaterMarkWei, targetWei, maxCeilingWei } = input;

  // maxCeilingWei is the ONE unconditional backstop -- it is authoritative
  // over targetWei no matter what targetWei is configured to (a target
  // raised above the ceiling by mistake gets silently clamped down below,
  // never rejected outright, because "the ceiling always wins" is a
  // simpler invariant to reason about under a misconfiguration than "this
  // particular combination of knobs happens to be internally consistent").
  // The only combination this function refuses to act on at all is the
  // ceiling itself being set below the low-water mark, which would make
  // "low" and "already at the hard cap" simultaneously true for every
  // balance in between -- there's no sane top-up amount in that regime.
  if (maxCeilingWei < lowWaterMarkWei) {
    return {
      isLow: currentDepositWei < lowWaterMarkWei,
      topUpWei: 0n,
      reason:
        "refusing to compute a top-up: configuration is inconsistent " +
        "(maxCeilingWei must be >= lowWaterMarkWei)",
    };
  }

  const isLow = currentDepositWei < lowWaterMarkWei;
  if (!isLow) {
    return {
      isLow: false,
      topUpWei: 0n,
      reason: `deposit ${currentDepositWei} wei is at or above the low-water mark ${lowWaterMarkWei} wei; no top-up needed`,
    };
  }

  if (currentDepositWei >= maxCeilingWei) {
    return {
      isLow: true,
      topUpWei: 0n,
      reason:
        `deposit ${currentDepositWei} wei is already at or above the hard ceiling ${maxCeilingWei} wei; ` +
        "refusing to top up further even though it is below the low-water mark (inconsistent config, or " +
        "the ceiling was lowered after funding) -- fix the thresholds instead of forcing a top-up",
    };
  }

  const effectiveTargetWei = targetWei > maxCeilingWei ? maxCeilingWei : targetWei;
  const desiredWei = effectiveTargetWei > currentDepositWei ? effectiveTargetWei - currentDepositWei : 0n;
  const roomUnderCeilingWei = maxCeilingWei - currentDepositWei;
  const topUpWei = desiredWei < roomUnderCeilingWei ? desiredWei : roomUnderCeilingWei;
  const clampNote = targetWei > maxCeilingWei ? ` (targetWei ${targetWei} clamped down to ceiling ${maxCeilingWei})` : "";

  return {
    isLow: true,
    topUpWei,
    reason:
      `deposit ${currentDepositWei} wei is below the low-water mark ${lowWaterMarkWei} wei; ` +
      `topping up by ${topUpWei} wei toward target ${effectiveTargetWei} wei${clampNote}`,
  };
}
