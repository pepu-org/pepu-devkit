/**
 * Composition root for the v2 path. `createSponsorshipRuntime` returns `null` (and constructs nothing, opens no file,
 * makes no RPC call) unless SPONSORSHIP_V2_ENABLED=true; index.ts only mounts what this returns.
 */
import type { LocalAccount } from "viem";
import { createViemChainReader } from "./chain.js";
import { describeConfig, loadSponsorshipConfig } from "./config.js";
import { SponsorshipDb } from "./db.js";
import { SponsorshipEngine } from "./engine.js";
import { createPublicClient, http } from "viem";
import { createKernelAddressDeriver, viemKernelFactoryReader } from "./kernelOwnership.js";
import { IdentityService, createPrivyIdentityResolver, type PrivyLike } from "./identity.js";
import { createSponsorshipV2, type SponsorshipV2 } from "./api.js";
import { createPrivyRestSecretVerifier, type PrivySecretVerifier } from "./projectVerify.js";
import { RateLimiter } from "./rateLimit.js";
import { Reconciler } from "./reconciler.js";
import { SiweAuth } from "./siwe.js";

export interface SponsorshipRuntime {
  api: SponsorshipV2;
  close(): void;
}

export function createSponsorshipRuntime(params: {
  signerAccount: LocalAccount;
  privy: PrivyLike;
  /** Privy app id this process holds credentials for (identity can only be verified for it). */
  privyAppId?: string;
  defaultDbDir: string;
  /** Overrides the Privy REST secret check (tests). */
  privySecretVerifier?: PrivySecretVerifier;
  env?: Record<string, string | undefined>;
}): SponsorshipRuntime | null {
  const env = params.env ?? process.env;
  const config = loadSponsorshipConfig(env, { dbDir: params.defaultDbDir });
  if (!config) return null;

  const db = new SponsorshipDb(config.dbPath);
  const chain = createViemChainReader({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    paymasterAddress: config.paymasterAddress,
    deployBlock: config.deployBlock,
    logChunkBlocks: config.logChunkBlocks,
    cacheTtlMs: config.chainCacheTtlMs,
  });
  const appId = params.privyAppId ?? env.PRIVY_APP_ID;
  const resolvers = new Map(appId ? [[appId, createPrivyIdentityResolver(params.privy)] as const] : []);
  const kernelReader = viemKernelFactoryReader(createPublicClient({ transport: http(config.rpcUrl) }) as never);
  const identity = new IdentityService({
    resolvers,
    deriveKernelAddress: createKernelAddressDeriver({
      factory: config.kernel.factory,
      validator: config.kernel.ecdsaValidator,
      index: config.kernel.index,
      read: kernelReader,
    }),
    requireSenderOwnership: config.requireSenderOwnership,
    cacheTtlMs: config.identityCacheTtlMs,
    negativeCacheTtlMs: config.identityNegativeCacheTtlMs,
  });
  const engine = new SponsorshipEngine({
    db,
    chain,
    identity,
    signerAccount: params.signerAccount,
    config,
    clientRateLimiter: new RateLimiter({ windowMs: 60_000, max: config.rateLimits.clientTokenPerIpPerMinute }),
  });
  const siwe = new SiweAuth({ db, chain, chainId: config.chainId, config: config.siwe });
  const reconciler = new Reconciler({
    db,
    chain,
    deployBlock: config.deployBlock,
    chunkBlocks: config.logChunkBlocks,
    voidSafetyMarginSeconds: config.voidSafetyMarginSeconds,
    auditRetentionMs: config.auditRetentionDays * 86_400_000,
  });
  const api = createSponsorshipV2({
    config,
    db,
    chain,
    engine,
    siwe,
    identity,
    reconciler,
    signerAccount: params.signerAccount,
    privySecretVerifier: params.privySecretVerifier ?? createPrivyRestSecretVerifier(),
  });

  const timer = setInterval(() => {
    reconciler.runOnce().catch((e: Error) => console.error("[sponsorship] reconcile failed:", e.message));
  }, config.reconcileIntervalSeconds * 1000);
  timer.unref();

  console.log("[policy-service] tiered sponsorship (v2) ENABLED:", JSON.stringify(describeConfig(config)));
  return {
    api,
    close() {
      clearInterval(timer);
      db.close();
    },
  };
}
