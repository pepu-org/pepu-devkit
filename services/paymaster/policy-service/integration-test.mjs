#!/usr/bin/env node
/**
 * End-to-end integration test: build a real Kernel v3.1 UserOperation on
 * PEPU mainnet, request sponsorship from the policy service, and (if
 * sponsorship is granted) submit the sponsored op to the live Alto bundler.
 *
 * This script NEVER fakes a passing step. Every step either completes for
 * real against a live service, or the script stops and prints exactly which
 * step failed and why -- see "WHERE THIS STOPS TODAY" below for the honest,
 * observed result as of this writing.
 *
 * PRECONDITIONS (checked at runtime, not assumed):
 *   1. Alto bundler running and reachable (services/bundler/, `npm start`
 *      there). Two instances exist on mainnet as of this writing: `:4337`
 *      (started before a `safe-mode` config fix landed, so its IN-MEMORY
 *      config still runs with `safe-mode: true` and cannot complete
 *      `eth_sendUserOperation` -- a confirmed Alto 0.0.21 bug) and `:4338`
 *      (`safe-mode: false`, confirmed landing real UserOps on mainnet).
 *      Point BUNDLER_URL at whichever is actually safe-mode:false, e.g.:
 *        BUNDLER_URL=http://127.0.0.1:4338 node integration-test.mjs
 *   2. policy-service running and reachable (services/paymaster/policy-service/,
 *      `npm start` there; default http://127.0.0.1:8788 -- NOT 8787; this
 *      package's own .env sets PORT=8788).
 *   3. Repo-root .env has CONDUIT_API_KEY (for this script's own read-only
 *      calls to the chain -- getAddress/getNonce/getUserOpHash -- and
 *      nothing else).
 *   4. This package's own .env has PAYMASTER_CONTRACT_ADDRESS pointing at
 *      the deployed PepuVerifyingPaymasterV7 contract, and
 *      config/allowlist.json has the destination this script calls
 *      (TapScore) on the GLOBAL allowlist. Both are read from disk below --
 *      never hardcoded independently of the running service's own config.
 *
 * OPTIONAL, for getting all the way to a landed transaction:
 *   PRIVY_ACCESS_TOKEN   A real Privy access token for a real logged-in
 *                        user whose smart wallet equals the `sender` this
 *                        script builds (see "making this go further" below).
 *                        Without it, this script deliberately stops at the
 *                        policy service's auth check -- exactly what any
 *                        real caller without a logged-in Privy user would
 *                        see, not a shortcut this script is taking.
 *
 * Usage (run from services/paymaster/policy-service/, so it resolves this
 * package's own node_modules -- e.g. viem -- like any of its other scripts):
 *   node integration-test.mjs
 *   BUNDLER_URL=http://127.0.0.1:4338 PRIVY_ACCESS_TOKEN=eyJ... \
 *     node integration-test.mjs
 *
 * WHAT THIS SCRIPT ACTUALLY DOES, STEP BY STEP:
 *
 *   Step 1: Build a fresh, throwaway, counterfactual Kernel v3.1 account
 *     (ZERO native balance -- this is the whole point: the sender must be
 *     able to transact with no PEPU of its own).
 *
 *   Step 2 (two-pass gas estimation, ERC-4337 v0.7 semantics):
 *     Pass A -- call `eth_estimateUserOperationGas` WITH the paymaster
 *     fields already populated (`paymaster`, `paymasterVerificationGasLimit`,
 *     `paymasterPostOpGasLimit`, `paymasterData`) using this package's own
 *     configured gas limits and a syntactically-valid but semantically-fake
 *     ("dummy") paymaster signature, so EntryPoint checks the PAYMASTER's
 *     deposit during simulation instead of the sender's (zero) balance.
 *     This is the actual bug this script had before this fix: it used to
 *     call estimate with NO paymaster attached at all, so an unfunded
 *     sender correctly failed with `AA21 didn't pay prefund` -- that failure
 *     had nothing to do with sponsorship; it never even tried to use it.
 *
 *     The dummy paymaster signature is NOT the account-side
 *     DUMMY_ECDSA_SIG constant reused for a different purpose -- it is a
 *     fresh, independently-verified-correct ECDSA signature built the same
 *     way this script signs the real userOpHash later (`viem/accounts`
 *     `sign()`, which always returns a canonical low-s signature). This
 *     matters because `PepuVerifyingPaymasterV7._validateVerifyingMode`
 *     calls OpenZeppelin v5's *reverting* `ECDSA.recover` (not the
 *     non-reverting `tryRecover`) -- confirmed by reading
 *     contracts/src/PepuVerifyingPaymasterV7.sol directly in this session.
 *     A malformed signature (wrong length, high-s, bad v) makes that call
 *     REVERT, which aborts simulation entirely with no useful error. A
 *     syntactically valid signature that simply doesn't recover to a
 *     registered signer, by contrast, is the documented-safe case: the
 *     contract sets `isSignatureValid = false` and packs that as
 *     `sigFailed=1` into `validationData` via `_packValidationData` --
 *     which does NOT revert (see PepuVerifyingPaymasterV7.sol
 *     `_validateVerifyingMode`) -- so `eth_estimateUserOperationGas` can
 *     still simulate the rest of the operation and return real gas numbers.
 *
 *     Pass B -- POST the resulting gas numbers to the policy service's
 *     `/sponsor` endpoint to get a REAL signature (from the paymaster's
 *     actual registered signer key) over those exact final gas values.
 *
 *   Step 3: Assemble the final `paymasterAndData` from the policy service's
 *     response, compute the real userOpHash via the live EntryPoint's own
 *     `getUserOpHash` (never hand-rolled), sign it with the throwaway
 *     account owner's key, and call `eth_sendUserOperation`.
 *
 *   Step 4: Poll `eth_getUserOperationReceipt` and report the transaction
 *     hash and success/failure.
 *
 * WHERE THIS ACTUALLY STOPPED, OBSERVED BY RUNNING THIS EXACT SCRIPT AGAINST
 * THE LIVE PAYMASTER, POLICY SERVICE, AND BUNDLER ON PEPU MAINNET:
 *
 *   See services/paymaster/README.md "Proven live in this session" (or the
 *   task report this script's fix was written for) for the actual observed
 *   output. In short: without a real PRIVY_ACCESS_TOKEN, this script's own
 *   policy-service call is EXPECTED to stop at
 *   `reason: "invalid_or_expired_token"` -- policy.ts's step 1 runs before
 *   the API-key-resolved app (step 3) is ever consulted, so a valid
 *   `X-Api-Key` alone can never substitute for a real logged-in user's
 *   token. This is not a bug to route around; it is the entire security
 *   model of who this paymaster will pay gas for, and this script does not
 *   attempt to weaken, bypass, or stub it.
 *
 *   Separately (and this is a genuinely independent finding from reading
 *   the deployed contract, not merely from this script's own run): even
 *   past a real Privy token, `PepuVerifyingPaymasterV7._validatePaymasterUserOp`
 *   reverts with `BundlerNotAllowed(tx.origin)` unless either (a) the
 *   paymaster's on-chain `isBundlerAllowed` mapping has the bundler's
 *   executor EOA registered via `updateBundlerAllowlist` on v1 (v2: `proposeAdminChange`/`executeAdminChange`) (an admin/manager-
 *   only on-chain call this script never makes -- that would be changing
 *   deployed-contract state, out of this script's scope), or (b) the
 *   policy service sets the paymasterData mode byte's `allowAllBundlers` bit
 *   (policy-service/src/paymasterData.ts's `MODE_BYTE` is hardcoded to
 *   `0x00`, i.e. that bit is always 0 -- also out of this script's scope to
 *   change). See this script's own live run output for whether that
 *   specific revert was actually observed at the estimation step.
 *
 * MAKING THIS GO FURTHER, IN ORDER:
 *   1. Confirm (via a direct on-chain read of the paymaster's
 *      `isBundlerAllowed(address)` mapping for the bundler's executor EOA)
 *      whether the bundler-allowlist gate above is open or closed, and if
 *      closed, have the contract's admin/manager call
 *      `updateBundlerAllowlist([executorAddress], true)`.
 *   2. Obtain a real Privy access token (via the app's normal login flow)
 *      for a user whose smart wallet matches this script's computed
 *      `sender`, and pass it as PRIVY_ACCESS_TOKEN.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concatHex,
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  numberToHex,
  pad,
  parseAbi,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, sign as signRawHash } from "viem/accounts";
import { entryPoint07Abi, toPackedUserOperation } from "viem/account-abstraction";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_SERVICE_ROOT = __dirname;
const REPO_ROOT = resolve(POLICY_SERVICE_ROOT, "..", "..", "..");

function readEnvValue(path, key) {
  const contents = readFileSync(path, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const match = new RegExp(`^${key}=(.*)$`).exec(line);
    if (match) return match[1];
  }
  return undefined;
}

const CONDUIT_API_KEY = readEnvValue(join(REPO_ROOT, ".env"), "CONDUIT_API_KEY");
if (!CONDUIT_API_KEY) {
  console.error(`FATAL: CONDUIT_API_KEY not found in ${join(REPO_ROOT, ".env")}`);
  process.exit(1);
}
const RPC_URL = `https://rpc-pepu-v2-mainnet-0.t.conduit.xyz/${CONDUIT_API_KEY}`;
const BUNDLER_URL = process.env.BUNDLER_URL || "http://127.0.0.1:4337";
// Fixed: this package's own .env sets PORT=8788, not the 8787 this default
// previously assumed (that was simply wrong -- there is no service on 8787).
const POLICY_SERVICE_URL = process.env.POLICY_SERVICE_URL || "http://127.0.0.1:8788";
const PRIVY_ACCESS_TOKEN = process.env.PRIVY_ACCESS_TOKEN || null;
const API_KEY = process.env.APP_API_KEY || "example-dev-key-CHANGE-ME"; // ships in config/apps.json as a documented example

// --- Read this package's own live config straight off disk, exactly as
// src/config.ts's loadConfig()/loadAllowlistConfig() would, so none of these
// values can silently drift from what the running policy-service process
// itself is actually using. ---
const POLICY_SERVICE_ENV_PATH = join(POLICY_SERVICE_ROOT, ".env");
const PAYMASTER_ADDRESS = getAddress(
  readEnvValue(POLICY_SERVICE_ENV_PATH, "PAYMASTER_CONTRACT_ADDRESS") ??
    (() => {
      throw new Error(`PAYMASTER_CONTRACT_ADDRESS not found in ${POLICY_SERVICE_ENV_PATH}`);
    })(),
);
// src/config.ts loadConfig() defaults -- envBigInt("PAYMASTER_VERIFICATION_GAS_LIMIT", 100_000n) /
// envBigInt("PAYMASTER_POST_OP_GAS_LIMIT", 50_000n). Read the override if present, else use the
// same documented default the server itself would fall back to.
const PAYMASTER_VERIFICATION_GAS_LIMIT = BigInt(
  readEnvValue(POLICY_SERVICE_ENV_PATH, "PAYMASTER_VERIFICATION_GAS_LIMIT") ?? "100000",
);
const PAYMASTER_POST_OP_GAS_LIMIT = BigInt(
  readEnvValue(POLICY_SERVICE_ENV_PATH, "PAYMASTER_POST_OP_GAS_LIMIT") ?? "50000",
);

const allowlistConfig = JSON.parse(
  readFileSync(join(POLICY_SERVICE_ROOT, "config", "allowlist.json"), "utf8"),
);
const TAPSCORE_ADDRESS = getAddress(allowlistConfig.destinations[0]);

// --- Verified PEPU mainnet (97741) addresses/ABIs. Sourced from, and kept
// consistent with, services/bundler/scripts/estimate-kernel-userop.mjs
// (read, not modified, per this session's scope) -- see that script's own
// extensive citations for the independent verification trail against
// packages/sdk/src/{contracts,abi}.ts and github.com/zerodevapp/kernel@v3.1.
const ENTRY_POINT_V07 = getAddress("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
const KERNEL_FACTORY = getAddress("0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419");
const ECDSA_VALIDATOR = getAddress("0x845ADb2C711129d4f3966735eD98a9F09fC4cE57");

const kernelFactoryAbi = parseAbi([
  "function getAddress(bytes calldata data, bytes32 salt) view returns (address)",
  "function createAccount(bytes calldata data, bytes32 salt) payable returns (address)",
]);
const kernelInitializeAbi = parseAbi([
  "function initialize(bytes21 _rootValidator, address hook, bytes validatorData, bytes hookData, bytes[] initConfig)",
]);
const kernelExecuteAbi = parseAbi(["function execute(bytes32 execMode, bytes executionCalldata)"]);
const entryPointNonceAbi = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256 nonce)"]);
const entryPointDepositInfoAbi = parseAbi([
  "function getDepositInfo(address account) view returns (uint256 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)",
]);
// TapScore.tap() -- see templates/game-app/contracts/foundry/src/TapScore.sol.
// Argument-free, non-payable, on the global allowlist (config/allowlist.json)
// specifically to prove sponsorship end-to-end for this template.
const tapScoreAbi = parseAbi(["function tap()"]);

const CALL_TYPE_SINGLE = "0x00";
const EXEC_TYPE_DEFAULT = "0x00";
function getExecModeSingleDefault() {
  return concatHex([CALL_TYPE_SINGLE, EXEC_TYPE_DEFAULT, "0x00000000", "0x00000000", pad("0x00000000", { size: 22 })]);
}

const DUMMY_ECDSA_SIG =
  "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";

// --- Paymaster `paymasterAndData` byte layout, mirrored byte-for-byte from
// policy-service/src/paymasterData.ts (which itself cites
// contracts/src/base/BaseSingletonPaymaster.sol / PepuVerifyingPaymasterV7.sol
// as its source of truth) -- duplicated here only because this script is a
// standalone .mjs and can't cheaply import that package's compiled TS. Any
// change to that module's byte layout must be mirrored here too. ---
const MODE_BYTE = "0x00"; // verifying mode (bits 1-7 = 0) + allowAllBundlers = 0 (bit 0)
function uint48BigEndian(value) {
  return pad(numberToHex(BigInt(value)), { size: 6 });
}
function buildPaymasterDataBytes(validUntil, validAfter, signature65) {
  return concatHex([MODE_BYTE, uint48BigEndian(validUntil), uint48BigEndian(validAfter), signature65]);
}

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

function logStep(n, title) {
  console.log(`\n=== STEP ${n}: ${title} ===`);
}

function stopHere(message) {
  console.log(`\nSTOPPED HERE: ${message}`);
  process.exit(0);
}

async function main() {
  console.log("=== PEPU paymaster integration test: Kernel UserOp -> policy-service -> Alto bundler ===");
  console.log("bundler        :", BUNDLER_URL);
  console.log("policy service :", POLICY_SERVICE_URL);
  console.log("chain RPC      :", RPC_URL.replace(/\/[^/]+$/, "/<redacted>"));
  console.log("paymaster      :", PAYMASTER_ADDRESS);
  console.log("tapscore       :", TAPSCORE_ADDRESS);
  console.log("privy token    :", PRIVY_ACCESS_TOKEN ? "provided" : "NOT provided (expect an auth stop at step 3)");

  const publicClient = createPublicClient({ transport: http(RPC_URL) });

  const depositBefore = await publicClient.readContract({
    address: ENTRY_POINT_V07,
    abi: entryPointDepositInfoAbi,
    functionName: "getDepositInfo",
    args: [PAYMASTER_ADDRESS],
  });
  console.log("paymaster EntryPoint deposit BEFORE:", depositBefore[0].toString(), "wei, staked:", depositBefore[1]);

  // --- Step 1: build a fresh, throwaway, counterfactual Kernel v3.1 account ---
  logStep(1, "build counterfactual Kernel v3.1 account (zero native balance)");
  const ownerPrivateKey = generatePrivateKey();
  const owner = privateKeyToAccount(ownerPrivateKey);
  console.log("throwaway owner (unfunded, disposable):", owner.address);

  const rootValidatorIdentifier = concatHex(["0x01", ECDSA_VALIDATOR]);
  const hook = "0x0000000000000000000000000000000000000000";
  const initializeCalldata = encodeFunctionData({
    abi: kernelInitializeAbi,
    functionName: "initialize",
    args: [rootValidatorIdentifier, hook, owner.address, "0x", []],
  });
  const salt = pad(toHex(0n), { size: 32 });
  const factoryData = encodeFunctionData({
    abi: kernelFactoryAbi,
    functionName: "createAccount",
    args: [initializeCalldata, salt],
  });

  const sender = await publicClient.readContract({
    address: KERNEL_FACTORY,
    abi: kernelFactoryAbi,
    functionName: "getAddress",
    args: [initializeCalldata, salt],
  });
  console.log("counterfactual sender:", sender);

  const senderBalance = await publicClient.getBalance({ address: sender });
  console.log("sender native balance:", senderBalance.toString(), "wei (must be 0 for this to prove anything)");

  const nonce = await publicClient.readContract({
    address: ENTRY_POINT_V07,
    abi: entryPointNonceAbi,
    functionName: "getNonce",
    args: [sender, 0n],
  });
  console.log("EntryPoint nonce (key=0):", nonce.toString());

  // Single call: sender's Kernel account -> TapScore.tap(). This is the
  // exact shape policy-service/src/kernelDecoder.ts expects to decode
  // (CALLTYPE_SINGLE, target+value+callData packed) and is what actually
  // gets checked against the global allowlist server-side.
  const tapCalldata = encodeFunctionData({ abi: tapScoreAbi, functionName: "tap", args: [] });
  const executionCalldata = concatHex([TAPSCORE_ADDRESS, pad(toHex(0n), { size: 32 }), tapCalldata]);
  const callData = encodeFunctionData({
    abi: kernelExecuteAbi,
    functionName: "execute",
    args: [getExecModeSingleDefault(), executionCalldata],
  });

  // --- Step 2, pass A: eth_estimateUserOperationGas WITH paymaster fields
  // populated (dummy signature) so EntryPoint checks the PAYMASTER's
  // deposit, not the (zero) sender balance. See this file's header comment
  // for exactly why the dummy signature must be a well-formed-but-wrong
  // ECDSA signature rather than the account-side DUMMY_ECDSA_SIG constant.
  logStep("2a", "eth_estimateUserOperationGas WITH paymaster fields (dummy paymaster signature)");
  const dummyPaymasterSignerKey = generatePrivateKey();
  const dummyPaymasterSigRaw = await signRawHash({
    hash: `0x${"00".repeat(32)}`,
    privateKey: dummyPaymasterSignerKey,
  });
  const dummyPaymasterSignature = concatHex([
    dummyPaymasterSigRaw.r,
    dummyPaymasterSigRaw.s,
    toHex(dummyPaymasterSigRaw.v, { size: 1 }),
  ]);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const dummyValidAfter = nowSeconds - 60;
  const dummyValidUntil = nowSeconds + 300;
  const dummyPaymasterData = buildPaymasterDataBytes(dummyValidUntil, dummyValidAfter, dummyPaymasterSignature);

  const userOpForEstimate = {
    sender,
    nonce: toHex(nonce),
    factory: KERNEL_FACTORY,
    factoryData,
    callData,
    signature: DUMMY_ECDSA_SIG,
    paymaster: PAYMASTER_ADDRESS,
    paymasterVerificationGasLimit: toHex(PAYMASTER_VERIFICATION_GAS_LIMIT),
    paymasterPostOpGasLimit: toHex(PAYMASTER_POST_OP_GAS_LIMIT),
    paymasterData: dummyPaymasterData,
  };
  console.log("eth_estimateUserOperationGas request:", JSON.stringify(userOpForEstimate, null, 2));
  const estimate = await rpcCall(BUNDLER_URL, "eth_estimateUserOperationGas", [userOpForEstimate, ENTRY_POINT_V07]);
  if (estimate.error) {
    console.log(JSON.stringify(estimate, null, 2));
    stopHere(`eth_estimateUserOperationGas failed: ${estimate.error.message ?? JSON.stringify(estimate.error)}`);
  }
  console.log("estimate:", JSON.stringify(estimate.result));

  const gasPrice = await publicClient.getGasPrice();
  const maxPriorityFeePerGas = gasPrice;
  const maxFeePerGas = gasPrice * 2n;

  // --- Step 2, pass B: request sponsorship (a REAL signature over the
  // final estimated gas values) from the policy service ---
  logStep("2b", "POST /sponsor to the policy service for a real paymaster signature");
  const sponsorRequestBody = {
    userOp: {
      sender,
      nonce: toHex(nonce),
      factory: KERNEL_FACTORY,
      factoryData,
      callData,
      callGasLimit: estimate.result.callGasLimit,
      verificationGasLimit: estimate.result.verificationGasLimit,
      preVerificationGas: estimate.result.preVerificationGas,
      maxFeePerGas: toHex(maxFeePerGas),
      maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
    },
  };
  console.log("request body:", JSON.stringify(sponsorRequestBody, null, 2));

  let sponsorResponse;
  try {
    const res = await fetch(`${POLICY_SERVICE_URL}/sponsor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(PRIVY_ACCESS_TOKEN ? { Authorization: `Bearer ${PRIVY_ACCESS_TOKEN}` } : {}),
        "X-Api-Key": API_KEY,
      },
      body: JSON.stringify(sponsorRequestBody),
    });
    sponsorResponse = await res.json();
    console.log(`policy-service responded HTTP ${res.status}:`, JSON.stringify(sponsorResponse, null, 2));
  } catch (error) {
    stopHere(
      `could not reach the policy service at ${POLICY_SERVICE_URL} (${error.message}). ` +
        "Is it running? (cd policy-service && npm start)",
    );
    return;
  }

  if (sponsorResponse.status !== "approved") {
    stopHere(
      `policy service denied sponsorship: reason="${sponsorResponse.reason}", message="${sponsorResponse.message}". ` +
        (PRIVY_ACCESS_TOKEN
          ? "See this script's header comment for what else must be true to get further."
          : "This is expected without a real PRIVY_ACCESS_TOKEN -- see this script's header comment. " +
            "Note this is NOT bypassable with just X-Api-Key: policy.ts checks the Privy token (step 1) " +
            "before it ever looks at the API key (step 3)."),
    );
    return;
  }

  // --- Step 3: submit the sponsored, signed op to the bundler ---
  logStep(3, "submit the sponsored UserOp to the bundler");
  const packedForHash = toPackedUserOperation({
    sender,
    nonce,
    factory: KERNEL_FACTORY,
    factoryData,
    callData,
    callGasLimit: BigInt(estimate.result.callGasLimit),
    verificationGasLimit: BigInt(estimate.result.verificationGasLimit),
    preVerificationGas: BigInt(estimate.result.preVerificationGas),
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: sponsorResponse.paymaster,
    paymasterVerificationGasLimit: BigInt(sponsorResponse.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: BigInt(sponsorResponse.paymasterPostOpGasLimit),
    paymasterData: sponsorResponse.paymasterData,
    signature: "0x",
  });
  const realUserOpHash = await publicClient.readContract({
    address: ENTRY_POINT_V07,
    abi: entryPoint07Abi,
    functionName: "getUserOpHash",
    args: [packedForHash],
  });
  console.log("real userOpHash (from live EntryPoint.getUserOpHash):", realUserOpHash);
  console.log("policy-service's own userOpHash (pre-paymaster-sig commit):", sponsorResponse.userOpHash);

  const realSignature = await signRawHash({ hash: realUserOpHash, privateKey: ownerPrivateKey });
  const packedSignature = concatHex([realSignature.r, realSignature.s, toHex(realSignature.v, { size: 1 })]);

  const userOpForSend = {
    ...userOpForEstimate,
    callGasLimit: estimate.result.callGasLimit,
    verificationGasLimit: estimate.result.verificationGasLimit,
    preVerificationGas: estimate.result.preVerificationGas,
    maxFeePerGas: toHex(maxFeePerGas),
    maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
    paymaster: sponsorResponse.paymaster,
    paymasterVerificationGasLimit: sponsorResponse.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: sponsorResponse.paymasterPostOpGasLimit,
    paymasterData: sponsorResponse.paymasterData,
    signature: packedSignature,
  };
  console.log("eth_sendUserOperation request:", JSON.stringify(userOpForSend, null, 2));

  const sendResult = await rpcCall(BUNDLER_URL, "eth_sendUserOperation", [userOpForSend, ENTRY_POINT_V07]);
  console.log("eth_sendUserOperation response:", JSON.stringify(sendResult, null, 2));

  if (sendResult.error) {
    stopHere(`eth_sendUserOperation failed: ${sendResult.error.message ?? JSON.stringify(sendResult.error)}`);
    return;
  }

  const sentUserOpHash = sendResult.result;
  console.log("\nACCEPTED by the bundler. UserOpHash:", sentUserOpHash);
  console.log("Polling eth_getUserOperationReceipt every 3s (up to 2 minutes)...");
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const receipt = await rpcCall(BUNDLER_URL, "eth_getUserOperationReceipt", [sentUserOpHash]);
    if (receipt.result) {
      console.log("receipt:", JSON.stringify(receipt.result, null, 2));
      console.log(
        receipt.result.success
          ? "\nRESULT: full end-to-end flow SUCCEEDED on-chain."
          : "\nRESULT: included but reverted (success=false) -- see receipt above.",
      );
      const depositAfter = await publicClient.readContract({
        address: ENTRY_POINT_V07,
        abi: entryPointDepositInfoAbi,
        functionName: "getDepositInfo",
        args: [PAYMASTER_ADDRESS],
      });
      console.log("paymaster EntryPoint deposit AFTER: ", depositAfter[0].toString(), "wei, staked:", depositAfter[1]);
      console.log(
        "deposit delta:",
        (depositBefore[0] - depositAfter[0]).toString(),
        "wei (positive = paymaster actually paid the gas)",
      );
      const senderBalanceAfter = await publicClient.getBalance({ address: sender });
      console.log("sender native balance AFTER:", senderBalanceAfter.toString(), "wei (should still be 0)");
      return;
    }
    process.stdout.write(".");
  }
  console.log("\nno receipt after 2 minutes -- op may still be pending. Check manually with the hash above.");
}

main().catch((error) => {
  console.error("\nFATAL (unexpected -- not one of this script's documented stopping points):", error);
  process.exitCode = 1;
});
