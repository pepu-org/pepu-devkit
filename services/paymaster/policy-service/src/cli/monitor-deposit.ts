/**
 * Deposit monitor + top-up CLI for the deployed PepuVerifyingPaymasterV7's
 * EntryPoint balance. Pure decision arithmetic lives in `../depositMonitor.ts`
 * (unit-tested in `test/depositMonitor.test.ts`); this file is only the
 * chain-facing wiring: reading the live deposit, and -- for `top-up
 * --broadcast` only -- sending a funding transaction.
 *
 * WHY THIS EXISTS (see README.md "Deposit management" + "Threat model"):
 * PepuVerifyingPaymasterV7 has NO on-chain spending cap. The EntryPoint
 * deposit is the entire amount a compromised signer key (or a policy-service
 * bug) could drain. The operational mitigation is to keep that deposit
 * deliberately small and top it up incrementally rather than funding it
 * once with a large amount -- this script is that incremental top-up, plus
 * a read-only watch mode for alerting when the balance is getting low.
 *
 * SAFETY MODEL (mirrors contracts/deploy-paymaster.sh):
 *   - `status` and `watch` are READ-ONLY. No private key is touched, loaded,
 *     or even required to run them.
 *   - `top-up` PLANS by default (prints the current deposit, thresholds, and
 *     the computed top-up amount) and sends nothing. Only `top-up --broadcast`
 *     sends a real transaction.
 *
 * Usage (from services/paymaster/policy-service/, Node 22.5+):
 *   node --experimental-strip-types src/cli/monitor-deposit.ts status
 *   node --experimental-strip-types src/cli/monitor-deposit.ts watch [--interval-sec 60]
 *   node --experimental-strip-types src/cli/monitor-deposit.ts top-up [--broadcast]
 *
 * Config (env vars; all optional except where noted):
 *   PAYMASTER_CONTRACT_ADDRESS   Overrides reading ../../contracts/deployed-address.txt.
 *   DEPOSIT_LOW_WATER_MARK_WEI   Default 0.02 PEPU-equivalent wei. Below this = "low".
 *   DEPOSIT_TOP_UP_TARGET_WEI    Default 0.05 PEPU-equivalent wei. top-up's goal balance.
 *   DEPOSIT_MAX_CEILING_WEI      Default 0.10 PEPU-equivalent wei. Hard cap, never exceeded.
 *   FUNDING_PRIVATE_KEY          Required only for `top-up --broadcast`. Defaults to
 *                                DEPLOYER_PRIVATE_KEY from ../../../deploy/.keys.env if unset --
 *                                there is no dedicated funding key provisioned yet (see
 *                                README.md "Known gaps").
 *
 * This script NEVER logs a private key. Only public addresses, balances, and tx hashes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { computeTopUpWei } from "../depositMonitor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..", "..");
const PAYMASTER_ROOT = resolve(PACKAGE_ROOT, "..");
const REPO_ROOT = resolve(PAYMASTER_ROOT, "..", "..");

// Canonical ERC-4337 EntryPoint v0.7 address -- same constant as
// config.ts's ENTRY_POINT_V07_ADDRESS, duplicated deliberately so this
// script can run standalone even when config.ts's stricter env validation
// (e.g. requiring PAYMASTER_SIGNER_PRIVATE_KEY) would otherwise fail.
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

// Minimal ABI fragments, verified directly against the vendored sources
// (not guessed): balanceOf is IStakeManager.balanceOf (
// contracts/lib/account-abstraction-v7/contracts/interfaces/IStakeManager.sol
// line 74); deposit() is BasePaymaster.deposit() (contracts/src/base/BasePaymaster.sol).
const entryPointAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const paymasterAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

function readEnvValue(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const contents = readFileSync(path, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match && match[1] === key) return match[2];
  }
  return undefined;
}

function loadRpcUrl(): string {
  const conduitKey = readEnvValue(join(REPO_ROOT, ".env"), "CONDUIT_API_KEY");
  if (!conduitKey) {
    throw new Error(`CONDUIT_API_KEY not found in ${join(REPO_ROOT, ".env")}`);
  }
  return `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${conduitKey}`;
}

function loadPaymasterAddress(): Address {
  const fromEnv = process.env.PAYMASTER_CONTRACT_ADDRESS;
  if (fromEnv) return fromEnv as Address;
  const addrFile = join(PAYMASTER_ROOT, "contracts", "deployed-address.txt");
  if (existsSync(addrFile)) {
    return readFileSync(addrFile, "utf8").trim() as Address;
  }
  throw new Error(
    `No PAYMASTER_CONTRACT_ADDRESS env var set and no deployment recorded at ${addrFile}. ` +
      "Has contracts/deploy-paymaster.sh --broadcast been run yet?",
  );
}

function envWeiOrDefault(name: string, defaultEther: string): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return parseEther(defaultEther);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`${name}="${raw}" is not a valid integer wei amount.`);
  }
}

function loadFundingPrivateKey(): `0x${string}` {
  const explicit = process.env.FUNDING_PRIVATE_KEY?.trim();
  if (explicit) return explicit as `0x${string}`;
  // Fall back to the deployer key -- there is no dedicated funding key
  // provisioned in deploy/.keys.env yet (see README.md "Known gaps"). This
  // fallback is intentional and documented, not a guess: the deployer key
  // already pays gas for every other deploy script in this repo, and reusing
  // it here avoids inventing a new secret this session was never given.
  const deployerKey = readEnvValue(join(REPO_ROOT, "deploy", ".keys.env"), "DEPLOYER_PRIVATE_KEY");
  if (!deployerKey) {
    throw new Error(
      "No FUNDING_PRIVATE_KEY env var set, and DEPLOYER_PRIVATE_KEY not found in deploy/.keys.env either.",
    );
  }
  return deployerKey as `0x${string}`;
}

const publicClient = createPublicClient({ transport: http(loadRpcUrl()) });

async function readDepositWei(paymasterAddress: Address): Promise<bigint> {
  return publicClient.readContract({
    address: ENTRY_POINT_V07,
    abi: entryPointAbi,
    functionName: "balanceOf",
    args: [paymasterAddress],
  });
}

function thresholds() {
  return {
    lowWaterMarkWei: envWeiOrDefault("DEPOSIT_LOW_WATER_MARK_WEI", "0.02"),
    targetWei: envWeiOrDefault("DEPOSIT_TOP_UP_TARGET_WEI", "0.05"),
    maxCeilingWei: envWeiOrDefault("DEPOSIT_MAX_CEILING_WEI", "0.10"),
  };
}

async function printStatus(paymasterAddress: Address): Promise<{ isLow: boolean }> {
  const { lowWaterMarkWei, targetWei, maxCeilingWei } = thresholds();
  const depositWei = await readDepositWei(paymasterAddress);
  const decision = computeTopUpWei({ currentDepositWei: depositWei, lowWaterMarkWei, targetWei, maxCeilingWei });
  const ts = new Date().toISOString();
  console.log(
    `[${ts}] paymaster=${paymasterAddress} deposit=${formatEther(depositWei)} PEPU ` +
      `(lowWaterMark=${formatEther(lowWaterMarkWei)} target=${formatEther(targetWei)} ceiling=${formatEther(maxCeilingWei)})`,
  );
  if (decision.isLow) {
    console.log(`[${ts}] ALERT: deposit is BELOW the low-water mark. ${decision.reason}`);
  }
  return { isLow: decision.isLow };
}

async function cmdStatus(): Promise<void> {
  const paymasterAddress = loadPaymasterAddress();
  const { isLow } = await printStatus(paymasterAddress);
  process.exitCode = isLow ? 1 : 0;
}

async function cmdWatch(intervalSec: number): Promise<void> {
  const paymasterAddress = loadPaymasterAddress();
  console.log(`Watching ${paymasterAddress}'s EntryPoint deposit every ${intervalSec}s. Read-only -- Ctrl+C to stop.`);
  // Deliberately read-only: watch mode never sends a top-up transaction
  // itself, even when low, so an unattended long-running process never
  // holds (or needs) a funding key. Use `top-up --broadcast` as a separate,
  // deliberate action -- see this file's module doc comment.
  for (;;) {
    try {
      await printStatus(paymasterAddress);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] status check failed:`, (error as Error).message);
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

async function cmdTopUp(broadcast: boolean): Promise<void> {
  const paymasterAddress = loadPaymasterAddress();
  const { lowWaterMarkWei, targetWei, maxCeilingWei } = thresholds();
  const depositWei = await readDepositWei(paymasterAddress);
  const decision = computeTopUpWei({ currentDepositWei: depositWei, lowWaterMarkWei, targetWei, maxCeilingWei });

  console.log("==================================================================");
  console.log(" PLAN -- top up PepuVerifyingPaymasterV7's EntryPoint deposit");
  console.log("==================================================================");
  console.log(`mode                : ${broadcast ? "BROADCAST (real transaction)" : "DRY RUN (no transaction will be sent)"}`);
  console.log(`paymaster           : ${paymasterAddress}`);
  console.log(`current deposit     : ${formatEther(depositWei)} PEPU`);
  console.log(`low-water mark      : ${formatEther(lowWaterMarkWei)} PEPU`);
  console.log(`target              : ${formatEther(targetWei)} PEPU`);
  console.log(`hard ceiling        : ${formatEther(maxCeilingWei)} PEPU`);
  console.log(`decision            : ${decision.reason}`);
  console.log(`computed top-up     : ${formatEther(decision.topUpWei)} PEPU`);

  if (decision.topUpWei === 0n) {
    console.log("\nNothing to do -- exiting without sending a transaction.");
    return;
  }

  if (!broadcast) {
    console.log("\nDRY RUN complete. Re-run with --broadcast to send this top-up for real.");
    return;
  }

  const fundingAccount = privateKeyToAccount(loadFundingPrivateKey());
  const fundingBalanceWei = await publicClient.getBalance({ address: fundingAccount.address });
  console.log(`\nfunding account     : ${fundingAccount.address}`);
  console.log(`funding balance     : ${formatEther(fundingBalanceWei)} PEPU`);
  if (fundingBalanceWei < decision.topUpWei) {
    throw new Error(
      `funding account balance (${formatEther(fundingBalanceWei)} PEPU) is less than the computed top-up ` +
        `(${formatEther(decision.topUpWei)} PEPU). Refusing to send a transaction that would fail.`,
    );
  }

  const walletClient = createWalletClient({ account: fundingAccount, transport: http(loadRpcUrl()) });
  console.log("\n--- sending top-up ---");
  const txHash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "deposit",
    value: decision.topUpWei,
    chain: undefined,
  });
  console.log(`tx hash             : ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`status              : ${receipt.status}`);

  const newDepositWei = await readDepositWei(paymasterAddress);
  console.log(`new deposit         : ${formatEther(newDepositWei)} PEPU`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const broadcast = rest.includes("--broadcast");
  const intervalFlagIndex = rest.indexOf("--interval-sec");
  const intervalSec =
    intervalFlagIndex >= 0 && rest[intervalFlagIndex + 1] ? Number(rest[intervalFlagIndex + 1]) : 60;

  switch (command) {
    case "status":
      await cmdStatus();
      return;
    case "watch":
      await cmdWatch(Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 60);
      return;
    case "top-up":
      await cmdTopUp(broadcast);
      return;
    default:
      console.error(
        "Usage: monitor-deposit.ts <status|watch [--interval-sec N]|top-up [--broadcast]>",
      );
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FATAL:", (error as Error).message);
  process.exitCode = 1;
});
