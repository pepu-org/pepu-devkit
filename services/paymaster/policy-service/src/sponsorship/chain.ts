/**
 * Read-only access to the on-chain ledger (PepuSponsoredPaymasterV7). The policy service never sends transactions
 * to this contract: deposits (anyone), claims (project owners, with a signer attestation) and settings are made from
 * their own wallets, and admin configuration by the chain's admin key. There are NO withdrawals anywhere. This module only READS state and events.
 *
 * `ChainReader` is the seam the rest of the v2 code depends on, so tests inject an in-memory fake and never need an
 * RPC. `createViemChainReader` is the production implementation (viem public client + a short TTL cache so a burst
 * of requests does not become a burst of RPC calls; the cache TTL is deliberately a couple of seconds so a fresh
 * top-up is visible almost immediately).
 */
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  getAbiItem,
  http,
  keccak256,
  pad,
  toEventSelector,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { PEPU_SPONSORED_PAYMASTER_ABI } from "./abi.js";
import { FREE_POOL_ID } from "./paymasterData.js";
import type { ChainEvent, OnchainFreeConfig, OnchainSponsor } from "./types.js";

export interface ContractParams {
  /** Immutable timelock (seconds) on signer/bundler additions and project re-claims. */
  adminChangeDelaySeconds: number;
  postOpOverheadGas: number;
  /** Immutable ceiling for postOpOverheadGas (the owner can only lower it). */
  maxPostOpOverheadGas: number;
  /** address(0) once ownership is renounced. */
  owner: Address;
  manager: Address;
  totalLiabilities: bigint;
  /** EntryPoint deposit not owed to any sponsor (chain-owned). */
  surplus: bigint;
  entryPointDeposit: bigint;
}

export interface ChainReader {
  getSponsor(sponsorId: Hex, opts?: { fresh?: boolean }): Promise<OnchainSponsor>;
  getFreeConfig(): Promise<OnchainFreeConfig>;
  /** Reserved-and-spent amount for a sender on a sponsor, on the day (validAfter / 86400) the contract last updated. */
  getSenderSpend(sponsorId: Hex, sender: Address): Promise<{ day: number; spent: bigint }>;
  /** The Privy app id the project was claimed with (from its ProjectClaimed event), or null. */
  getProjectAppId(projectId: Hex): Promise<string | null>;
  /** First target that is NOT on the sponsor's on-chain allowlist, or null if all are allowed. */
  firstDisallowedTarget(sponsorId: Hex, targets: readonly Address[]): Promise<Address | null>;
  getContractParams(): Promise<ContractParams>;
  getBlockNumber(): Promise<bigint>;
  /** Current base fee per gas (wei) of the latest block. Used to bound the fees a user may ask the signer to approve. */
  getBaseFee(): Promise<bigint>;
  getBlockTimestamp(block: bigint): Promise<number>;
  /** Every paymaster event in `[fromBlock, toBlock]`, decoded, in chain order. */
  getEvents(fromBlock: bigint, toBlock: bigint): Promise<ChainEvent[]>;
  /** Events whose first indexed argument (sponsorId/projectId) equals `sponsorId`. */
  getSponsorEvents(sponsorId: Hex, fromBlock?: bigint, toBlock?: bigint): Promise<ChainEvent[]>;
  /** Current on-chain allowlist, replayed from TargetSet events and confirmed with `isTargetAllowed`. */
  getProjectTargets(projectId: Hex): Promise<Address[]>;
  getProjectsOwnedBy(owner: Address): Promise<{ projectId: Hex; appId: string }[]>;
  /** EOA signatures, ERC-1271 (Safe) and ERC-6492 are all accepted. Never throws; false on any failure. */
  verifySignature(address: Address, message: string, signature: Hex): Promise<boolean>;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 5_000,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V): void {
    if (this.ttlMs <= 0) return;
    if (this.map.size >= this.max) this.map.clear();
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

export interface ViemChainReaderOptions {
  rpcUrl: string;
  chainId: number;
  paymasterAddress: Address;
  deployBlock: bigint;
  logChunkBlocks: bigint;
  cacheTtlMs: number;
}

function toNumber(v: bigint | number): number {
  return typeof v === "bigint" ? Number(v) : v;
}

export function createViemChainReader(opts: ViemChainReaderOptions): ChainReader {
  const chain = defineChain({
    id: opts.chainId,
    name: "PEPU",
    nativeCurrency: { name: "PEPU", symbol: "PEPU", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(opts.rpcUrl, { retryCount: 2, timeout: 10_000 }) });
  const address = opts.paymasterAddress;
  const abi = PEPU_SPONSORED_PAYMASTER_ABI;

  const sponsorCache = new TtlCache<OnchainSponsor>(opts.cacheTtlMs);
  const targetCache = new TtlCache<boolean>(Math.max(opts.cacheTtlMs, 5_000));
  const targetListCache = new TtlCache<Address[]>(15_000, 500);
  const paramsCache = new TtlCache<ContractParams>(5_000, 4);
  const baseFeeCache = new TtlCache<bigint>(Math.min(Math.max(opts.cacheTtlMs, 1_000), 5_000), 2);
  let freeConfigCache: { value: OnchainFreeConfig; expiresAt: number } | null = null;

  async function getSponsor(sponsorId: Hex, o?: { fresh?: boolean }): Promise<OnchainSponsor> {
    const key = sponsorId.toLowerCase();
    if (!o?.fresh) {
      const hit = sponsorCache.get(key);
      if (hit) return hit;
    }
    const [r, feeCap] = await Promise.all([
      client.readContract({ address, abi, functionName: "getProject", args: [sponsorId] }),
      client.readContract({ address, abi, functionName: "effectiveMaxFeePerGas", args: [sponsorId] }),
    ]);
    const sponsor: OnchainSponsor = {
      maxFeePerGasCap: feeCap,
      owner: r[0],
      paused: r[1],
      senderDailyLimit: r[2],
      balance: r[3],
      dailyLimit: r[4],
      spentToday: r[5],
      spentDay: toNumber(r[6]),
    };
    sponsorCache.set(key, sponsor);
    return sponsor;
  }

  async function isAllowed(sponsorId: Hex, target: Address): Promise<boolean> {
    const key = `${sponsorId.toLowerCase()}:${target.toLowerCase()}`;
    const hit = targetCache.get(key);
    if (hit !== undefined) return hit;
    const allowed = await client.readContract({ address, abi, functionName: "isTargetAllowed", args: [sponsorId, target] });
    targetCache.set(key, allowed);
    return allowed;
  }

  function decode(log: { data: Hex; topics: readonly Hex[]; blockNumber: Hex | bigint; transactionHash: Hex; logIndex: Hex | number }): ChainEvent | null {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      return {
        name: decoded.eventName,
        args: (decoded.args ?? {}) as Record<string, unknown>,
        blockNumber: typeof log.blockNumber === "bigint" ? log.blockNumber : BigInt(log.blockNumber),
        transactionHash: log.transactionHash,
        logIndex: typeof log.logIndex === "number" ? log.logIndex : Number(BigInt(log.logIndex)),
      };
    } catch {
      return null;
    }
  }

  async function rawLogs(from: bigint, to: bigint, topics?: (Hex | null)[]): Promise<ChainEvent[]> {
    const out: ChainEvent[] = [];
    for (let start = from; start <= to; start += opts.logChunkBlocks) {
      const end = start + opts.logChunkBlocks - 1n < to ? start + opts.logChunkBlocks - 1n : to;
      const logs = (await client.request({
        method: "eth_getLogs",
        params: [{ address, fromBlock: toHex(start), toBlock: toHex(end), ...(topics ? { topics } : {}) }],
      } as never)) as unknown as {
        data: Hex;
        topics: Hex[];
        blockNumber: Hex;
        transactionHash: Hex;
        logIndex: Hex;
      }[];
      for (const l of logs) {
        const ev = decode(l);
        if (ev) out.push(ev);
      }
    }
    out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
    return out;
  }

  async function getSponsorEvents(sponsorId: Hex, from?: bigint, to?: bigint): Promise<ChainEvent[]> {
    const latest = to ?? (await client.getBlockNumber());
    return rawLogs(from ?? opts.deployBlock, latest, [null, pad(sponsorId.toLowerCase() as Hex, { size: 32 })]);
  }

  async function getProjectAppIdImpl(projectId: Hex): Promise<string | null> {
    const events = await getSponsorEvents(projectId);
    // `ProjectClaimed` (immediate claim) or `ProjectClaimProposed` (pending first claim of a funded project, review 3
    // M-1) carry the app id. Only an app id that hashes to the projectId is accepted (review 3, C-L1).
    for (const e of events) {
      if (e.name !== "ProjectClaimed" && e.name !== "ProjectClaimProposed") continue;
      const appId = e.args.appId;
      if (typeof appId === "string" && keccak256(toHex(appId)).toLowerCase() === projectId.toLowerCase()) return appId;
    }
    return null;
  }

  return {
    getSponsor,

    async getFreeConfig() {
      if (freeConfigCache && freeConfigCache.expiresAt > Date.now()) return freeConfigCache.value;
      const [enabled, maxOpCost, pool] = await Promise.all([
        client.readContract({ address, abi, functionName: "freeEnabled" }),
        client.readContract({ address, abi, functionName: "freeMaxOpCost" }),
        client.readContract({ address, abi, functionName: "getProject", args: [FREE_POOL_ID] }),
      ]);
      const value: OnchainFreeConfig = { enabled, maxOpCost, senderDailyLimit: pool[2] };
      freeConfigCache = { value, expiresAt: Date.now() + 10_000 };
      return value;
    },

    async getSenderSpend(sponsorId, sender) {
      const [day, spent] = await client.readContract({ address, abi, functionName: "getSenderSpend", args: [sponsorId, sender] });
      return { day: toNumber(day), spent };
    },

    getProjectAppId: getProjectAppIdImpl,

    async firstDisallowedTarget(sponsorId, targets) {
      const unique = [...new Set(targets.map((t) => t.toLowerCase() as Address))];
      const results = await Promise.all(unique.map((t) => isAllowed(sponsorId, t)));
      const idx = results.findIndex((ok) => !ok);
      return idx === -1 ? null : (unique[idx] as Address);
    },

    async getContractParams() {
      const hit = paramsCache.get("p");
      if (hit) return hit;
      const [adminChangeDelay, postOpOverheadGas, maxPostOpOverheadGas, owner, manager, totalLiabilities, surplus] = await Promise.all([
        client.readContract({ address, abi, functionName: "adminChangeDelay" }),
        client.readContract({ address, abi, functionName: "postOpOverheadGas" }),
        client.readContract({ address, abi, functionName: "maxPostOpOverheadGas" }),
        client.readContract({ address, abi, functionName: "owner" }),
        client.readContract({ address, abi, functionName: "manager" }),
        client.readContract({ address, abi, functionName: "totalLiabilities" }),
        client.readContract({ address, abi, functionName: "surplus" }),
      ]);
      const params: ContractParams = {
        adminChangeDelaySeconds: toNumber(adminChangeDelay),
        postOpOverheadGas: toNumber(postOpOverheadGas),
        maxPostOpOverheadGas: toNumber(maxPostOpOverheadGas),
        owner,
        manager,
        totalLiabilities,
        surplus,
        // deposit == ledgers + surplus (surplus() is the unowned remainder of the EntryPoint deposit)
        entryPointDeposit: totalLiabilities + surplus,
      };
      paramsCache.set("p", params);
      return params;
    },

    getBlockNumber: () => client.getBlockNumber(),

    async getBaseFee() {
      const hit = baseFeeCache.get("b");
      if (hit !== undefined) return hit;
      const b = await client.getBlock({ blockTag: "latest" });
      if (b.baseFeePerGas === null || b.baseFeePerGas === undefined) throw new Error("chain reports no baseFeePerGas");
      baseFeeCache.set("b", b.baseFeePerGas);
      return b.baseFeePerGas;
    },

    async getBlockTimestamp(block) {
      const b = await client.getBlock({ blockNumber: block });
      return Number(b.timestamp);
    },

    getEvents: (from, to) => rawLogs(from, to),

    getSponsorEvents,

    async getProjectTargets(projectId) {
      const key = projectId.toLowerCase();
      const hit = targetListCache.get(key);
      if (hit) return hit;
      const events = await getSponsorEvents(projectId);
      const candidates = new Set<string>();
      for (const ev of events) {
        if (ev.name === "ProjectClaimed") candidates.clear();
        if (ev.name === "TargetSet") candidates.add((ev.args.target as string).toLowerCase());
      }
      const list = [...candidates] as Address[];
      const confirmed = await Promise.all(list.map((t) => client.readContract({ address, abi, functionName: "isTargetAllowed", args: [projectId, t] })));
      const result = list.filter((_, i) => confirmed[i]);
      targetListCache.set(key, result);
      return result;
    },

    async getProjectsOwnedBy(owner) {
      // Candidates: projects first claimed by `owner`, plus projects transferred/re-claimed TO `owner`. The CURRENT owner
      // is then re-read from the contract (ownership can have moved on again).
      const latest = await client.getBlockNumber();
      const ownerTopic = pad(owner.toLowerCase() as Hex, { size: 32 });
      const claimed = toEventSelector(getAbiItem({ abi, name: "ProjectClaimed" }));
      const moved = toEventSelector(getAbiItem({ abi, name: "ProjectOwnershipTransferred" }));
      const [claims, transfers] = await Promise.all([
        rawLogs(opts.deployBlock, latest, [claimed, null, ownerTopic]),
        rawLogs(opts.deployBlock, latest, [moved, null, null, ownerTopic]),
      ]);
      const out = new Map<string, { projectId: Hex; appId: string }>();
      for (const e of claims.filter((x) => x.name === "ProjectClaimed")) {
        out.set((e.args.projectId as string).toLowerCase(), { projectId: e.args.projectId as Hex, appId: e.args.appId as string });
      }
      for (const e of transfers.filter((x) => x.name === "ProjectOwnershipTransferred")) {
        const id = e.args.projectId as Hex;
        if (!out.has(id.toLowerCase())) out.set(id.toLowerCase(), { projectId: id, appId: (await getProjectAppIdImpl(id)) ?? id });
      }
      const result: { projectId: Hex; appId: string }[] = [];
      for (const p of out.values()) {
        const current = await getSponsor(p.projectId, { fresh: true });
        if (current.owner.toLowerCase() === owner.toLowerCase()) result.push(p);
      }
      return result;
    },

    async verifySignature(signer, message, signature) {
      try {
        if (signer === ZERO_ADDRESS) return false;
        return await client.verifyMessage({ address: signer, message, signature });
      } catch {
        return false;
      }
    },
  };
}
