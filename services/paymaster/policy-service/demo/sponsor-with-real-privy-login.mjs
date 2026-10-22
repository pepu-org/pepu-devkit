#!/usr/bin/env node
/**
 * The gas-sponsorship demo: a real mainnet transaction, from a Kernel smart
 * account holding ZERO PEPU, paid for by the paymaster -- with a REAL Privy
 * login (not a stubbed/faked token) driving the policy service's auth gate.
 *
 * This script is `integration-test.mjs` (one directory up) plus exactly one
 * new thing: a real, live Privy login, obtained headlessly via Privy's own
 * "Sign in with Ethereum" (SIWE) REST endpoints instead of a browser. See
 * "WHY SIWE, NOT EMAIL/BROWSER LOGIN" below for why this is the right choice
 * for this app's actual configuration, verified live, not assumed.
 *
 * PRECONDITIONS: identical to integration-test.mjs (Alto on :4337 with
 * safe-mode:false, policy-service on :8788, this package's own .env with
 * PRIVY_APP_ID/PRIVY_APP_SECRET, PAYMASTER_CONTRACT_ADDRESS, etc.). Run from
 * this `demo/` directory is fine -- it resolves `..`'s node_modules via
 * Node's normal upward node_modules search, exactly like any other script
 * nested under a package that has no node_modules of its own.
 *
 * WHY SIWE, NOT EMAIL/BROWSER LOGIN
 * ----------------------------------
 * The task this script was built for requires a REAL, non-bypassed Privy
 * access token -- "never stub or disable the token check." Three ways to
 * get one were considered, and tested LIVE against this exact Privy app
 * (appId read from this package's own .env) before picking one:
 *
 *   1. Privy's "test accounts" feature (`client.apps.getTestCredentials`,
 *      pre-canned email+OTP pairs meant for exactly this kind of headless
 *      testing). LIVE RESULT: this app has none configured -- the endpoint
 *      returns no test accounts. Dead end, not a code problem.
 *   2. Real email OTP login (`/api/v1/passwordless/init` +
 *      `/api/v1/passwordless/authenticate`, confirmed real endpoints -- see
 *      below). This IS enabled for this app (`email_auth: true`, confirmed
 *      via a live `client.apps.get()` call), but requires reading a real
 *      inbox for the OTP code, which this script has no access to.
 *   3. SIWE login (`/api/v1/siwe/init` + `/api/v1/siwe/authenticate`). Also
 *      confirmed enabled for this app (`wallet_auth: true`, same live
 *      `apps.get()` call) and, unlike (2), needs no external service at
 *      all: this script generates a disposable EOA, proves ownership of it
 *      by signing a standard EIP-4191 SIWE message, and Privy issues a real
 *      session for a real (newly created) Privy user who has genuinely
 *      proven control of that key. This is the exact same mechanism a real
 *      user connecting MetaMask to a Privy app would go through -- nothing
 *      here is faked, stubbed, or specific to this script.
 *
 * The SIWE request/response shapes and endpoint paths below are not
 * invented: they were read directly out of the ACTUAL COMPILED SOURCE of
 * `@privy-io/js-sdk-core` (the library `@privy-io/react-auth` itself calls,
 * confirmed installed at the repo root and used by every PEPU template) and
 * `@privy-io/routes` (that package's own route-table dependency, also
 * installed at the repo root). Specifically:
 *   - Route table (`@privy-io/routes` dist): `SiweInit` ->
 *     `POST /api/v1/siwe/init`, `SiweAuthenticate` ->
 *     `POST /api/v1/siwe/authenticate`, base host `https://auth.privy.io`
 *     (read directly out of `@privy-io/js-sdk-core`'s compiled bundle).
 *   - Auth header for these pre-session calls: `privy-app-id: <appId>`
 *     (confirmed from `js-sdk-core`'s `requestWithoutAuth` helper).
 *   - The exact SIWE message template Privy's own client constructs before
 *     signing (function `Rr` in the compiled bundle):
 *       `${domain} wants you to sign in with your Ethereum account:
 *       ${address}
 *
 *       ${statement}
 *
 *       URI: ${uri}
 *       Version: 1
 *       Chain ID: ${chainId}
 *       Nonce: ${nonce}
 *       Issued At: ${issuedAt}
 *       Resources:
 *       - https://privy.io`
 *     with `statement` = "By signing, you are proving you own this wallet
 *     and logging in. This does not initiate a transaction or cost any
 *     fees." (the exact string `js-sdk-core` uses) and `chainId` in the
 *     MESSAGE BODY being the bare decimal chain id (the CAIP-2 `eip155:`
 *     prefix is stripped for the message text, but kept for the JSON
 *     `chainId` field sent to `/siwe/authenticate` -- both behaviors
 *     confirmed by reading `js-sdk-core`'s `init`/`authenticate` methods
 *     directly, not guessed).
 *
 * This is genuinely a new Privy USER for every run (SIWE with
 * `mode: "login-or-sign-up"` against a fresh disposable key always creates
 * one) -- this script deletes that throwaway user again at the end via the
 * server SDK (`privy.users().delete`), the same cleanup
 * `_experiment-privy-probe.mjs` used during this session's earlier,
 * already-deleted investigation of whether Privy's own Smart Wallets
 * feature could be used instead (see this package's README "Live-verified
 * findings" for why that path is closed for this app today).
 *
 * WHAT THIS SCRIPT DOES NOT DO: it does not touch templates/consumer-app,
 * does not run on port 3000, and does not modify anything under `src/` --
 * the policy service's auth/ownership logic runs completely unmodified.
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
import { PrivyClient } from "@privy-io/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_SERVICE_ROOT = resolve(__dirname, "..");
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
const POLICY_SERVICE_URL = process.env.POLICY_SERVICE_URL || "http://127.0.0.1:8788";
const API_KEY = process.env.APP_API_KEY || "example-dev-key-CHANGE-ME";

const POLICY_SERVICE_ENV_PATH = join(POLICY_SERVICE_ROOT, ".env");
const PRIVY_APP_ID = readEnvValue(POLICY_SERVICE_ENV_PATH, "PRIVY_APP_ID");
const PRIVY_APP_SECRET = readEnvValue(POLICY_SERVICE_ENV_PATH, "PRIVY_APP_SECRET");
if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  console.error(`FATAL: PRIVY_APP_ID/PRIVY_APP_SECRET not found in ${POLICY_SERVICE_ENV_PATH}`);
  process.exit(1);
}
const PAYMASTER_ADDRESS = getAddress(
  readEnvValue(POLICY_SERVICE_ENV_PATH, "PAYMASTER_CONTRACT_ADDRESS") ??
    (() => {
      throw new Error(`PAYMASTER_CONTRACT_ADDRESS not found in ${POLICY_SERVICE_ENV_PATH}`);
    })(),
);
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

const CHAIN_ID = 97741;
const ENTRY_POINT_V07 = getAddress("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
const KERNEL_FACTORY = getAddress("0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419");
const ECDSA_VALIDATOR = getAddress("0x845ADb2C711129d4f3966735eD98a9F09fC4cE57");
const AUTH_BASE_URL = "https://auth.privy.io";

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
const tapScoreAbi = parseAbi(["function tap()"]);

const CALL_TYPE_SINGLE = "0x00";
const EXEC_TYPE_DEFAULT = "0x00";
function getExecModeSingleDefault() {
  return concatHex(["0x00", "0x00", "0x00000000", "0x00000000", pad("0x00000000", { size: 22 })]);
}

const DUMMY_ECDSA_SIG =
  "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";

const MODE_BYTE = "0x00";
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

/**
 * Live, headless Privy login via SIWE. See file header comment for exactly
 * where every field/endpoint/header in here was verified from.
 */
async function loginWithSiwe(ownerAccount) {
  // Must be one of this Privy app's configured `allowed_domains` (confirmed
  // live via `client.apps.get()`: ["http://localhost","http://localhost:3000"]).
  // "http://localhost" (no port) is used deliberately here -- this script
  // never binds to or calls any local port itself, this is purely the
  // Origin header value Privy's CORS-style allowlist check requires; picking
  // the bare-domain entry avoids any confusion with the port-3000 dev server
  // this task was explicitly told not to touch.
  const domain = "localhost";
  const uri = "http://localhost";

  const initRes = await fetch(`${AUTH_BASE_URL}/api/v1/siwe/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "privy-app-id": PRIVY_APP_ID, Origin: uri },
    body: JSON.stringify({ address: ownerAccount.address }),
  });
  const initBody = await initRes.json();
  if (!initRes.ok || !initBody.nonce) {
    throw new Error(`/siwe/init failed: HTTP ${initRes.status} ${JSON.stringify(initBody)}`);
  }

  const issuedAt = new Date().toISOString();
  const statement =
    "By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.";
  const message =
    `${domain} wants you to sign in with your Ethereum account:\n${ownerAccount.address}\n\n` +
    `${statement}\n\nURI: ${uri}\nVersion: 1\nChain ID: ${CHAIN_ID}\nNonce: ${initBody.nonce}\n` +
    `Issued At: ${issuedAt}\nResources:\n- https://privy.io`;

  const signature = await ownerAccount.signMessage({ message });

  const authRes = await fetch(`${AUTH_BASE_URL}/api/v1/siwe/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "privy-app-id": PRIVY_APP_ID, Origin: uri },
    body: JSON.stringify({
      message,
      signature,
      chainId: `eip155:${CHAIN_ID}`,
      walletClientType: "unknown",
      connectorType: "injected",
      mode: "login-or-sign-up",
    }),
  });
  const authBody = await authRes.json();
  if (!authRes.ok) {
    throw new Error(`/siwe/authenticate failed: HTTP ${authRes.status} ${JSON.stringify(authBody)}`);
  }
  return authBody; // AuthenticatedUser: { token, privy_access_token, refresh_token, user, is_new_user, ... }
}

async function computeKernelAddress(publicClient, ownerAddress) {
  const rootValidatorIdentifier = concatHex(["0x01", ECDSA_VALIDATOR]);
  const hook = "0x0000000000000000000000000000000000000000";
  const initializeCalldata = encodeFunctionData({
    abi: kernelInitializeAbi,
    functionName: "initialize",
    args: [rootValidatorIdentifier, hook, ownerAddress, "0x", []],
  });
  const salt = pad(toHex(0n), { size: 32 });
  const sender = await publicClient.readContract({
    address: KERNEL_FACTORY,
    abi: kernelFactoryAbi,
    functionName: "getAddress",
    args: [initializeCalldata, salt],
  });
  const factoryData = encodeFunctionData({
    abi: kernelFactoryAbi,
    functionName: "createAccount",
    args: [initializeCalldata, salt],
  });
  return { sender, factoryData };
}

async function main() {
  console.log("=== PEPU gas-sponsorship demo: Kernel UserOp + REAL Privy SIWE login -> policy-service -> Alto ===");
  console.log("bundler        :", BUNDLER_URL);
  console.log("policy service :", POLICY_SERVICE_URL);
  console.log("paymaster      :", PAYMASTER_ADDRESS);
  console.log("tapscore       :", TAPSCORE_ADDRESS);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const privy = new PrivyClient({ appId: PRIVY_APP_ID, appSecret: PRIVY_APP_SECRET });

  const depositBefore = await publicClient.readContract({
    address: ENTRY_POINT_V07,
    abi: entryPointDepositInfoAbi,
    functionName: "getDepositInfo",
    args: [PAYMASTER_ADDRESS],
  });
  console.log("\npaymaster EntryPoint deposit BEFORE:", depositBefore[0].toString(), "wei =", Number(depositBefore[0]) / 1e18, "PEPU, staked:", depositBefore[1]);

  // --- Step 1: real Privy login (owner EOA is also the login wallet) ---
  logStep(1, "log in to Privy for real via SIWE (headless, no browser, no stubbed token)");
  const ownerPrivateKey = generatePrivateKey();
  const owner = privateKeyToAccount(ownerPrivateKey);
  console.log("disposable login/owner EOA:", owner.address, "(zero balance, used only to sign the SIWE message and, later, the UserOp)");

  const authResult = await loginWithSiwe(owner);
  const accessToken = authResult.token ?? authResult.privy_access_token;
  console.log("Privy login succeeded. user.id:", authResult.user.id, "is_new_user:", authResult.is_new_user);
  console.log("access token field used:", authResult.token ? "token" : "privy_access_token", "(present:", Boolean(accessToken) + ")");

  // Sanity-check the token actually verifies against this same app's own
  // Privy client (the exact same check policy-service's privyAuth.ts does)
  // before spending an RPC round-trip on the rest of this script.
  try {
    const claims = await privy.utils().auth().verifyAccessToken(accessToken);
    console.log("independent verifyAccessToken() check: OK, user_id =", claims.user_id);
  } catch (error) {
    console.log("independent verifyAccessToken() check FAILED:", error?.message ?? error);
  }

  // --- Step 2: build the counterfactual Kernel v3.1 account for this SAME owner ---
  logStep(2, "compute the counterfactual Kernel v3.1 smart account for this owner (zero balance)");
  const { sender, factoryData } = await computeKernelAddress(publicClient, owner.address);
  console.log("counterfactual sender:", sender);
  const senderBalance = await publicClient.getBalance({ address: sender });
  console.log("sender native balance:", senderBalance.toString(), "wei (must be 0)");

  const nonce = await publicClient.readContract({
    address: ENTRY_POINT_V07,
    abi: entryPointNonceAbi,
    functionName: "getNonce",
    args: [sender, 0n],
  });

  const tapCalldata = encodeFunctionData({ abi: tapScoreAbi, functionName: "tap", args: [] });
  const executionCalldata = concatHex([TAPSCORE_ADDRESS, pad(toHex(0n), { size: 32 }), tapCalldata]);
  const callData = encodeFunctionData({
    abi: kernelExecuteAbi,
    functionName: "execute",
    args: [getExecModeSingleDefault(), executionCalldata],
  });

  // --- Step 3a: eth_estimateUserOperationGas WITH paymaster fields (dummy sig) ---
  logStep("3a", "eth_estimateUserOperationGas WITH paymaster fields (dummy paymaster signature)");
  const dummyPaymasterSignerKey = generatePrivateKey();
  const dummyPaymasterSigRaw = await signRawHash({ hash: `0x${"00".repeat(32)}`, privateKey: dummyPaymasterSignerKey });
  const dummyPaymasterSignature = concatHex([dummyPaymasterSigRaw.r, dummyPaymasterSigRaw.s, toHex(dummyPaymasterSigRaw.v, { size: 1 })]);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const dummyPaymasterData = buildPaymasterDataBytes(nowSeconds + 300, nowSeconds - 60, dummyPaymasterSignature);

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
  const estimate = await rpcCall(BUNDLER_URL, "eth_estimateUserOperationGas", [userOpForEstimate, ENTRY_POINT_V07]);
  if (estimate.error) {
    stopHere(`eth_estimateUserOperationGas failed: ${estimate.error.message ?? JSON.stringify(estimate.error)}`);
  }
  console.log("estimate:", JSON.stringify(estimate.result));

  const gasPrice = await publicClient.getGasPrice();
  const maxPriorityFeePerGas = gasPrice;
  const maxFeePerGas = gasPrice * 2n;

  // --- Step 3b: POST /sponsor with the REAL Privy access token ---
  logStep("3b", "POST /sponsor to the policy service WITH the real Privy access token");
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

  const sponsorRes = await fetch(`${POLICY_SERVICE_URL}/sponsor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify(sponsorRequestBody),
  });
  const sponsorResponse = await sponsorRes.json();
  console.log(`policy-service responded HTTP ${sponsorRes.status}:`, JSON.stringify(sponsorResponse, null, 2));

  // --- cleanup: this was a real, freshly-created Privy user; remove it ---
  try {
    await privy.users().delete(authResult.user.id);
    console.log("\n(cleanup) deleted the throwaway Privy user created by this run.");
  } catch (error) {
    console.log("\n(cleanup) could not delete throwaway Privy user (not fatal):", error?.message ?? error);
  }

  if (sponsorResponse.status !== "approved") {
    stopHere(
      `policy service denied sponsorship with a REAL, verified Privy access token.\n` +
        `  reason:  ${sponsorResponse.reason}\n` +
        `  message: ${sponsorResponse.message}\n` +
        `See this package's README "Live-verified findings" for the root cause and what would unblock it.`,
    );
    return;
  }

  // --- Step 4: submit the sponsored, signed op to the bundler ---
  logStep(4, "submit the sponsored UserOp to the bundler");
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

  const sendResult = await rpcCall(BUNDLER_URL, "eth_sendUserOperation", [userOpForSend, ENTRY_POINT_V07]);
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
      console.log(receipt.result.success ? "\nRESULT: SUCCEEDED on-chain." : "\nRESULT: included but reverted.");
      const depositAfter = await publicClient.readContract({
        address: ENTRY_POINT_V07,
        abi: entryPointDepositInfoAbi,
        functionName: "getDepositInfo",
        args: [PAYMASTER_ADDRESS],
      });
      console.log("paymaster EntryPoint deposit AFTER: ", depositAfter[0].toString(), "wei");
      console.log("deposit delta:", (depositBefore[0] - depositAfter[0]).toString(), "wei (positive = paymaster paid)");
      const senderBalanceAfter = await publicClient.getBalance({ address: sender });
      console.log("sender native balance AFTER:", senderBalanceAfter.toString(), "wei (should still be 0)");
      console.log("transaction hash:", receipt.result.receipt.transactionHash);
      return;
    }
    process.stdout.write(".");
  }
  console.log("\nno receipt after 2 minutes -- op may still be pending. Check manually with the hash above.");
}

main().catch((error) => {
  console.error("\nFATAL (unexpected):", error);
  process.exitCode = 1;
});
