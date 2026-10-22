import type { Address, Hex, PublicClient, Transport } from "viem";

import { kernelFactoryAbi } from "../abi/kernelFactory.js";
import type { PepuChain } from "../chains.js";
import type { DeployedContract } from "../contracts.js";
import { getContract } from "../contracts.js";
import { PEPU_ENV, resolvePepuEndpoints } from "../endpoints.js";
import { getPaymasterDeposit, probeBundler, probePaymaster } from "./probes.js";
import type { BundlerProbeResult, FetchLike, PaymasterProbeResult } from "./probes.js";

/**
 * The account-abstraction contracts a Kernel v3 smart account needs,
 * narrowed to their {@link DeployedContract} form for a given chain.
 * Returns `undefined` if any one of them isn't deployed on that chain
 * (today: everything except mainnet, `97741`) — this package never fabricates
 * a partial/best-effort bundle.
 */
export interface PepuKernelStack {
  readonly entryPoint06: DeployedContract;
  readonly entryPoint07: DeployedContract;
  readonly kernelFactory: DeployedContract;
  readonly kernelMetaFactory: DeployedContract;
  readonly ecdsaValidator: DeployedContract;
}

/**
 * Look up every AA contract this package knows about for `chainId`, already
 * narrowed to {@link DeployedContract}. Returns `undefined` unless *all* five
 * are deployed on that chain (today, only PEPU mainnet qualifies) — a caller
 * building a Kernel account needs every one of them, so a partial result
 * would just move the "is this actually usable" check into every caller.
 *
 * This is a convenience grouping over `getContract` from `./contracts.js`;
 * it doesn't add any address or fact that registry doesn't already have.
 */
export function getPepuKernelStack(chainId: number): PepuKernelStack | undefined {
  const entryPoint06 = getContract(chainId, "entryPoint06");
  const entryPoint07 = getContract(chainId, "entryPoint07");
  const kernelFactory = getContract(chainId, "kernelFactory");
  const kernelMetaFactory = getContract(chainId, "kernelMetaFactory");
  const ecdsaValidator = getContract(chainId, "ecdsaValidator");

  if (
    entryPoint06?.status !== "deployed" ||
    entryPoint07?.status !== "deployed" ||
    kernelFactory?.status !== "deployed" ||
    kernelMetaFactory?.status !== "deployed" ||
    ecdsaValidator?.status !== "deployed"
  ) {
    return undefined;
  }

  return { entryPoint06, entryPoint07, kernelFactory, kernelMetaFactory, ecdsaValidator };
}

/**
 * Legacy static gas-sponsorship status for PEPU. **Always reports
 * unavailable** (it never probes). Sponsorship runs through the hosted bundler
 * and paymaster service (a zero-balance Kernel smart account transacts with
 * gas paid by the paymaster); use
 * `checkSponsorship()` for the live answer. This function
 * exists so nothing downstream (this package, `@pepu-chain/mcp`, an app)
 * has to independently invent an "is sponsorship on?" check, and so that
 * check can't silently start lying once this file changes.
 *
 * Do not treat the presence of `kernelFactory`/`ecdsaValidator`/`paymaster`
 * addresses in {@link getPepuKernelStack} / the contract registry as
 * sponsorship support — those let you build and deploy a Kernel account and
 * send its UserOperations through a normal `eth_sendTransaction`-style flow
 * (self-paying its own gas via the EntryPoint deposit), which is a real,
 * working feature; sponsoring that gas needs a funded project or free-tier token.
 */
export interface SponsorshipStatus {
  readonly available: false;
  readonly reason: string;
  /**
   * Extension point for a future bundler/paymaster integration. Passing a
   * URL here does **not** make sponsorship available — `available` stays
   * `false` regardless — this field only exists so a caller can start
   * wiring a URL through their own config today and have this function
   * start using it later without an API change.
   */
  readonly bundlerUrl?: string;
}

/** Options for {@link getSponsorshipStatus}. */
export interface GetSponsorshipStatusOptions {
  /** See {@link SponsorshipStatus.bundlerUrl}. Not yet used for anything. */
  readonly bundlerUrl?: string;
}

/**
 * @deprecated Always reports `available: false`. Use `checkSponsorship()` (live
 * bundler and paymaster probe) from `@pepu-chain/sdk`. Kept for 0.1 callers.
 */
export function getSponsorshipStatus(
  options?: GetSponsorshipStatusOptions,
): SponsorshipStatus {
  const reason =
    "This deprecated function never probes anything and always reports " +
    "unavailable. The hosted bundler (bundler.pepeunchained.com) and " +
    "paymaster service (paymaster.pepeunchained.com) are the defaults. Call " +
    "checkSponsorship() for the live status. A Kernel v3 smart account " +
    "without a funded project or free-tier token must still fund its own " +
    "EntryPoint deposit and pay its own gas, like a normal EOA-sent transaction.";
  return options?.bundlerUrl === undefined
    ? { available: false, reason }
    : { available: false, reason, bundlerUrl: options.bundlerUrl };
}

/**
 * Compute (or confirm) the counterfactual address of a Kernel v3 smart
 * account via the verified factory's `getAddress(data, salt)` — a thin,
 * typed pass-through, not a re-implementation.
 *
 * Deliberately does **not** build `data` (Kernel v3.1's `initialize(...)`
 * calldata: root validator, hook, validator data, hook data, init config)
 * for you. A hand-rolled encoding here would be a second, unverified copy of
 * the byte layout that ZeroDev's SDK already produces (and that has been
 * exercised against PEPU's factory through the sponsored-transaction run),
 * which is exactly the kind of invented encoding this package's rules
 * forbid for addresses. Build `data` with ZeroDev's
 * `@zerodev/sdk` (or by hand from the public Kernel v3 contracts source),
 * then pass the result here.
 */
export async function getKernelAccountAddress(
  client: PublicClient<Transport, PepuChain>,
  factory: Pick<DeployedContract, "address">,
  args: { readonly data: Hex; readonly salt: Hex },
): Promise<Address> {
  return client.readContract({
    address: factory.address,
    abi: kernelFactoryAbi,
    functionName: "getAddress",
    args: [args.data, args.salt],
  });
}

/** Live sponsorship report from {@link checkSponsorship}. */
export interface SponsorshipReport {
  /** True only when a bundler and a paymaster are configured and both answer. */
  available: boolean;
  /** `direct` when you bring your own bundler and paymaster URLs; `none` when nothing is configured. */
  transport: "direct" | "none";
  bundler: { configured: boolean; probe?: BundlerProbeResult };
  paymaster: { configured: boolean; probe?: PaymasterProbeResult; depositWei?: bigint };
  /** One sentence for a human or an agent. */
  reason: string;
  /** Concrete next steps, empty when `available`. */
  fixes: string[];
}

/** Options for {@link checkSponsorship}. */
export interface CheckSponsorshipOptions {
  bundlerUrl?: string;
  paymasterUrl?: string;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  /** When given, also read the paymaster's EntryPoint deposit. */
  publicClient?: PublicClient;
  /** Paymaster contract to read the deposit of. Defaults to PEPU's deployed paymaster. */
  paymasterAddress?: Address;
  timeoutMs?: number;
}

/**
 * Live gas-sponsorship status. Resolves the bundler and paymaster URLs from
 * options, env, then the hosted defaults (bundler.pepeunchained.com and the paymaster
 * service base; with no token URL the service is probed at its base), probes both,
 * and optionally reads the paymaster deposit. Never throws for an
 * unreachable service; it reports `available: false` with `fixes`.
 * Replaces the hard-coded {@link getSponsorshipStatus}.
 *
 * @example
 * const s = await checkSponsorship({ publicClient });
 * if (!s.available) console.log(s.reason, s.fixes);
 */
export async function checkSponsorship(options: CheckSponsorshipOptions = {}): Promise<SponsorshipReport> {
  const { bundlerUrl, paymasterUrl: erc7677Url, paymasterBaseUrl } = resolvePepuEndpoints({
    ...(options.bundlerUrl !== undefined ? { bundlerUrl: options.bundlerUrl } : {}),
    ...(options.paymasterUrl !== undefined ? { paymasterUrl: options.paymasterUrl } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
  // No token means no complete ERC-7677 URL: probe the service base (health + free-tier state) instead.
  const paymasterUrl = erc7677Url ?? paymasterBaseUrl;
  const probeOpts = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
  const fixes: string[] = [];
  if (bundlerUrl === null) fixes.push(`Set ${PEPU_ENV.bundlerUrl} to a bundler for chain 97741 (EntryPoint v0.7).`);
  if (paymasterUrl === null) fixes.push(`Set ${PEPU_ENV.paymasterUrl} to your ERC-7677 paymaster endpoint (https://paymaster.pepeunchained.com/v2/paymaster/<client token>).`);

  const [bProbe, pProbe] = await Promise.all([
    bundlerUrl === null ? undefined : probeBundler(bundlerUrl, probeOpts),
    paymasterUrl === null ? undefined : probePaymaster(paymasterUrl, probeOpts),
  ]);
  if (bProbe && !bProbe.ok) fixes.push(bProbe.error?.hint ?? "The bundler did not answer correctly.");
  if (pProbe && !pProbe.ok) fixes.push(pProbe.error?.hint ?? "The paymaster did not answer correctly.");

  let depositWei: bigint | undefined;
  if (options.publicClient) {
    try {
      depositWei = await getPaymasterDeposit(options.publicClient, options.paymasterAddress);
      if (depositWei === 0n) fixes.push("The paymaster's EntryPoint deposit is empty. Deposit PEPU to it.");
    } catch {
      // A failed read must not flip availability; the probes are the source of truth.
    }
  }

  const available = !!bProbe?.ok && !!pProbe?.ok && depositWei !== 0n;
  const configured = bundlerUrl !== null || paymasterUrl !== null;
  const reason = available
    ? "Bundler and paymaster are reachable; sponsored UserOperations can be sent."
    : !configured
      ? "No bundler or paymaster URL is configured. Set PEPU_BUNDLER_URL and PEPU_PAYMASTER_URL, or use the hosted defaults."
      : "A bundler or paymaster is configured but not fully working. See fixes.";
  return {
    available,
    transport: configured ? "direct" : "none",
    bundler: { configured: bundlerUrl !== null, ...(bProbe ? { probe: bProbe } : {}) },
    paymaster: {
      configured: paymasterUrl !== null,
      ...(pProbe ? { probe: pProbe } : {}),
      ...(depositWei !== undefined ? { depositWei } : {}),
    },
    reason,
    fixes,
  };
}
