/**
 * In-memory `ChainReader` for tests: a scriptable stand-in for the on-chain ledger (balances, allowlists, events).
 * Mirrors the contract's semantics closely enough for the policy-service logic under test; the contract itself is
 * covered by the Foundry suite.
 */
import type { Address, Hex } from "viem";
import type { ChainReader, ContractParams } from "../../../src/sponsorship/chain.js";
import { FREE_POOL_ID } from "../../../src/sponsorship/paymasterData.js";
import type { ChainEvent, OnchainFreeConfig, OnchainSponsor } from "../../../src/sponsorship/types.js";

export const PEPU = 10n ** 18n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export class FakeChain implements ChainReader {
  sponsors = new Map<string, OnchainSponsor>();
  targets = new Map<string, Set<string>>();
  events: ChainEvent[] = [];
  /** On-chain free-pool config. There is no chain-wide ceiling. */
  freeConfig: OnchainFreeConfig = { enabled: true, maxOpCost: 40n * PEPU, senderDailyLimit: 0n };
  senderSpends = new Map<string, { day: number; spent: bigint }>();
  appIds = new Map<string, string>();
  blockNumber = 1_000n;
  blockTimestamp = 1_700_000_000;
  failReads = false;
  signatureOk = true;
  params: ContractParams = {
    adminChangeDelaySeconds: 172_800,
    postOpOverheadGas: 20_000,
    maxPostOpOverheadGas: 20_000,
    owner: "0x00000000000000000000000000000000000000f1" as Address,
    manager: "0x00000000000000000000000000000000000000f2" as Address,
    totalLiabilities: 0n,
    surplus: 0n,
    entryPointDeposit: 0n,
  };
  readonly sponsorReads: string[] = [];

  constructor() {
    this.setFree({ balance: 10_000n * PEPU });
    this.setTargets(FREE_POOL_ID, []);
  }

  private static blank(): OnchainSponsor {
    return { owner: ZERO, paused: false, senderDailyLimit: 0n, balance: 0n, dailyLimit: 0n, spentToday: 0n, spentDay: 0, maxFeePerGasCap: 10n ** 30n };
  }

  setFree(patch: Partial<OnchainSponsor>): void {
    const cur = this.sponsors.get(FREE_POOL_ID) ?? { ...FakeChain.blank(), owner: "0x00000000000000000000000000000000000000f1" as Address };
    this.sponsors.set(FREE_POOL_ID, { ...cur, ...patch });
  }

  setProject(projectId: Hex, patch: Partial<OnchainSponsor>): void {
    const key = projectId.toLowerCase();
    const cur = this.sponsors.get(key) ?? { ...FakeChain.blank(), owner: "0x00000000000000000000000000000000000000a1" as Address, dailyLimit: 1_000n * PEPU, senderDailyLimit: 1_000n * PEPU };
    this.sponsors.set(key, { ...cur, ...patch });
  }

  setTargets(sponsorId: Hex, list: Address[]): void {
    this.targets.set(sponsorId.toLowerCase(), new Set(list.map((a) => a.toLowerCase())));
  }

  async getSponsor(sponsorId: Hex): Promise<OnchainSponsor> {
    if (this.failReads) throw new Error("rpc down");
    this.sponsorReads.push(sponsorId.toLowerCase());
    return { ...(this.sponsors.get(sponsorId.toLowerCase()) ?? FakeChain.blank()) };
  }

  async getFreeConfig(): Promise<OnchainFreeConfig> {
    if (this.failReads) throw new Error("rpc down");
    return { ...this.freeConfig };
  }

  setSenderSpend(sponsorId: Hex, sender: Address, day: number, spent: bigint): void {
    this.senderSpends.set(`${sponsorId.toLowerCase()}:${sender.toLowerCase()}`, { day, spent });
  }

  async getSenderSpend(sponsorId: Hex, sender: Address): Promise<{ day: number; spent: bigint }> {
    if (this.failReads) throw new Error("rpc down");
    return this.senderSpends.get(`${sponsorId.toLowerCase()}:${sender.toLowerCase()}`) ?? { day: 0, spent: 0n };
  }

  async getProjectAppId(projectId: Hex): Promise<string | null> {
    return this.appIds.get(projectId.toLowerCase()) ?? null;
  }

  async firstDisallowedTarget(sponsorId: Hex, targets: readonly Address[]): Promise<Address | null> {
    if (this.failReads) throw new Error("rpc down");
    const set = this.targets.get(sponsorId.toLowerCase()) ?? new Set<string>();
    for (const t of targets) if (!set.has(t.toLowerCase())) return t.toLowerCase() as Address;
    return null;
  }

  async getContractParams(): Promise<ContractParams> {
    if (this.failReads) throw new Error("rpc down");
    return this.params;
  }

  async getBlockNumber(): Promise<bigint> {
    if (this.failReads) throw new Error("rpc down");
    return this.blockNumber;
  }

  /** Base fee the engine's fee bounds are checked against (default 12,500 gwei, the measured PEPU mainnet value). */
  baseFee = 12_500n * 10n ** 9n;

  async getBaseFee(): Promise<bigint> {
    if (this.failReads) throw new Error("rpc down");
    return this.baseFee;
  }

  async getBlockTimestamp(): Promise<number> {
    return this.blockTimestamp;
  }

  async getEvents(from: bigint, to: bigint): Promise<ChainEvent[]> {
    if (this.failReads) throw new Error("rpc down");
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  }

  async getSponsorEvents(sponsorId: Hex): Promise<ChainEvent[]> {
    const id = sponsorId.toLowerCase();
    return this.events.filter((e) => {
      const a = (e.args.sponsorId ?? e.args.projectId) as string | undefined;
      return a?.toLowerCase() === id;
    });
  }

  async getProjectTargets(projectId: Hex): Promise<Address[]> {
    return [...(this.targets.get(projectId.toLowerCase()) ?? [])] as Address[];
  }

  async getProjectsOwnedBy(owner: Address): Promise<{ projectId: Hex; appId: string }[]> {
    return this.events
      .filter((e) => e.name === "ProjectClaimed" && (e.args.owner as string).toLowerCase() === owner.toLowerCase())
      .map((e) => ({ projectId: e.args.projectId as Hex, appId: e.args.appId as string }));
  }

  async verifySignature(_a?: Address, _m?: string, _s?: Hex): Promise<boolean> {
    return this.signatureOk;
  }
}
