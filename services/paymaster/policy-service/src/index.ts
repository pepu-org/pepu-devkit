/**
 * Process entry point: loads config/env, wires up real dependencies
 * (PrivyClient, PolicyDb, AppRegistry, Allowlist, signer account), and
 * starts the HTTP server.
 */
import { dirname } from "node:path";
import type { Address } from "viem";
import { PrivyClient } from "@privy-io/node";
import {
  loadAllowlistConfig,
  loadAppRegistryConfig,
  loadConfig,
  loadEnvFiles,
} from "./config.js";
import { PolicyDb } from "./db.js";
import { AppRegistry } from "./appRegistry.js";
import { Allowlist } from "./allowlist.js";
import { createAuthCheckerFromPrivyClient } from "./privyAuth.js";
import { createSenderKeyedAuthChecker } from "./paymasterRpcAuth.js";
import { PolicyEngine, type PolicyEngineDeps } from "./policy.js";
import { createPolicyHttpServer } from "./server.js";
import { createSponsorshipRuntime } from "./sponsorship/runtime.js";
import { createViemExecutedChainReader, ExecutedReconciler } from "./executedReconciler.js";
import { createReadinessChecker } from "./ready.js";
import { createShutdownHandler } from "./shutdown.js";

function main(): void {
  loadEnvFiles();
  const config = loadConfig();

  console.log(
    `[policy-service] starting: chainId=${config.chainId} paymaster=${config.paymasterAddress} ` +
      `signer=${config.signerAccount.address} dbPath=${config.dbPath}`,
  );

  const db = new PolicyDb(config.dbPath);
  const apps = new AppRegistry(loadAppRegistryConfig(config.appsConfigPath));
  const allowlist = new Allowlist(loadAllowlistConfig(config.allowlistConfigPath));

  const privy = new PrivyClient({ appId: config.privyAppId, appSecret: config.privyAppSecret });
  const auth = createAuthCheckerFromPrivyClient(privy);

  // Everything except `auth` is shared verbatim with the paymaster-JSON-RPC
  // engine below — see paymasterRpcAuth.ts for why auth must differ and why
  // that does not mean the policy engine itself is forked.
  const sharedPolicyDeps: Omit<PolicyEngineDeps, "auth"> = {
    db,
    apps,
    allowlist,
    signerAccount: config.signerAccount,
    chainId: config.chainId,
    paymasterAddress: config.paymasterAddress,
    paymasterVerificationGasLimit: config.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: config.paymasterPostOpGasLimit,
    validityWindowSeconds: config.validityWindowSeconds,
    userAndGlobalCaps: {
      userHourlyCountCap: config.caps.userHourlyCountCap,
      userDailyCountCap: config.caps.userDailyCountCap,
      userLifetimeCountCap: config.caps.userLifetimeCountCap,
      userHourlySpendCapWei: config.caps.userHourlySpendCapWei,
      userDailySpendCapWei: config.caps.userDailySpendCapWei,
      userLifetimeSpendCapWei: config.caps.userLifetimeSpendCapWei,
      globalDailySpendCeilingWei: config.caps.globalDailySpendCeilingWei,
    },
  };

  const policy = new PolicyEngine({ ...sharedPolicyDeps, auth });

  // Second PolicyEngine instance for the ERC-7677 JSON-RPC surface
  // (paymasterRpc.ts, called via Privy's dashboard-configured "Paymaster
  // URL"): identical policy config, deliberately different auth. See
  // paymasterRpcAuth.ts's module doc comment for the full reasoning.
  const paymasterRpcPolicy = new PolicyEngine({
    ...sharedPolicyDeps,
    auth: createSenderKeyedAuthChecker(),
  });

  // v2 (tiered sponsorship): OFF unless SPONSORSHIP_V2_ENABLED=true; returns null (touching nothing) when off.
  const sponsorship = createSponsorshipRuntime({ signerAccount: config.signerAccount, privy, privyAppId: config.privyAppId, defaultDbDir: dirname(config.dbPath) });

  // Chain access (read-only) for /ready and the executed-marker reconciler. Absent in local dev without RPC_URL.
  const chain = config.rpcUrl
    ? createViemExecutedChainReader(config.rpcUrl, config.entryPointAddress as Address)
    : null;

  const ready = createReadinessChecker({
    db,
    chain,
    paymaster: config.paymasterAddress,
    minDepositWei: config.readyMinDepositWei,
    maxDepositWei: config.readyMaxDepositWei,
  });

  const reconciler =
    chain && config.reconciler.enabled
      ? new ExecutedReconciler({
          db,
          chain,
          paymaster: config.paymasterAddress,
          chunkBlocks: config.reconciler.chunkBlocks,
          lookbackBlocks: config.reconciler.lookbackBlocks,
          startBlock: config.reconciler.startBlock,
          confirmations: config.reconciler.confirmations,
        })
      : null;
  if (!reconciler) {
    console.warn(
      "[policy-service] executed-marker reconciler is OFF (no RPC_URL or RECONCILER_ENABLED=false): caps under-count after valid_until",
    );
  }

  const server = createPolicyHttpServer({
    ready,
    ...(sponsorship ? { sponsorshipV2: sponsorship.api } : {}),
    policy,
    db,
    adminToken: config.adminToken,
    paymasterRpc: {
      policy: paymasterRpcPolicy,
      entryPointAddress: config.entryPointAddress as Address,
      chainId: config.chainId,
      paymasterAddress: config.paymasterAddress,
      paymasterVerificationGasLimit: config.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: config.paymasterPostOpGasLimit,
      validityWindowSeconds: config.validityWindowSeconds,
      allowAccountDeployment: config.paymasterRpcAllowAccountDeployment,
      allowedOrigins: config.paymasterRpcAllowedOrigins,
      allowMissingOrigin: config.paymasterRpcAllowMissingOrigin,
    },
  });
  server.listen(config.port, () => {
    console.log(`[policy-service] listening on :${config.port}`);
    reconciler?.start(config.reconciler.intervalMs);
  });

  const shutdown = createShutdownHandler({
    server,
    timeoutMs: config.shutdownTimeoutMs,
    onStart: () => reconciler?.stop(),
    onDrained: () => {
      db.close();
      sponsorship?.close();
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main();
