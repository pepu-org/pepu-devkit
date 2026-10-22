import type { Address, PublicClient, TransactionRequest, Transport } from "viem";
import { formatUnits } from "viem";

import { ARB_GAS_INFO_ADDRESS, arbGasInfoAbi } from "./abi/arbGasInfo.js";
import type { PepuChain } from "./chains.js";

/**
 * PEPU's two-part Nitro gas price, read live from the `ArbGasInfo`
 * precompile (`0x...6C`, fixed on every Arbitrum Orbit/Nitro chain). See
 * {@link explainDualFeeModel} for what each field means and why, on PEPU
 * specifically, one of them is currently zero.
 */
export interface NitroFeeBreakdown {
  /**
   * L2 execution price, in wei per gas unit. This is `perArbGasTotal` from
   * `getPricesInWei()` — `perArbGasBase` (the network's floor) plus
   * `perArbGasCongestion` (demand surcharge, `0` when the chain isn't
   * congested). Tracks the block's own `baseFeePerGas`.
   */
  readonly l2PricePerGasWei: bigint;
  /**
   * L1 data-posting price, in wei per L1-calldata-unit (`perL1CalldataUnit`
   * from `getPricesInWei()`). Verified `0` on PEPU mainnet as of
   * 2026-09-24 — see {@link explainDualFeeModel}.
   */
  readonly l1PricePerCalldataUnitWei: bigint;
  /**
   * `ArbGasInfo`'s own estimate of the L1 base fee it would need to post
   * data at, in wei. Verified `0` on PEPU mainnet as of 2026-09-24,
   * consistent with `l1PricePerCalldataUnitWei` being `0`.
   */
  readonly l1BaseFeeEstimateWei: bigint;
}

/**
 * Read the current {@link NitroFeeBreakdown} from the `ArbGasInfo`
 * precompile. One `eth_call` (`getPricesInWei()`) plus one more
 * (`getL1BaseFeeEstimate()`) — no caching, since these can change block to
 * block under load.
 */
export async function getNitroFeeBreakdown(
  client: PublicClient<Transport, PepuChain>,
): Promise<NitroFeeBreakdown> {
  const [prices, l1BaseFeeEstimateWei] = await Promise.all([
    client.readContract({
      address: ARB_GAS_INFO_ADDRESS,
      abi: arbGasInfoAbi,
      functionName: "getPricesInWei",
    }),
    client.readContract({
      address: ARB_GAS_INFO_ADDRESS,
      abi: arbGasInfoAbi,
      functionName: "getL1BaseFeeEstimate",
    }),
  ]);
  return {
    l2PricePerGasWei: prices[5], // perArbGasTotal
    l1PricePerCalldataUnitWei: prices[1], // perL1CalldataUnit
    l1BaseFeeEstimateWei,
  };
}

/** Plain-English explanation of Arbitrum Nitro's dual-fee model, as it currently behaves on PEPU. */
export interface DualFeeModelExplanation {
  readonly summary: string;
  readonly l2ExecutionFee: string;
  readonly l1DataPostingFee: string;
  readonly pepuStatus: string;
}

/**
 * Explain Arbitrum Nitro's dual-fee gas model in plain English, including
 * how it currently behaves on PEPU specifically (verified live against
 * mainnet 2026-09-24 — see the doc comment on `arbGasInfoAbi` in
 * `./abi/arbGasInfo.ts` for the exact call and response this is based on).
 *
 * This is a static explanation (no network call) — pair it with
 * {@link getNitroFeeBreakdown} for live numbers.
 */
export function explainDualFeeModel(): DualFeeModelExplanation {
  return {
    summary:
      "Arbitrum Nitro chains (PEPU included — it's an Orbit chain built on " +
      "Nitro) charge gas as the sum of two independent components, unlike " +
      "a plain L1 chain where 'gas price' is a single number: an L2 " +
      "execution fee (compute + storage, priced in the chain's own gas " +
      "units) and an L1 data-posting fee (the cost of publishing the " +
      "transaction's calldata back to the settlement layer, priced " +
      "per byte of calldata, independent of how much EVM computation " +
      "the transaction does).",
    l2ExecutionFee:
      "Works like a normal EVM gas price: gasUsed * pricePerGas, where " +
      "pricePerGas is ArbGasInfo's perArbGasTotal (perArbGasBase, the " +
      "network floor, plus perArbGasCongestion, a demand surcharge that's " +
      "0 when the chain isn't congested). On PEPU mainnet this floor is " +
      "12,500 gwei (12,500,000,000,000 wei) — see the note on " +
      "l1DataPostingFee below for why that number looks alarming but " +
      "isn't.",
    l1DataPostingFee:
      "Normally: calldataBytes-derived 'L1 gas units' * perL1CalldataUnit, " +
      "recovering the cost of posting the tx's data to the settlement " +
      "layer (L1 for a vanilla Orbit chain, or the Data Availability " +
      "Committee for an AnyTrust chain like PEPU). Verified live on PEPU " +
      "mainnet 2026-09-24: both perL1CalldataUnit and getL1BaseFeeEstimate() " +
      "read 0. That means PEPU is not currently charging a separate L1/DA " +
      "data fee component at all — the full cost of a PEPU transaction " +
      "today is just the L2 execution fee above. This is a live chain " +
      "parameter, not a protocol guarantee; re-check with " +
      "getNitroFeeBreakdown() rather than assuming it stays 0 forever.",
    pepuStatus:
      "Net effect: a PEPU 'gas price' of 12,500 gwei looks like an " +
      "Ethereum-mainnet congestion spike if you only know Ethereum's " +
      "1-50 gwei range, but PEPU is a low-value token, so the same gas " +
      "price multiplied out is a tiny PEPU (and USD) amount. Naive gwei " +
      "formatting misleads on both ends — the gwei number reads as scary, " +
      "and formatting a total cost with the same few-decimal-places habit " +
      "people use for ETH rounds small-but-real PEPU amounts to '0'. Use " +
      "formatPepu() for totals and formatPepuGasPrice() when you want to " +
      "show the price-per-gas number with that context attached.",
  };
}

/** Result of {@link estimateTransactionCost}. */
export interface TransactionCostEstimate {
  /** Estimated gas units, from `client.estimateGas`. */
  readonly gas: bigint;
  /** L2 execution price per gas unit, in wei, used for this estimate. */
  readonly gasPriceWei: bigint;
  /** `gas * gasPriceWei`, in wei. Does not include an L1 data-posting fee — see {@link explainDualFeeModel}. */
  readonly costWei: bigint;
  /** {@link costWei} formatted with {@link formatPepu}, for direct display. */
  readonly costFormatted: string;
}

/**
 * Estimate a transaction's PEPU cost: `client.estimateGas(request)` for the
 * gas units, multiplied by the current L2 execution price
 * (`getNitroFeeBreakdown`'s `l2PricePerGasWei`, which tracks the latest
 * block's `baseFeePerGas`).
 *
 * Deliberately excludes any L1 data-posting fee — see
 * {@link explainDualFeeModel} for why that component reads as `0` on PEPU
 * today, and re-derive this estimate if that ever changes.
 */
export async function estimateTransactionCost(
  client: PublicClient<Transport, PepuChain>,
  request: TransactionRequest & { account?: Address },
): Promise<TransactionCostEstimate> {
  const [gas, { l2PricePerGasWei }] = await Promise.all([
    client.estimateGas(request),
    getNitroFeeBreakdown(client),
  ]);
  const costWei = gas * l2PricePerGasWei;
  return {
    gas,
    gasPriceWei: l2PricePerGasWei,
    costWei,
    costFormatted: formatPepu(costWei),
  };
}

/** Options for {@link formatPepu}. */
export interface FormatPepuOptions {
  /**
   * Maximum fractional digits to keep after trimming trailing zeros.
   * Default `8` — high enough that typical PEPU gas costs (a low-value
   * token at a 12,500 gwei base fee) don't round down to `"0"`, which is
   * exactly the failure mode a default ETH-style 4-decimal formatter hits
   * here.
   */
  readonly maxDecimals?: number;
  /** Append `" PEPU"` to the result. Default `true`. */
  readonly suffix?: boolean;
}

/**
 * Format a wei amount as PEPU, tuned for a low-value token on a chain with
 * a comparatively large (12,500 gwei) base fee — see
 * {@link explainDualFeeModel}. Plain `formatEther`-style formatting (a
 * handful of decimal places, as is reasonable for ETH) collapses typical
 * PEPU amounts to `"0.0000"`; this keeps up to `maxDecimals` significant
 * fractional digits instead, trimming only trailing zeros.
 *
 * This is a display formatter, not an arbitrary-precision one — it does
 * not round-trip back to the exact wei value, and is not meant to.
 */
export function formatPepu(wei: bigint, options?: FormatPepuOptions): string {
  const maxDecimals = options?.maxDecimals ?? 8;
  const suffix = options?.suffix ?? true;

  const negative = wei < 0n;
  const full = formatUnits(negative ? -wei : wei, 18);
  const [whole = "0", fraction = ""] = full.split(".");
  const truncatedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  const body = truncatedFraction.length > 0 ? `${whole}.${truncatedFraction}` : whole;
  const withSign = negative ? `-${body}` : body;
  return suffix ? `${withSign} PEPU` : withSign;
}

/**
 * Format any token amount (smallest unit) as a short decimal string, for any
 * `decimals`. Truncates (never rounds) to `maxFractionDigits` (default 4) and
 * trims trailing zeros, like {@link formatPepu} but without the PEPU suffix and
 * 18-decimals assumption. Display only: it does not round-trip.
 *
 * @example
 * formatUnitsCompact(1_234_567n, 6); // "1.2345"
 * formatUnitsCompact(5n * 10n ** 18n, 18); // "5"
 */
export function formatUnitsCompact(value: bigint, decimals: number, maxFractionDigits = 4): string {
  const negative = value < 0n;
  const [whole = "0", fraction = ""] = formatUnits(negative ? -value : value, decimals).split(".");
  const frac = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  const body = frac.length > 0 ? `${whole}.${frac}` : whole;
  return negative && body !== "0" ? `-${body}` : body;
}

/**
 * Format a wei-per-gas price for display, with an explicit note that
 * PEPU's baseline (~12,500 gwei) is not a congestion spike — see
 * {@link explainDualFeeModel}. Bare "N gwei" output, without that context,
 * is exactly the naive formatting this package's brief calls out as
 * misleading for PEPU.
 */
export function formatPepuGasPrice(weiPerGas: bigint): string {
  const gwei = formatUnits(weiPerGas, 9);
  return `${gwei} gwei/gas (PEPU's normal baseline is ~12,500 gwei — this is not a congestion spike; see explainDualFeeModel())`;
}

/**
 * Default safety margin applied on top of a raw gas estimate before
 * {@link maxSendableAmount} computes its answer, in basis points
 * (`2000` = 20%).
 *
 * Why a margin at all: the L2 price behind {@link estimateTransactionCost}
 * (`ArbGasInfo.getPricesInWei().perArbGasTotal`) is read live and tracks
 * the *current* block's `baseFeePerGas`. A "max send" button estimates
 * cost, fills `balance - cost` into the amount field, and then waits for
 * the user to review and confirm — by the time the signed transaction
 * actually lands, at least one block (often more, if the user pauses to
 * look at the number) has passed, and the price can have moved in that
 * gap. Spending every last wei on `value` against a stale estimate is
 * exactly the failure this button exists to prevent: a transaction that
 * reverts for insufficient funds after the user was told this amount was
 * safe.
 *
 * Why 20% specifically: this repo already uses a 20% margin for the
 * sibling problem of gas-*limit* drift between estimate and execution
 * (`templates/game-app/lib/tap-transaction.ts`'s `withGasLimitBuffer`),
 * and that figure — a standard, conservative buffer used broadly across
 * production transaction-sending code, not one tuned from measured PEPU
 * data — is reused here for gas-*price* drift for the same reason. Two
 * things make being generous here cheap specifically on PEPU: (1) this
 * package has only ever observed PEPU's base fee sitting flat at a
 * 12,500 gwei floor with a `0` congestion surcharge (see
 * {@link explainDualFeeModel}), so the realistic gap this margin covers
 * is currently close to zero; and (2) PEPU is a low-value token, so 20%
 * of an already-tiny gas cost is an even tinier absolute amount left
 * unspent. If PEPU's fee market ever becomes genuinely congested
 * (`perArbGasCongestion` reading nonzero), re-derive this default from
 * observed volatility rather than assuming 20% still covers it.
 */
export const DEFAULT_MAX_SEND_MARGIN_BPS = 2000;

function assertValidMarginBps(marginBps: number): void {
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps > 10_000) {
    throw new Error(
      `maxSendableAmount: marginBps must be an integer between 0 and 10000 (got ${marginBps})`,
    );
  }
}

/** Options for {@link maxSendableAmount}. */
export interface MaxSendableAmountOptions {
  /** Client to estimate gas against. */
  readonly client: PublicClient<Transport, PepuChain>;
  /**
   * The sender's address — used as `estimateGas`'s `account`, and (when
   * {@link MaxSendableAmountOptions.to} is omitted) as the estimate's
   * destination too. See `to`'s doc comment.
   */
  readonly from: Address;
  /**
   * The transfer's real destination, if the user has typed one in yet.
   * Estimating against the *actual* recipient matters whenever it's a
   * contract with a `receive()`/`fallback()` that does real work — a
   * generic placeholder address would silently under-estimate that case.
   *
   * Omit this (or don't call {@link maxSendableAmount} at all yet — the
   * caller decides when a "recipient" is valid enough to estimate
   * against) before the user has entered a recipient. This function then
   * falls back to estimating a self-transfer (`to: from`), the best
   * available stand-in for "a plain native transfer to *some* EOA," which
   * is what most PEPU sends are.
   */
  readonly to?: Address;
  /**
   * The sender's current native balance, in wei (e.g. from wagmi's
   * `useBalance` or viem's `getBalance`).
   */
  readonly balanceWei: bigint;
  /**
   * Safety margin on top of the raw estimated cost, in basis points.
   * Default {@link DEFAULT_MAX_SEND_MARGIN_BPS} — see its doc comment for
   * why 20%. Must be an integer in `[0, 10000]`.
   */
  readonly marginBps?: number;
}

/**
 * Result of {@link maxSendableAmount} — a discriminated union on `status`
 * so callers can't accidentally read `amountWei` off a result where there
 * isn't one.
 */
export type MaxSendableAmountResult =
  | {
      readonly status: "ok";
      /** The amount safe to fill into a "Max" field: `balanceWei - totalReservedWei`. Always `> 0n`. */
      readonly amountWei: bigint;
      /** The gas estimate this result was computed from. */
      readonly estimate: TransactionCostEstimate;
      /** The safety margin on top of `estimate.costWei`, in wei. */
      readonly marginWei: bigint;
      /** `estimate.costWei + marginWei` — the total withheld from `balanceWei`. */
      readonly totalReservedWei: bigint;
    }
  | {
      /** `balanceWei` was `0` (or negative) — nothing to size a transfer from, no network call was made. */
      readonly status: "zero-balance";
      /** Human-readable explanation, safe to render directly. */
      readonly reason: string;
    }
  | {
      /** `balanceWei` doesn't cover even `estimate.costWei` plus the margin — a "max" send would be `<= 0`. */
      readonly status: "insufficient-for-gas";
      /** Human-readable explanation, safe to render directly. */
      readonly reason: string;
      /** The gas estimate this result was computed from. */
      readonly estimate: TransactionCostEstimate;
      /** `estimate.costWei + marginWei` — what the balance would have needed to cover. */
      readonly totalReservedWei: bigint;
    };

/**
 * Compute the largest amount a sender can put in a native transfer's
 * `value` and still expect it to succeed: `balance - estimatedCost -
 * safetyMargin`.
 *
 * This is deliberately not `balance - gasLimit * gasPrice` computed by
 * hand — see {@link explainDualFeeModel} for why that naive formula is
 * wrong on an Arbitrum Nitro chain like PEPU in general (a second,
 * L1-data-posting fee component can apply on top of L2 execution). In
 * practice this function sidesteps the whole question by never
 * reimplementing Nitro's fee math itself: it hands the real transfer off
 * to {@link estimateTransactionCost}, which calls the chain's own
 * `eth_estimateGas` (Nitro-aware by construction — the node, not this
 * package, knows its own fee model) and reads the live L2 price from the
 * `ArbGasInfo` precompile. If PEPU ever starts charging a nonzero L1
 * component too, `estimateTransactionCost` documents exactly where that
 * would need to be added, and this function inherits the fix for free.
 *
 * THE CIRCULARITY THIS AVOIDS: the whole point of this call is to
 * discover what the max `value` should be, so it can't estimate gas
 * using that unknown value. It also can't reuse `balanceWei` as a stand-in
 * `value` for the estimate — most RPCs simulate `eth_estimateGas` against
 * the sender's real current balance, and a `value` equal to the full
 * balance leaves exactly `0` left over to cover the fee with, so the
 * simulation would itself fail with "insufficient funds" instead of
 * returning a usable number. Instead, this estimates with a nominal `1n`
 * wei placeholder. That's a safe stand-in because, for a plain native
 * transfer (no calldata), gas usage doesn't depend on *how much* value
 * moves — only on whether `to` has code that reacts to receiving value at
 * all, which `1n` (any nonzero amount) already exercises. The one case
 * this can still under-estimate: a recipient contract whose
 * `receive()`/`fallback()` branches on the exact `msg.value` it got
 * (e.g. cheaper for small amounts, pricier for large ones) — an inherent
 * limit of estimating "the max" before the max is known, not specific to
 * this implementation.
 *
 * Handles the edge cases a naive subtraction gets wrong:
 * - `balanceWei <= 0n` → `{ status: "zero-balance" }`, no network call.
 * - `balanceWei` covers less than `estimate.costWei` plus the margin →
 *   `{ status: "insufficient-for-gas" }` rather than a negative or `0`
 *   amount.
 * - Estimation itself failing (bad RPC, reverting recipient, etc.) →
 *   this function does not catch that; the returned promise rejects with
 *   whatever `estimateTransactionCost`/`client.estimateGas` threw, so a
 *   caller can show the real reason instead of silently falling back to a
 *   guess.
 *
 * NOT WIRED INTO `templates/consumer-app`: that template's send form
 * dropped its "Max" button rather than consume this helper. The reason
 * isn't a bug here — it's that Privy's transaction confirmation modal
 * runs its own, separately-implemented pre-flight balance check before
 * signing, and on PEPU that check has been observed to be over-conservative
 * enough to reject a transfer this function correctly sized as affordable
 * (e.g. a 0.7748 PEPU balance refused for a 0.2625 PEPU transfer). Since
 * Privy's modal has the final say on whether the transaction goes out, a
 * "Max" fill computed by this function can still bounce there, which makes
 * the button promise something the wallet UI can't reliably deliver. This
 * function stays correct and is still the right tool for any PEPU wallet
 * UI that isn't routing its send flow through Privy's modal — just don't
 * assume the absence of a "Max" button in that one template means this
 * helper is unused or unmaintained.
 */
export async function maxSendableAmount(
  options: MaxSendableAmountOptions,
): Promise<MaxSendableAmountResult> {
  const {
    client,
    from,
    to,
    balanceWei,
    marginBps = DEFAULT_MAX_SEND_MARGIN_BPS,
  } = options;
  assertValidMarginBps(marginBps);

  if (balanceWei <= 0n) {
    return {
      status: "zero-balance",
      reason: "This wallet has no PEPU to send.",
    };
  }

  const estimate = await estimateTransactionCost(client, {
    account: from,
    to: to ?? from,
    value: 1n,
  });

  const marginWei = (estimate.costWei * BigInt(marginBps)) / 10_000n;
  const totalReservedWei = estimate.costWei + marginWei;

  if (balanceWei <= totalReservedWei) {
    return {
      status: "insufficient-for-gas",
      reason:
        `Balance (${formatPepu(balanceWei)}) doesn't cover the estimated ` +
        `cost of sending plus a safety margin (${formatPepu(totalReservedWei)} ` +
        `would need to be reserved for gas). Add more PEPU before sending.`,
      estimate,
      totalReservedWei,
    };
  }

  return {
    status: "ok",
    amountWei: balanceWei - totalReservedWei,
    estimate,
    marginWei,
    totalReservedWei,
  };
}
