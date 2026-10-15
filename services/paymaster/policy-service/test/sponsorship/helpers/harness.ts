/**
 * Shared test harness: builds an in-memory SponsorshipDb + FakeChain + engine with sensible defaults, plus
 * userOp / project helpers.
 */
import { privateKeyToAccount } from "viem/accounts";
import { numberToHex, type Address, type Hex } from "viem";
import type { SponsorUserOperationInput } from "../../../src/types.js";
import { SponsorshipDb } from "../../../src/sponsorship/db.js";
import { SponsorshipEngine, type SponsorshipEngineDeps } from "../../../src/sponsorship/engine.js";
import { IdentityService, type IdentityResolver } from "../../../src/sponsorship/identity.js";
import { projectIdOf } from "../../../src/sponsorship/paymasterData.js";
import type { FreeTierConfig, GasBounds, ReservationCaps, SponsorshipConfig } from "../../../src/sponsorship/config.js";
import type { ProjectRecord } from "../../../src/sponsorship/types.js";
import { buildSingleKernelExecuteCallData } from "../../helpers/kernelCallData.js";
import { FakeChain, PEPU } from "./fakeChain.js";

export const TEST_SIGNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const signerAccount = privateKeyToAccount(TEST_SIGNER_KEY);
export const PAYMASTER = "0x00000000000000000000000000000000000056aa" as Address;
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as Address;
export const CHAIN_ID = 97741;
export const TARGET = "0x0000000000000000000000000000000000000001" as Address;
export const OTHER_TARGET = "0x0000000000000000000000000000000000000009" as Address;
export const SENDER = "0x0000000000000000000000000000000000000042" as Address;
export const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
export const APP_ID = "privy-app-test";
/** Origin the default test projects allow for their publishable client token. */
export const ORIGIN = "https://app.example";
/** maxCost of the default userOp = (100k+100k+50k+150k+60k) * 13_000 gwei = 5.98 PEPU. */
export const DEFAULT_MAX_FEE = 13_000n * 10n ** 9n;
export const DEFAULT_MAX_COST = 460_000n * DEFAULT_MAX_FEE;

export function defaultFreeTier(over: Partial<FreeTierConfig> = {}): FreeTierConfig {
  return {
    enabled: true,
    perUserDailyWei: 50n * PEPU,
    perUserHourlyWei: 30n * PEPU,
    perUserDailyCount: 40,
    perUserHourlyCount: 20,
    ...over,
  };
}

export function defaultGasBounds(over: Partial<GasBounds> = {}): GasBounds {
  return {
    maxPreVerificationGas: 1_000_000n,
    maxVerificationGasLimit: 1_500_000n,
    maxCallGasLimit: 3_000_000n,
    maxFeeBaseFeeMultiple: 3,
    maxPriorityBaseFeeMultiple: 1,
    maxFeePerGasCapWei: 40_000n * 10n ** 9n,
    ...over,
  };
}

export function defaultReservations(over: Partial<ReservationCaps> = {}): ReservationCaps {
  return { perSenderMaxCount: 2, perIpBps: 500, perCredentialBps: 2500, minOps: 2, ...over };
}

export function buildUserOp(over: Partial<SponsorUserOperationInput> = {}): SponsorUserOperationInput {
  return {
    sender: SENDER,
    nonce: 0n,
    callData: buildSingleKernelExecuteCallData(TARGET),
    callGasLimit: 100_000n,
    verificationGasLimit: 100_000n,
    preVerificationGas: 50_000n,
    maxFeePerGas: DEFAULT_MAX_FEE,
    maxPriorityFeePerGas: 1n,
    ...over,
  };
}

/** Distinct nonces make distinct userOp hashes (the engine's idempotency key). */
let nonceCounter = 1n;
export function freshOp(over: Partial<SponsorUserOperationInput> = {}): SponsorUserOperationInput {
  return buildUserOp({ nonce: nonceCounter++, ...over });
}

export class FakeResolver implements IdentityResolver {
  tokens = new Map<string, string>(); // token -> userId
  owners = new Map<string, string>(); // sender(lower) -> userId
  throwOnLookup = false;
  lookups = 0;
  /** userId -> that user's Privy EMBEDDED wallet addresses. */
  embedded = new Map<string, Address[]>();
  throwOnList = false;
  async listEmbeddedWallets(userId: string): Promise<Address[]> {
    if (this.throwOnList) throw new Error("privy 500");
    return this.embedded.get(userId) ?? [];
  }
  async verifyToken(token: string) {
    const userId = this.tokens.get(token);
    return userId ? ({ ok: true, userId } as const) : ({ ok: false } as const);
  }
  async findOwnerBySmartWallet(sender: Address): Promise<string | null> {
    this.lookups++;
    if (this.throwOnLookup) throw new Error("privy 500");
    return this.owners.get(sender.toLowerCase()) ?? null;
  }
}

/** Resolver registry that verifies EVERY app id with one fake resolver (apps are many in tests, Privy is not). */
class AnyAppResolvers extends Map<string, IdentityResolver> {
  constructor(private readonly r: IdentityResolver) {
    super();
  }
  override has(): boolean {
    return true;
  }
  override get(): IdentityResolver {
    return this.r;
  }
}

export interface Harness {
  db: SponsorshipDb;
  chain: FakeChain;
  resolver: FakeResolver;
  identity: IdentityService;
  engine: SponsorshipEngine;
  clock: { now: number };
  config: SponsorshipEngineDeps["config"];
  /** Registers a Privy user: returns the access token that verifies as `userId`. */
  asUser(userId: string): string;
  /** Registers an on-chain-backed project (db row + chain state) and returns it with its credentials. */
  addProject(over?: { appId?: string; balance?: bigint; dailyLimit?: bigint; senderDailyLimit?: bigint; requireIdentity?: boolean; perUserCap?: bigint; targets?: Address[]; allowedOrigins?: string[] }): {
    project: ProjectRecord;
    token: string;
    serverKey: string;
    projectId: Hex;
  };
  addFreeApp(over?: { label?: string; allowedDestinations?: Address[] | null }): { project: ProjectRecord; token: string };
}

export function makeHarness(opts: { freeTier?: Partial<FreeTierConfig>; requireSenderOwnership?: boolean; withResolver?: boolean; allowAccountDeployment?: boolean; deriveKernelAddress?: (owner: Address) => Promise<Address> } = {}): Harness {
  const db = new SponsorshipDb(":memory:");
  const chain = new FakeChain();
  chain.setTargets("0x" + "00".repeat(32) as Hex, [TARGET]);
  const resolver = new FakeResolver();
  const clock = { now: 1_700_000_000_000 };
  const identity = new IdentityService({
    resolvers: opts.withResolver === false ? new Map() : new AnyAppResolvers(resolver),
    requireSenderOwnership: opts.requireSenderOwnership ?? false,
    ...(opts.deriveKernelAddress ? { deriveKernelAddress: opts.deriveKernelAddress } : {}),
    cacheTtlMs: 60_000,
    negativeCacheTtlMs: 5_000,
    now: () => clock.now,
  });
  const config: SponsorshipEngineDeps["config"] = {
    chainId: CHAIN_ID,
    paymasterAddress: PAYMASTER,
    entryPointAddress: ENTRY_POINT,
    paymasterVerificationGasLimit: 150_000n,
    paymasterPostOpGasLimit: 60_000n,
    validityWindowSeconds: 90,
    allowAccountDeployment: opts.allowAccountDeployment ?? true,
    freeTier: defaultFreeTier(opts.freeTier),
    gasBounds: defaultGasBounds(),
    reservations: defaultReservations(),
  };
  const engine = new SponsorshipEngine({ db, chain, identity, signerAccount, config, now: () => clock.now });
  let n = 0;
  return {
    db,
    chain,
    resolver,
    identity,
    engine,
    clock,
    config,
    asUser(userId) {
      const tok = `privy-token-${userId}`;
      resolver.tokens.set(tok, userId);
      return tok;
    },
    addProject(over = {}) {
      n++;
      const appId = over.appId ?? (n === 1 ? APP_ID : `${APP_ID}-${n}`);
      const projectId = projectIdOf(appId);
      const { project, token, serverKey } = db.createOnchainProject({
        projectId,
        appId,
        owner: OWNER,
        perUserDailyCapWei: over.perUserCap ?? 200n * PEPU,
        requireIdentity: over.requireIdentity ?? false,
        allowedOrigins: over.allowedOrigins ?? [ORIGIN],
        nowMs: clock.now,
      });
      chain.setProject(projectId, { balance: over.balance ?? 100n * PEPU, dailyLimit: over.dailyLimit ?? 1_000n * PEPU, senderDailyLimit: over.senderDailyLimit ?? 1_000n * PEPU });
      chain.setTargets(projectId, over.targets ?? [TARGET]);
      return { project, token, serverKey, projectId };
    },
    addFreeApp(over = {}) {
      return db.createFreeApp({ label: over.label ?? "free-demo", perUserDailyCapWei: 200n * PEPU, allowedDestinations: over.allowedDestinations ?? null, nowMs: clock.now });
    },
  };
}

export function hex(n: bigint): Hex {
  return numberToHex(n);
}
