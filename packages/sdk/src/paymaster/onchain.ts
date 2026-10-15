import { encodeFunctionData, getAddress, isAddress, isHex, keccak256, stringToBytes } from "viem";
import type { Account, Address, Chain, Hash, Hex, PublicClient, WalletClient } from "viem";

import { pepuMainnet } from "../chains.js";
import { getContract } from "../contracts.js";
import { PepuConfigError, PepuPaymasterError } from "../errors.js";
import { pepuSponsoredPaymasterV2Abi } from "./abi.js";

/**
 * v2 (tiered, deposit-only) paymaster on-chain helpers.
 *
 * Facts these helpers encode (services/paymaster/SPONSORSHIP-SPEC.md):
 * - `projectId = keccak256(bytes(appId))`, case-sensitive.
 * - Deposits are one-way. Nobody can withdraw, owner or not. Anyone can `depositFor` any project.
 * - `claimProject` sets ONLY the owner. Nothing is sponsorable until the owner calls `setTargets`,
 *   `setDailyLimit` and `setSenderDailyLimit` (see {@link configureProject}). A project with no per-wallet
 *   limit (`setSenderDailyLimit`) is rejected on-chain.
 * - The first claim of a project that ALREADY HOLDS deposited funds is pending for the admin change delay (>= 48h):
 *   finish it with {@link encodeExecuteReclaim}. An empty project is claimed immediately.
 * - A re-claim of an owned project is timelocked (>= 48h) and the owner can cancel it once per new owner.
 * - Ownership transfer is two-step (propose, then accept).
 *
 * The contract address comes from the registry (`paymasterV2`, the deployed canary: internally reviewed 3x,
 * external audit pending). Every helper takes an explicit `paymaster` address and throws CONFIG_MISSING_ENV when there is none.
 * No transaction is ever sent without the caller's wallet client.
 */

const U112_MAX = (1n << 112n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const MAX_TARGETS_PER_CALL = 50;

/** A transaction a wallet (or smart account batch) can send. */
export interface PaymasterCall {
  to: Address;
  data: Hex;
  value: bigint;
  /** Solidity signature, for logs and UIs. */
  function: string;
}

/** The EIP-712 `ProjectClaim` attestation returned by `POST /v2/projects/verify`. */
export interface ProjectClaimAttestation {
  appId: string;
  newOwner: Address;
  nonce: string | bigint;
  deadline: string | bigint;
  signature: Hex;
}

export interface PaymasterAddressOption {
  /** v2 paymaster address. Defaults to the registry's `paymasterV2` entry once it is deployed. */
  paymaster?: Address | undefined;
}

/**
 * Resolve the v2 paymaster address: explicit option first, then the registry. Throws
 * `CONFIG_MISSING_ENV` (never guesses an address) when neither is available.
 *
 * @example
 * ```ts
 * const paymaster = resolvePaymasterV2Address("0x1111111111111111111111111111111111111111");
 * ```
 */
export function resolvePaymasterV2Address(explicit?: Address): Address {
  if (explicit !== undefined) {
    if (!isAddress(explicit, { strict: false })) {
      throw new PepuConfigError("CONFIG_MISSING_ENV", "The v2 paymaster address passed in is not a valid address.");
    }
    return getAddress(explicit);
  }
  const entry = getContract(pepuMainnet.id, "paymasterV2");
  if (entry?.status === "deployed") return entry.address;
  throw new PepuConfigError(
    "CONFIG_MISSING_ENV",
    "No v2 paymaster address is configured: the registry's paymasterV2 entry is not deployed. Pass the deployed address explicitly as `paymaster` (GET /v2/contract on the policy service returns it). Never guess one.",
  );
}

/**
 * `projectId = keccak256(bytes(appId))`. The app id is used exactly as given, so it is case-sensitive:
 * Privy app ids are lower-case cuids, and a different case is a different project.
 *
 * @example
 * ```ts
 * const projectId = computeProjectId("clx0example0app0id");
 * ```
 */
export function computeProjectId(appId: string): Hex {
  if (typeof appId !== "string" || appId.length === 0 || appId.length > 128) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "appId must be a non-empty string of at most 128 characters.");
  }
  return keccak256(stringToBytes(appId));
}

/** Plan name for {@link computeProjectId}. */
export const getProjectId = computeProjectId;

function assertProjectId(projectId: Hex): Hex {
  if (!isHex(projectId, { strict: true }) || projectId.length !== 66) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "projectId must be a 0x-prefixed 32-byte hex string.");
  }
  return projectId;
}

function amount(label: string, v: bigint, max: bigint): bigint {
  if (typeof v !== "bigint" || v <= 0n || v > max) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", `${label} must be a bigint greater than 0 and within range.`);
  }
  return v;
}

function call(to: Address, data: Hex, fn: string, value = 0n): PaymasterCall {
  return { to, data, value, function: fn };
}

/** State of a project, read from the paymaster contract. */
export interface ProjectState {
  projectId: Hex;
  paymaster: Address;
  /** `null` when unclaimed. */
  owner: Address | null;
  claimed: boolean;
  paused: boolean;
  /** Deposited, unspent wei. Deposit-only: this can only be spent as gas, never withdrawn. */
  balance: bigint;
  dailyLimit: bigint;
  senderDailyLimit: bigint;
  /** Spent in the current UTC day (0 when the stored day is stale). */
  spentToday: bigint;
  /** Day index (unix seconds / 86400) the stored `spentToday` belongs to. */
  spentDay: number;
  /** True when claimed and both limits are set. Targets are checked via `targetsAllowed`. */
  limitsConfigured: boolean;
  /**
   * Pending timelocked claim, or `null`: a re-claim of an owned project, or (when `claimed` is false) the first
   * claim of a project that already holds funds. Finish it with {@link encodeExecuteReclaim} after `executableAt`.
   */
  pendingReclaim: { newOwner: Address; executableAt: number; signer: Address } | null;
  /** Address proposed in a two-step ownership transfer, or `null`. */
  pendingOwner: Address | null;
  /** Present when `checkTargets` was passed: allowed flag per address (checksummed keys). */
  targetsAllowed?: Record<Address, boolean>;
}

const ZERO = "0x0000000000000000000000000000000000000000";

export interface ReadProjectOptions extends PaymasterAddressOption {
  /** Also check these destinations against the on-chain allowlist (one `isTargetAllowed` read each). */
  checkTargets?: readonly Address[];
  /** Clock override for the day rollover (tests). Milliseconds. */
  now?: () => number;
}

/**
 * Read a project's on-chain state: owner, pause flag, balance, limits, pending re-claim and pending owner.
 *
 * @example
 * ```ts
 * const p = await readProject(publicClient, computeProjectId(appId), { paymaster });
 * if (!p.claimed) console.log("claim it first");
 * ```
 */
export async function readProject(
  client: Pick<PublicClient, "readContract">,
  projectId: Hex,
  options: ReadProjectOptions = {},
): Promise<ProjectState> {
  const paymaster = resolvePaymasterV2Address(options.paymaster);
  const id = assertProjectId(projectId);
  const abi = pepuSponsoredPaymasterV2Abi;
  const [project, reclaim, pendingOwner] = await Promise.all([
    client.readContract({ address: paymaster, abi, functionName: "getProject", args: [id] }),
    client.readContract({ address: paymaster, abi, functionName: "pendingReclaim", args: [id] }),
    client.readContract({ address: paymaster, abi, functionName: "pendingProjectOwner", args: [id] }),
  ]);
  const [owner, paused, senderDailyLimit, balance, dailyLimit, spentToday, spentDay] = project;
  const [reclaimOwner, executableAt, reclaimSigner] = reclaim;
  const claimed = owner !== ZERO;
  const today = Math.floor((options.now ?? Date.now)() / 1000 / 86_400);

  let targetsAllowed: Record<Address, boolean> | undefined;
  if (options.checkTargets && options.checkTargets.length > 0) {
    const entries = await Promise.all(
      options.checkTargets.map(async (t) => {
        const allowed = await client.readContract({
          address: paymaster,
          abi,
          functionName: "isTargetAllowed",
          args: [id, t],
        });
        return [getAddress(t), allowed] as const;
      }),
    );
    targetsAllowed = Object.fromEntries(entries) as Record<Address, boolean>;
  }

  return {
    projectId: id,
    paymaster,
    owner: claimed ? getAddress(owner) : null,
    claimed,
    paused,
    balance,
    dailyLimit,
    senderDailyLimit,
    spentToday: spentDay === today ? spentToday : 0n,
    spentDay,
    limitsConfigured: claimed && dailyLimit > 0n && senderDailyLimit > 0n,
    pendingReclaim:
      reclaimOwner !== ZERO ? { newOwner: getAddress(reclaimOwner), executableAt, signer: getAddress(reclaimSigner) } : null,
    pendingOwner: pendingOwner !== ZERO ? getAddress(pendingOwner) : null,
    ...(targetsAllowed ? { targetsAllowed } : {}),
  };
}

/**
 * Encode `depositFor(projectId)` with native PEPU as `value`. ONE-WAY: nothing can ever withdraw the deposit,
 * and the id is `keccak256` of a case-sensitive app id, so a typo deposits into a project nobody can claim.
 * Prefer {@link depositFor}, which checks the project is claimed first.
 *
 * @example
 * ```ts
 * const tx = encodeDeposit(computeProjectId(appId), 10n ** 18n, { paymaster });
 * ```
 */
export function encodeDeposit(projectId: Hex, amountWei: bigint, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "depositFor",
    args: [assertProjectId(projectId)],
  });
  return call(to, data, "depositFor(bytes32)", amount("amountWei", amountWei, U128_MAX));
}

function claimArgs(a: ProjectClaimAttestation) {
  if (!a.appId || a.appId.length > 128) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "attestation.appId must be 1 to 128 characters.");
  }
  if (!isAddress(a.newOwner, { strict: false })) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "attestation.newOwner is not a valid address.");
  }
  if (!isHex(a.signature)) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "attestation.signature must be 0x-prefixed hex.");
  }
  return {
    appId: a.appId,
    newOwner: getAddress(a.newOwner),
    nonce: BigInt(a.nonce),
    deadline: BigInt(a.deadline),
    signature: a.signature,
  };
}

/**
 * Encode `claimProject(Claim)`. The attestation fixes the owner; anyone may submit the transaction. The claim
 * sets ONLY the owner: follow with {@link configureProject}'s three calls, because nothing is sponsorable
 * until `setTargets`, `setDailyLimit` and `setSenderDailyLimit` have run. If the project already holds deposited
 * funds the claim is PENDING for the on-chain admin change delay (>= 48h): the contract owner or manager can cancel
 * it, and anyone finishes it with {@link encodeExecuteReclaim}.
 *
 * @example
 * ```ts
 * const tx = encodeClaimProject(attestation, { paymaster });
 * await walletClient.sendTransaction({ to: tx.to, data: tx.data });
 * ```
 */
export function encodeClaimProject(attestation: ProjectClaimAttestation, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "claimProject",
    args: [claimArgs(attestation)],
  });
  return call(to, data, "claimProject((string,address,uint256,uint256,bytes))");
}

/**
 * Encode `reclaimProject(Claim)`: a timelocked (>= 48h) re-claim of an already-owned project. The current owner
 * can cancel it ({@link encodeCancelReclaim}); anyone can finish it after the delay ({@link encodeExecuteReclaim}).
 *
 * @example
 * ```ts
 * const tx = encodeReclaimProject(attestation, { paymaster });
 * ```
 */
export function encodeReclaimProject(attestation: ProjectClaimAttestation, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "reclaimProject",
    args: [claimArgs(attestation)],
  });
  return call(to, data, "reclaimProject((string,address,uint256,uint256,bytes))");
}

/**
 * Pick `claimProject` or `reclaimProject` from a `/v2/projects/verify` result (its `action` field) and encode it.
 *
 * @example
 * ```ts
 * const tx = encodeClaimFromVerification(verified, { paymaster });
 * ```
 */
export function encodeClaimFromVerification(
  verified: { action: "claimProject" | "reclaimProject"; attestation: ProjectClaimAttestation },
  options: PaymasterAddressOption = {},
): PaymasterCall {
  return verified.action === "reclaimProject"
    ? encodeReclaimProject(verified.attestation, options)
    : encodeClaimProject(verified.attestation, options);
}

/**
 * Encode `executeReclaim(projectId)`: completes a pending claim or re-claim once its delay has passed (and before it
 * expires, 30 days later).
 *
 * @example
 * ```ts
 * const tx = encodeExecuteReclaim(projectId, { paymaster });
 * ```
 */
export function encodeExecuteReclaim(projectId: Hex, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "executeReclaim",
    args: [assertProjectId(projectId)],
  });
  return call(to, data, "executeReclaim(bytes32)");
}

/**
 * Encode `cancelReclaim(projectId)`: the current owner cancels a pending re-claim, ONCE per new owner (a second
 * attested re-claim by the same new owner cannot be cancelled). For a pending FIRST claim of an unowned project the
 * contract owner or manager cancels instead.
 *
 * @example
 * ```ts
 * const tx = encodeCancelReclaim(projectId, { paymaster });
 * ```
 */
export function encodeCancelReclaim(projectId: Hex, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "cancelReclaim",
    args: [assertProjectId(projectId)],
  });
  return call(to, data, "cancelReclaim(bytes32)");
}

/**
 * Encode `setTargets(projectId, targets, allowed)`: add or remove destination contracts the project sponsors
 * (at most 50 per call). Owner only.
 *
 * @example
 * ```ts
 * const tx = encodeSetTargets(projectId, [counter], true, { paymaster });
 * ```
 */
export function encodeSetTargets(
  projectId: Hex,
  targets: readonly Address[],
  allowed: boolean,
  options: PaymasterAddressOption = {},
): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  if (targets.length === 0 || targets.length > MAX_TARGETS_PER_CALL) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", `targets must contain 1 to ${MAX_TARGETS_PER_CALL} addresses per call.`);
  }
  for (const t of targets) {
    if (!isAddress(t, { strict: false })) {
      throw new PepuPaymasterError("PAYMASTER_DENIED", "targets contains an invalid address.");
    }
  }
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "setTargets",
    args: [assertProjectId(projectId), targets.map((t) => getAddress(t)), allowed],
  });
  return call(to, data, "setTargets(bytes32,address[],bool)");
}

/**
 * Encode `setDailyLimit(projectId, limitWei)`: the project's total daily gas budget. Owner only. Must be above
 * zero; a contract-side zero limit means nothing can be spent, and tightening is instant.
 *
 * @example
 * ```ts
 * const tx = encodeSetDailyLimit(projectId, 5n * 10n ** 18n, { paymaster });
 * ```
 */
export function encodeSetDailyLimit(projectId: Hex, limitWei: bigint, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "setDailyLimit",
    args: [assertProjectId(projectId), amount("limitWei", limitWei, U112_MAX)],
  });
  return call(to, data, "setDailyLimit(bytes32,uint112)");
}

/**
 * Encode `setSenderDailyLimit(projectId, limitWei)`: the per-wallet daily gas limit. Owner only.
 *
 * @example
 * ```ts
 * const tx = encodeSetSenderDailyLimit(projectId, 10n ** 17n, { paymaster });
 * ```
 */
export function encodeSetSenderDailyLimit(projectId: Hex, limitWei: bigint, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "setSenderDailyLimit",
    args: [assertProjectId(projectId), amount("limitWei", limitWei, U112_MAX)],
  });
  return call(to, data, "setSenderDailyLimit(bytes32,uint112)");
}

/**
 * Encode `setPaused(projectId, paused)`. Pausing takes effect immediately; it is the project's emergency stop.
 *
 * @example
 * ```ts
 * const stop = encodeSetPaused(projectId, true, { paymaster });
 * ```
 */
export function encodeSetPaused(projectId: Hex, paused: boolean, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "setPaused",
    args: [assertProjectId(projectId), paused],
  });
  return call(to, data, "setPaused(bytes32,bool)");
}

/**
 * Encode `proposeProjectOwner(projectId, newOwner)`: step one of the two-step ownership transfer. The new
 * owner must then call {@link encodeAcceptProjectOwnership}.
 *
 * @example
 * ```ts
 * const tx = encodeProposeProjectOwner(projectId, newOwner, { paymaster });
 * ```
 */
export function encodeProposeProjectOwner(projectId: Hex, newOwner: Address, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  if (!isAddress(newOwner, { strict: false }) || newOwner === ZERO) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "newOwner must be a non-zero valid address.");
  }
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "proposeProjectOwner",
    args: [assertProjectId(projectId), getAddress(newOwner)],
  });
  return call(to, data, "proposeProjectOwner(bytes32,address)");
}

/**
 * Encode `acceptProjectOwnership(projectId)`: step two of the ownership transfer, sent by the proposed owner.
 *
 * @example
 * ```ts
 * const tx = encodeAcceptProjectOwnership(projectId, { paymaster });
 * ```
 */
export function encodeAcceptProjectOwnership(projectId: Hex, options: PaymasterAddressOption = {}): PaymasterCall {
  const to = resolvePaymasterV2Address(options.paymaster);
  const data = encodeFunctionData({
    abi: pepuSponsoredPaymasterV2Abi,
    functionName: "acceptProjectOwnership",
    args: [assertProjectId(projectId)],
  });
  return call(to, data, "acceptProjectOwnership(bytes32)");
}

export interface ConfigureProjectParams extends PaymasterAddressOption {
  /** Give `appId` or `projectId`. */
  appId?: string;
  projectId?: Hex;
  /** Destination contracts to sponsor (the on-chain allowlist). 1 to 50. */
  targets: readonly Address[];
  /** Total daily budget, wei. */
  dailyLimitWei: bigint;
  /** Per-wallet daily budget, wei. */
  senderDailyLimitWei: bigint;
}

/**
 * The three post-claim configuration calls, in order: `setTargets(allowed = true)`, `setDailyLimit`,
 * `setSenderDailyLimit`. A project spends nothing until all three have run. All three are owner-only calls to
 * the same contract, so a smart account or batched wallet can send them in one transaction; an EOA sends them
 * one after another with {@link sendPaymasterCalls}.
 *
 * @example
 * ```ts
 * const { calls } = configureProject({
 *   appId, paymaster,
 *   targets: [counter],
 *   dailyLimitWei: 5n * 10n ** 18n,
 *   senderDailyLimitWei: 10n ** 17n,
 * });
 * await smartAccountClient.sendUserOperation({ calls: calls.map(({ to, data, value }) => ({ to, data, value })) });
 * ```
 */
export function configureProject(params: ConfigureProjectParams): { projectId: Hex; calls: PaymasterCall[] } {
  if ((params.appId === undefined) === (params.projectId === undefined)) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "configureProject needs exactly one of appId or projectId.");
  }
  const projectId = params.projectId !== undefined ? assertProjectId(params.projectId) : computeProjectId(params.appId as string);
  const o = { paymaster: params.paymaster };
  return {
    projectId,
    calls: [
      encodeSetTargets(projectId, params.targets, true, o),
      encodeSetDailyLimit(projectId, params.dailyLimitWei, o),
      encodeSetSenderDailyLimit(projectId, params.senderDailyLimitWei, o),
    ],
  };
}

type SendingWallet = Pick<WalletClient, "sendTransaction"> & { account?: Account | undefined; chain?: Chain | undefined };

/**
 * Send prepared calls one after another from a wallet client, returning the hashes. When `publicClient` is
 * given it waits for each receipt first (so a later call is not sent after an earlier one failed). The
 * transaction `value` is exactly the call's value; nothing else is added.
 *
 * @example
 * ```ts
 * const hashes = await sendPaymasterCalls(walletClient, calls, { publicClient });
 * ```
 */
export async function sendPaymasterCalls(
  walletClient: SendingWallet,
  calls: readonly PaymasterCall[],
  options: { publicClient?: Pick<PublicClient, "waitForTransactionReceipt"> } = {},
): Promise<Hash[]> {
  const account = walletClient.account;
  if (!account) {
    throw new PepuConfigError("CONFIG_MISSING_ENV", "The wallet client has no account; create it with an account.");
  }
  const chain = walletClient.chain ?? pepuMainnet;
  const hashes: Hash[] = [];
  for (const c of calls) {
    const hash = await walletClient.sendTransaction({ account, chain, to: c.to, data: c.data, value: c.value });
    hashes.push(hash);
    if (options.publicClient) {
      const receipt = await options.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new PepuPaymasterError("TX_REVERTED", `Paymaster call ${c.function} reverted (transaction ${hash}).`, {
          details: { hash, function: c.function },
        });
      }
    }
  }
  return hashes;
}

export interface DepositForParams extends PaymasterAddressOption {
  walletClient: SendingWallet;
  /** Give `appId` or `projectId`. */
  appId?: string;
  projectId?: Hex;
  amountWei: bigint;
  /**
   * Default true: read the project first and refuse when it has no owner, which catches a mistyped (case-sensitive)
   * app id before funds go to a project nobody controls. Needs `publicClient`. Pass false to fund a project its
   * owner has not claimed yet (deposits are credited and become spendable after the claim and configuration).
   */
  requireClaimed?: boolean;
  publicClient?: Pick<PublicClient, "readContract">;
}

/**
 * Deposit native PEPU into a project with the caller's wallet. ONE-WAY: nobody can withdraw it afterwards, and
 * anyone may deposit into any project. By default it first confirms the project is claimed.
 *
 * @example
 * ```ts
 * const hash = await depositFor({ walletClient, publicClient, appId, amountWei: 10n ** 18n, paymaster });
 * ```
 */
export async function depositFor(params: DepositForParams): Promise<Hash> {
  if ((params.appId === undefined) === (params.projectId === undefined)) {
    throw new PepuPaymasterError("PAYMASTER_DENIED", "depositFor needs exactly one of appId or projectId.");
  }
  const projectId = params.projectId !== undefined ? assertProjectId(params.projectId) : computeProjectId(params.appId as string);
  const tx = encodeDeposit(projectId, params.amountWei, { paymaster: params.paymaster });
  if (params.requireClaimed ?? true) {
    if (!params.publicClient) {
      throw new PepuConfigError(
        "CONFIG_MISSING_ENV",
        "depositFor checks the project is claimed by default and needs a publicClient. Pass publicClient, or requireClaimed: false to fund an unclaimed project.",
      );
    }
    const state = await readProject(params.publicClient, projectId, { paymaster: params.paymaster });
    if (!state.claimed) {
      throw new PepuPaymasterError(
        "PAYMASTER_PROJECT_NOT_CLAIMED",
        "Refusing to deposit: the project is not claimed. Check the app id spelling (it is case-sensitive), or pass requireClaimed: false. Deposits cannot be withdrawn.",
        { details: { projectId } },
      );
    }
  }
  const [hash] = await sendPaymasterCalls(params.walletClient, [tx]);
  return hash as Hash;
}
