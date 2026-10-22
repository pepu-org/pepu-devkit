import type { Address } from "viem";

import { pepuMainnet, pepuTestnet } from "./chains.js";

/**
 * Canonical keys for contracts tracked by this registry. Adding a new key
 * here (and a corresponding entry per chain below) is not a breaking
 * change for consumers that read the registry through {@link getContract}
 * or {@link listContracts}.
 */
export type PepuContractName =
  | "create2Factory"
  | "multicall3"
  | "permit2"
  | "entryPoint06"
  | "entryPoint07"
  | "kernelFactory"
  | "kernelMetaFactory"
  | "ecdsaValidator"
  | "paymaster"
  | "kernelImplementation"
  | "kernelEcdsaSignerModule"
  | "kernelCallPolicyV004"
  | "kernelTimestampPolicy"
  | "tapScore"
  | "paymasterV1"
  | "paymasterV2";

/** A contract that is confirmed live on-chain at `address`. */
export interface DeployedContract {
  readonly status: "deployed";
  /** Human-readable name, for logging/UI. */
  readonly name: string;
  /** Verified contract address. */
  readonly address: Address;
  /** Optional short note, e.g. how the address was verified. */
  readonly notes?: string;
  /**
   * ISO date (YYYY-MM-DD) on which the address was last confirmed to have
   * bytecode via `eth_getCode` against the PEPU mainnet RPC. Re-run
   * `node packages/sdk/scripts/live-check.mjs` to refresh.
   */
  readonly verifiedAt?: string;
  /**
   * True when the contract still has bytecode but must not be used (for example
   * the v1 paymaster, whose EntryPoint deposit was withdrawn). Never route new
   * work to a retired contract.
   */
  readonly retired?: true;
}

/**
 * A contract that is not yet deployed on this chain. Deliberately has no
 * `address` field — callers must not be able to accidentally read a
 * placeholder value and treat it as real. Use {@link getContract} /
 * {@link isDeployed} to narrow before reading an address.
 */
export interface PendingContract {
  readonly status: "pending";
  /** Human-readable name, for logging/UI. */
  readonly name: string;
  /** Why this contract has no verified address yet. */
  readonly reason: string;
}

export type ContractEntry = DeployedContract | PendingContract;

/** Per-chain contract catalog, keyed by {@link PepuContractName}. */
export type PepuContractRegistry = Readonly<
  Record<PepuContractName, ContractEntry>
>;

const MULTICALL3_PENDING_REASON =
  "Canonical Multicall3 (0xcA11bde05977b3631167028862bE2a173976CA11) was " +
  "deployed elsewhere via a pre-signed CREATE transaction with a " +
  "1,000,000 gas limit. This Arbitrum Nitro chain needs ~14.3M gas to " +
  "deploy the same bytecode, so that transaction cannot execute here and " +
  "the canonical address is unreachable. A PEPU-specific deployment is " +
  "pending; do not substitute the canonical address.";

const MULTICALL3_MAINNET_NOTES =
  "PEPU-specific deployment. NOT at the canonical Multicall3 address, " +
  "which is unreachable on this Nitro chain (the canonical pre-signed " +
  "CREATE tx carries a 1,000,000 gas limit; this bytecode needs ~14.3M). " +
  "Deployed from canonical mds1/multicall3 source (solc 0.8.12, optimizer " +
  "10,000,000 runs) via the CREATE2 deterministic deployer with a zero " +
  "salt, so the same source reproduces this address on any chain that has " +
  "that deployer. Verified on pepuscan. viem/wagmi multicall confirmed " +
  "working against it.";

const ZERODEV_NOTES =
  "Deployed by ZeroDev's one-click Conduit Marketplace integration " +
  "(mainnet only — not present on testnet).";

const PERMIT2_PENDING_REASON =
  "Not yet deployed on this chain. The CREATE2 deterministic deployer " +
  "needed to reproduce Permit2's canonical address is live, so this is " +
  "unblocked, but no deployment has happened (and been verified) yet.";

const PERMIT2_MAINNET_NOTES =
  "Deployed at the canonical Permit2 address via the CREATE2 deterministic " +
  "deployer, same as on every other chain that has it. Verified live " +
  "2026-09-24 via eth_getCode (9,152 bytes, matching Permit2's known " +
  "bytecode size) plus a successful DOMAIN_SEPARATOR() eth_call. This is " +
  "the canonical Permit2 — do not confuse it with PepuSwap's own separate " +
  "Permit2 deployment at pepuSwapContracts.permit2NonCanonical in ./dex.js, " +
  "which predates this one and is not interchangeable with it.";

const PAYMASTER_MAINNET_NOTES =
  "Alias of `paymasterV2`: the tiered PepuSponsoredPaymasterV7 (0xdb28...C30D), deployed " +
  "around block 10537341. Owner 0x5966dFaB11c8AEe767e0739083417D02f4a634A1, manager " +
  "0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0. The free pool was seeded with 300 PEPU; free-tier " +
  "destinations are TapScore only for now. It sponsors only through the hosted policy service " +
  "(paymaster.pepeunchained.com) with the hosted bundler (bundler.pepeunchained.com). The v1 " +
  "paymaster is retired (see `paymasterV1`).";

/** Date the mainnet addresses below were last checked with eth_getCode. */
const VERIFIED_AT = "2026-10-02";

/** Date the v2 paymaster address was last checked (deployment record: deploy-receipt-v2.json). */
const PAYMASTER_V2_VERIFIED_AT = "2026-10-14";

const KERNEL_IMPL_NOTES =
  ZERODEV_NOTES +
  " Kernel v3.1 implementation that kernelFactory.implementation() resolves to; " +
  "same address ZeroDev uses on every chain with this version.";

const TAPSCORE_NOTES =
  "TapScore demo contract used by the game-app template. Verified via eth_getCode.";

const PAYMASTER_V1_NOTES =
  "RETIRED. The project's first verifying paymaster (PepuVerifyingPaymasterV7). Its EntryPoint " +
  "deposit was withdrawn (deposit is 0), so it cannot sponsor anything. The contract still has " +
  "bytecode; do not deposit to it or route new work to it. Superseded by `paymasterV2`.";

const PAYMASTER_V2_NOTES =
  "PepuSponsoredPaymasterV7 (v2), deployed on PEPU mainnet around block 10537341. Owner " +
  "0x5966dFaB11c8AEe767e0739083417D02f4a634A1, manager 0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0. " +
  "Free pool seeded with 300 PEPU; free-tier destinations are TapScore only for now. Free tier per " +
  "user is 100 PEPU/day and 50 PEPU/hour, enforced by the policy service; beyond that a dApp " +
  "deposits into its own project. Record: services/paymaster/contracts/deployed-address-v2.txt.";

const PAYMASTER_TESTNET_PENDING_REASON =
  "No paymaster (or any other ERC-4337 infrastructure) has been deployed to testnet — see " +
  "TESTNET_AA_PENDING_REASON. The mainnet paymaster is a project-specific deployment, not " +
  "something that would appear on testnet by default even once the rest of the AA stack does.";

const TESTNET_AA_PENDING_REASON =
  "Account-abstraction contracts were deployed on mainnet (97741) only, " +
  "via ZeroDev's Conduit Marketplace integration. Nothing has been " +
  "deployed to testnet, and testnet is currently out of scope (no faucet " +
  "exists, so it cannot be funded without bridging).";

/**
 * Contract registry, keyed by chain id. Tracked as independent per-chain
 * entries because deployments happen per-chain and have already diverged:
 * mainnet has the CREATE2 deployer, a PEPU-specific Multicall3, the
 * canonical Permit2, the full ZeroDev Kernel v3 AA stack (EntryPoint
 * v0.6/v0.7, Kernel factory/meta-factory, ECDSA validator), and a
 * project-deployed, funded verifying paymaster. Testnet has only the
 * CREATE2 deployer — everything else is `status: "pending"` because
 * testnet is out of scope for this package (no faucet exists to fund
 * verification there).
 *
 * Note on the paymaster specifically: `status: "deployed"` here means the
 * contract has live bytecode and a real EntryPoint deposit — it does NOT
 * mean gas sponsorship is usable by an application. See
 * `getSponsorshipStatus` in `./aa/status.js`, which is the single source of
 * truth for that separate question.
 */
export const pepuContracts: Readonly<
  Record<number, PepuContractRegistry>
> = {
  [pepuMainnet.id]: {
    create2Factory: {
      status: "deployed",
      name: "CREATE2 Deterministic Deployer",
      address: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
      verifiedAt: VERIFIED_AT,
      notes: "Standard Nick's-method deterministic deployer.",
    },
    multicall3: {
      status: "deployed",
      name: "Multicall3",
      address: "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd",
      verifiedAt: VERIFIED_AT,
      notes: MULTICALL3_MAINNET_NOTES,
    },
    permit2: {
      status: "deployed",
      name: "Permit2",
      address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      verifiedAt: VERIFIED_AT,
      notes: PERMIT2_MAINNET_NOTES,
    },
    entryPoint06: {
      status: "deployed",
      name: "ERC-4337 EntryPoint v0.6",
      address: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      verifiedAt: VERIFIED_AT,
      notes: ZERODEV_NOTES + " At the canonical v0.6 address.",
    },
    entryPoint07: {
      status: "deployed",
      name: "ERC-4337 EntryPoint v0.7",
      address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      verifiedAt: VERIFIED_AT,
      notes:
        ZERODEV_NOTES +
        " At the canonical v0.7 address; getNonce/balanceOf confirmed live.",
    },
    kernelFactory: {
      status: "deployed",
      name: "Kernel v3 Account Factory",
      address: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
      verifiedAt: VERIFIED_AT,
      notes: ZERODEV_NOTES,
    },
    kernelMetaFactory: {
      status: "deployed",
      name: "Kernel MetaFactory",
      address: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
      verifiedAt: VERIFIED_AT,
      notes: ZERODEV_NOTES,
    },
    ecdsaValidator: {
      status: "deployed",
      name: "Kernel ECDSA Validator",
      address: "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57",
      verifiedAt: VERIFIED_AT,
      notes: ZERODEV_NOTES,
    },
    paymaster: {
      status: "deployed",
      name: "Sponsored Paymaster v2 (PepuSponsoredPaymasterV7, alias of paymasterV2)",
      address: "0xdb28528C9399C33c9A0297E8A62F39145acbC30D",
      verifiedAt: PAYMASTER_V2_VERIFIED_AT,
      notes: PAYMASTER_MAINNET_NOTES,
    },
    kernelImplementation: {
      status: "deployed",
      name: "Kernel v3.1 Implementation",
      address: "0xbAC849bB641841b44E965fb01A4Bf5F074F84B4d",
      verifiedAt: VERIFIED_AT,
      notes: KERNEL_IMPL_NOTES,
    },
    kernelEcdsaSignerModule: {
      status: "deployed",
      name: "Kernel ECDSA Signer (permission signer module)",
      address: "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF",
      verifiedAt: VERIFIED_AT,
      notes: ZERODEV_NOTES + " Used as the signer in permission-validator session keys.",
    },
    kernelCallPolicyV004: {
      status: "deployed",
      name: "ZeroDev Call Policy v0.0.4",
      address: "0x9a52283276A0ec8740DF50bF01B28A80D880eaf2",
      verifiedAt: VERIFIED_AT,
      notes: ZERODEV_NOTES + " Scopes a session key to specific targets and selectors.",
    },
    kernelTimestampPolicy: {
      status: "deployed",
      name: "ZeroDev Timestamp Policy",
      address: "0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F",
      verifiedAt: VERIFIED_AT,
      notes: ZERODEV_NOTES + " Bounds a session key to a validity window.",
    },
    tapScore: {
      status: "deployed",
      name: "TapScore",
      address: "0x261eA5971B93237a56990206A46Bc80318e4d078",
      verifiedAt: VERIFIED_AT,
      notes: TAPSCORE_NOTES,
    },
    paymasterV1: {
      status: "deployed",
      name: "Verifying Paymaster v1 (PepuVerifyingPaymasterV7) - RETIRED",
      address: "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0",
      verifiedAt: VERIFIED_AT,
      retired: true,
      notes: PAYMASTER_V1_NOTES,
    },
    paymasterV2: {
      status: "deployed",
      name: "Sponsored Paymaster v2 (PepuSponsoredPaymasterV7)",
      address: "0xdb28528C9399C33c9A0297E8A62F39145acbC30D",
      verifiedAt: PAYMASTER_V2_VERIFIED_AT,
      notes: PAYMASTER_V2_NOTES,
    },
  },
  [pepuTestnet.id]: {
    create2Factory: {
      status: "deployed",
      name: "CREATE2 Deterministic Deployer",
      address: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
      notes: "Standard Nick's-method deterministic deployer.",
    },
    multicall3: {
      status: "pending",
      name: "Multicall3",
      reason: MULTICALL3_PENDING_REASON,
    },
    permit2: {
      status: "pending",
      name: "Permit2",
      reason: PERMIT2_PENDING_REASON,
    },
    entryPoint06: {
      status: "pending",
      name: "ERC-4337 EntryPoint v0.6",
      reason: TESTNET_AA_PENDING_REASON,
    },
    entryPoint07: {
      status: "pending",
      name: "ERC-4337 EntryPoint v0.7",
      reason: TESTNET_AA_PENDING_REASON,
    },
    kernelFactory: {
      status: "pending",
      name: "Kernel v3 Account Factory",
      reason: TESTNET_AA_PENDING_REASON,
    },
    kernelMetaFactory: {
      status: "pending",
      name: "Kernel MetaFactory",
      reason: TESTNET_AA_PENDING_REASON,
    },
    ecdsaValidator: {
      status: "pending",
      name: "Kernel ECDSA Validator",
      reason: TESTNET_AA_PENDING_REASON,
    },
    paymaster: {
      status: "pending",
      name: "Verifying Paymaster (PepuVerifyingPaymasterV7)",
      reason: PAYMASTER_TESTNET_PENDING_REASON,
    },
    kernelImplementation: { status: "pending", name: "Kernel v3.1 Implementation", reason: TESTNET_AA_PENDING_REASON },
    kernelEcdsaSignerModule: { status: "pending", name: "Kernel ECDSA Signer (permission signer module)", reason: TESTNET_AA_PENDING_REASON },
    kernelCallPolicyV004: { status: "pending", name: "ZeroDev Call Policy v0.0.4", reason: TESTNET_AA_PENDING_REASON },
    kernelTimestampPolicy: { status: "pending", name: "ZeroDev Timestamp Policy", reason: TESTNET_AA_PENDING_REASON },
    tapScore: { status: "pending", name: "TapScore", reason: "Deployed on mainnet only." },
    paymasterV1: { status: "pending", name: "Verifying Paymaster v1 (PepuVerifyingPaymasterV7)", reason: PAYMASTER_TESTNET_PENDING_REASON },
    paymasterV2: { status: "pending", name: "Verifying Paymaster v2", reason: PAYMASTER_TESTNET_PENDING_REASON },
  },
};

/** Look up one contract entry for a chain id. Returns `undefined` if the chain isn't in the registry. */
export function getContract(
  chainId: number,
  name: PepuContractName,
): ContractEntry | undefined {
  return pepuContracts[chainId]?.[name];
}

/** List all tracked contract entries for a chain id, in registry order. */
export function listContracts(
  chainId: number,
): readonly ContractEntry[] {
  const registry = pepuContracts[chainId];
  return registry ? Object.values(registry) : [];
}

/** Narrow a {@link ContractEntry} to {@link DeployedContract}. */
export function isDeployed(
  entry: ContractEntry | undefined,
): entry is DeployedContract {
  return entry?.status === "deployed";
}

/** One row of the address table returned by {@link getPepuAddresses}. */
export interface PepuAddressRow {
  readonly key: PepuContractName;
  readonly name: string;
  readonly status: "deployed" | "pending";
  /** Present only when `status` is `"deployed"`. */
  readonly address?: Address;
  /** ISO date of the last `eth_getCode` check, when known. */
  readonly verifiedAt?: string;
  /** True for a deployed contract that is retired and must not be used (the v1 paymaster). */
  readonly retired?: true;
  /** Notes (deployed) or reason (pending). */
  readonly note: string;
}

/**
 * The full supporting-contract table for a chain, flattened for docs and
 * MCP rendering. **Returns an ARRAY of rows** (one {@link PepuAddressRow} per
 * contract, each carrying its own `key`), not an object keyed by contract name:
 * `getPepuAddresses().paymaster` is `undefined`. To look one contract up by name use
 * {@link getContract}, or {@link getPepuAddressMap} for the same rows keyed by name.
 * Pending entries carry no `address`.
 *
 * @example
 * ```ts
 * const rows = getPepuAddresses(); // PepuAddressRow[], mainnet by default
 * const live = rows.filter((r) => r.status === "deployed");
 * const paymaster = rows.find((r) => r.key === "paymaster");
 * ```
 */
export function getPepuAddresses(chainId: number = pepuMainnet.id): readonly PepuAddressRow[] {
  const registry = pepuContracts[chainId];
  if (!registry) return [];
  return (Object.keys(registry) as PepuContractName[]).map((key): PepuAddressRow => {
    const e = registry[key];
    return e.status === "deployed"
      ? {
          key,
          name: e.name,
          status: "deployed",
          address: e.address,
          ...(e.verifiedAt ? { verifiedAt: e.verifiedAt } : {}),
          ...(e.retired ? { retired: true as const } : {}),
          note: e.notes ?? "",
        }
      : { key, name: e.name, status: "pending", note: e.reason };
  });
}

/**
 * The same rows as {@link getPepuAddresses}, keyed by contract name instead of
 * returned as an array. An unknown chain yields an empty object.
 *
 * @example
 * ```ts
 * const map = getPepuAddressMap();
 * map.paymaster?.address; // Address | undefined
 * ```
 */
export function getPepuAddressMap(chainId: number = pepuMainnet.id): Partial<Record<PepuContractName, PepuAddressRow>> {
  const out: Partial<Record<PepuContractName, PepuAddressRow>> = {};
  for (const row of getPepuAddresses(chainId)) out[row.key] = row;
  return out;
}
