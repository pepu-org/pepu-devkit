#!/usr/bin/env node
/**
 * Manual proof-of-life script: builds a counterfactual ZeroDev Kernel v3.1
 * smart account for a freshly generated, unfunded, throwaway owner key, and
 * calls `eth_estimateUserOperationGas` (and optionally `eth_sendUserOperation`)
 * against the locally running Alto bundler for EntryPoint v0.7 on PEPU
 * mainnet (chain 97741).
 *
 * WHY THIS EXISTS: `eth_supportedEntryPoints`/`eth_chainId` only prove Alto
 * is alive and talking to the right chain. They do not prove Alto can
 * actually simulate a real ERC-4337 UserOperation against this Nitro chain's
 * dual-fee gas model (L2 execution gas + L1 data fee) using the live
 * `debug_traceCall`/`eth_simulateV1` safe-mode path. This script is the
 * thing that proves (or disproves) that.
 *
 * Every address/ABI fragment used here is sourced from one of:
 *   1. `../../../packages/sdk/src/{contracts,abi/*}.ts` in this monorepo,
 *      which documents how each address/selector was verified live against
 *      PEPU mainnet on 2026-09-24.
 *   2. The actual ZeroDev `kernel` contracts source at tag `v3.1`
 *      (github.com/zerodevapp/kernel), fetched and read directly -- see the
 *      inline citations below. Kernel v3.1 is confirmed to be the version
 *      deployed on PEPU mainnet because
 *      `packages/sdk/src/abi/kernelFactory.ts` records that this factory's
 *      `implementation()` returns the address ZeroDev ships as the Kernel
 *      v3.1 singleton across every chain (KERNEL_V3_1_IMPLEMENTATION_ADDRESS).
 *   3. `@zerodev/sdk@5.5.10`'s published, compiled output (fetched from
 *      unpkg), used only to cross-check the exact `initialize(...)` ABI
 *      shape and the `execute(execMode, executionCalldata)` calldata layout
 *      -- nothing here is guessed.
 *
 * This account is NEVER deployed ahead of time -- it is deployed atomically
 * by the UserOperation itself via `factory`/`factoryData` (ERC-4337
 * counterfactual deployment), which is also why `eth_estimateUserOperationGas`
 * having to simulate a real deployment + validate + execute in one shot is a
 * meaningful test of Alto's simulation contracts.
 *
 * Usage:
 *   node scripts/estimate-kernel-userop.mjs            # estimate only
 *   node scripts/estimate-kernel-userop.mjs --send     # estimate, then send
 *
 * Requires:
 *   - The bundler running locally (`npm start`) on the port in alto.config.json.
 *   - `.env` populated (this script reads ALTO_RPC_URL for its own read-only
 *     `eth_call`s to the chain -- it never touches ALTO_EXECUTOR_PRIVATE_KEYS
 *     or ALTO_UTILITY_PRIVATE_KEY; those are Alto's secrets, not this
 *     script's).
 *   - `--send` additionally requires the bundler's executor EOA to be funded
 *     (it pays gas; the throwaway owner key never needs a balance because it
 *     only signs, it never sends a transaction itself).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
    createPublicClient,
    http,
    parseAbi,
    encodeFunctionData,
    concatHex,
    pad,
    toHex,
    getAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, sign as signRawHash } from "viem/accounts";
import { entryPoint07Abi, toPackedUserOperation } from "viem/account-abstraction";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = join(__dirname, "..");

// --- Load ALTO_RPC_URL from .env without ever letting the secret-bearing
// value pass through a shell command that could echo it. This process's own
// stdout below only ever prints the bundler URL (never a secret). ---
function loadRpcUrlFromEnv() {
    const envPath = join(SERVICE_ROOT, ".env");
    const contents = readFileSync(envPath, "utf8");
    for (const line of contents.split("\n")) {
        const match = line.match(/^ALTO_RPC_URL=(.+)$/);
        if (match) return match[1].trim();
    }
    throw new Error("ALTO_RPC_URL not found in .env -- copy .env.example and fill it in first.");
}

// Alto's own listening port, read from alto.config.json so this script
// never hardcodes a port that could drift from the real config.
function loadBundlerPort() {
    const configPath = join(SERVICE_ROOT, "alto.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return config.port;
}

const RPC_URL = loadRpcUrlFromEnv();
const BUNDLER_URL = `http://localhost:${loadBundlerPort()}`;

// --- Verified PEPU mainnet (97741) contract addresses. Source: this repo's
// packages/sdk/src/contracts.ts pepuContracts[97741] registry. ---
const ENTRY_POINT_V07 = getAddress("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
const KERNEL_FACTORY = getAddress("0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419");
const ECDSA_VALIDATOR = getAddress("0x845ADb2C711129d4f3966735eD98a9F09fC4cE57");

// --- ABIs. kernelFactoryAbi mirrors packages/sdk/src/abi/kernelFactory.ts
// exactly (createAccount/getAddress(bytes,bytes32)), independently confirmed
// against github.com/zerodevapp/kernel@v3.1 src/factory/KernelFactory.sol. ---
const kernelFactoryAbi = parseAbi([
    "function getAddress(bytes calldata data, bytes32 salt) view returns (address)",
    "function createAccount(bytes calldata data, bytes32 salt) payable returns (address)",
]);

// Kernel.initialize ABI, read directly from
// github.com/zerodevapp/kernel/blob/v3.1/src/Kernel.sol#L96-L102 and
// cross-checked against @zerodev/sdk@5.5.10's compiled
// kernel_v_3_1/KernelAccountAbi.js (`_rootValidator` is a `ValidationId`
// user-defined value type, which ABI-encodes as `bytes21`).
const kernelInitializeAbi = parseAbi([
    "function initialize(bytes21 _rootValidator, address hook, bytes validatorData, bytes hookData, bytes[] initConfig)",
]);

// Kernel's ERC-7579 `execute` entrypoint, read from
// github.com/zerodevapp/kernel@v3.1 KernelAccountAbi (`execute(ExecMode,bytes)`
// where ExecMode ABI-encodes as bytes32).
const kernelExecuteAbi = parseAbi([
    "function execute(bytes32 execMode, bytes executionCalldata)",
]);

// Standard ERC-4337 NonceManager getter, shared by EntryPoint v0.6 and v0.7.
const entryPointAbi = parseAbi([
    "function getNonce(address sender, uint192 key) view returns (uint256 nonce)",
]);

// ERC-7579 ExecMode: 1 byte CallType + 1 byte ExecType + 4 bytes unused +
// 4 bytes mode selector + 22 bytes payload, packed as bytes32.
// CALL_TYPE.SINGLE = 0x00, EXEC_TYPE.DEFAULT = 0x00 (@zerodev/sdk constants.js).
const CALL_TYPE_SINGLE = "0x00";
const EXEC_TYPE_DEFAULT = "0x00";
function getExecModeSingleDefault() {
    return concatHex([
        CALL_TYPE_SINGLE,
        EXEC_TYPE_DEFAULT,
        "0x00000000",
        "0x00000000",
        pad("0x00000000", { size: 22 }),
    ]);
}

// The exact dummy ECDSA signature @zerodev/sdk@5.5.10 ships
// (src/constants.js `DUMMY_ECDSA_SIG`) for gas-estimation placeholder
// signatures: a syntactically valid 65-byte secp256k1 signature that will
// not revert ECDSA.recover, but does not need to (and does not) recover to
// the real owner. ERC-4337 bundlers are expected to tolerate a signature
// that fails validation (AA24) without reverting -- only a *malformed*
// signature (wrong length) would break simulation.
const DUMMY_ECDSA_SIG =
    "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";

async function rpcCall(url, method, params) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await res.json();
    return json;
}

async function main() {
    const shouldSend = process.argv.includes("--send");

    console.log("=== PEPU Alto bundler: Kernel v3.1 counterfactual UserOp test ===");
    console.log("RPC (chain):", RPC_URL.replace(/\/[^/]+$/, "/<redacted>"));
    console.log("Bundler:", BUNDLER_URL);

    const publicClient = createPublicClient({ transport: http(RPC_URL) });

    // 1. Throwaway owner key. Generated once and cached in a gitignored local
    // file (.throwaway-owner-key.json) so repeated runs of this script (e.g.
    // "estimate, then fund the resulting sender, then estimate/send again")
    // keep deriving the SAME counterfactual account address instead of a new
    // one every time. This key is disposable: it only ever signs
    // UserOperations for a test account, is never funded directly (the smart
    // account it controls is what gets funded), and is never printed --
    // only its ADDRESS (public) is logged. Delete the cache file to rotate.
    const ownerKeyCachePath = join(SERVICE_ROOT, ".throwaway-owner-key.json");
    let ownerPrivateKey;
    if (existsSync(ownerKeyCachePath)) {
        ownerPrivateKey = JSON.parse(readFileSync(ownerKeyCachePath, "utf8")).privateKey;
    } else {
        ownerPrivateKey = generatePrivateKey();
        writeFileSync(ownerKeyCachePath, JSON.stringify({ privateKey: ownerPrivateKey }, null, 2));
    }
    const owner = privateKeyToAccount(ownerPrivateKey);
    console.log("\nThrowaway owner address (unfunded, disposable):", owner.address);

    // 2. Build the Kernel v3.1 `initialize(...)` calldata.
    //    rootValidator = ValidatorLib.validatorToIdentifier(ECDSA_VALIDATOR)
    //    = bytes21(0x01 ++ validatorAddress) -- see
    //    github.com/zerodevapp/kernel@v3.1 src/utils/ValidationTypeLib.sol
    //    `validatorToIdentifier`.
    const rootValidatorIdentifier = concatHex(["0x01", ECDSA_VALIDATOR]);
    // hook = zeroAddress: Kernel's _installValidation converts address(0) to
    // address(1) ("no hook required") internally -- see
    // src/core/ValidationManager.sol L230-232 -- and this is exactly what
    // @zerodev/sdk's getKernelInitData does when no hook is configured.
    const hook = "0x0000000000000000000000000000000000000000";
    // validatorData for ECDSAValidator.onInstall is just the raw 20-byte
    // owner address -- see src/validator/ECDSAValidator.sol `onInstall`.
    const validatorData = owner.address;
    const hookData = "0x";
    const initConfig = [];

    const initializeCalldata = encodeFunctionData({
        abi: kernelInitializeAbi,
        functionName: "initialize",
        args: [rootValidatorIdentifier, hook, validatorData, hookData, initConfig],
    });

    const salt = pad(toHex(0n), { size: 32 });

    const factoryData = encodeFunctionData({
        abi: kernelFactoryAbi,
        functionName: "createAccount",
        args: [initializeCalldata, salt],
    });

    // 3. Compute the counterfactual sender address by calling the live
    // factory's getAddress(data, salt) -- a real eth_call against PEPU
    // mainnet, not an offline CREATE2 computation, so this can't drift from
    // what the factory will actually deploy.
    const sender = await publicClient.readContract({
        address: KERNEL_FACTORY,
        abi: kernelFactoryAbi,
        functionName: "getAddress",
        args: [initializeCalldata, salt],
    });
    console.log("Counterfactual Kernel account (sender):", sender);

    // Reusability note: the first real run of this script against PEPU
    // mainnet (2026-09-24) actually deployed this exact counterfactual
    // account on-chain (tx 0x8232872612eb500033faf8ef605f7c14f4fef556defdbb4d7c67c1731d0b00d3,
    // see README.md "Proof of life"). Every subsequent run against the same
    // cached throwaway owner key/salt hits an ALREADY-deployed account, so
    // this script must not unconditionally attach factory/factoryData
    // (EntryPoint would reject a redeploy attempt with AA10 sender already
    // constructed) -- it checks the account's on-chain code first and only
    // includes factory/factoryData when there genuinely is none yet, which
    // is what makes it safe to run again and again (e.g. after the
    // paymaster lands) rather than a single-use script.
    const senderCode = await publicClient.getCode({ address: sender });
    const isDeployed = Boolean(senderCode && senderCode !== "0x");
    console.log("Sender has code already?", isDeployed ? "yes (already deployed on a prior run)" : "no (counterfactual, as expected)");

    // 4. Nonce from EntryPoint's NonceManager (key = 0). 0n for a
    // never-deployed, never-used account; increments by 1 for every
    // UserOperation this account has ever had included, so re-running this
    // script against an already-deployed account picks up the real next
    // nonce automatically instead of assuming 0.
    const nonce = await publicClient.readContract({
        address: ENTRY_POINT_V07,
        abi: entryPointAbi,
        functionName: "getNonce",
        args: [sender, 0n],
    });
    console.log("EntryPoint nonce (key=0):", nonce.toString());

    // 5. Trivial operation: the account calls itself with 0 value and empty
    // calldata (hits Kernel's own `receive()`). Deliberately the smallest
    // possible non-degenerate `execute` call.
    const executionCalldata = concatHex([sender, pad(toHex(0n), { size: 32 }), "0x"]);
    const callData = encodeFunctionData({
        abi: kernelExecuteAbi,
        functionName: "execute",
        args: [getExecModeSingleDefault(), executionCalldata],
    });

    const userOpForEstimate = {
        sender,
        nonce: toHex(nonce),
        ...(isDeployed ? {} : { factory: KERNEL_FACTORY, factoryData }),
        callData,
        signature: DUMMY_ECDSA_SIG,
    };

    console.log("\n--- eth_estimateUserOperationGas request ---");
    console.log(JSON.stringify(userOpForEstimate, null, 2));

    const estimateResult = await rpcCall(BUNDLER_URL, "eth_estimateUserOperationGas", [
        userOpForEstimate,
        ENTRY_POINT_V07,
    ]);

    console.log("\n--- eth_estimateUserOperationGas RAW RESPONSE ---");
    console.log(JSON.stringify(estimateResult, null, 2));

    if (estimateResult.error) {
        console.log("\nRESULT: eth_estimateUserOperationGas FAILED. See error above.");
        process.exitCode = 1;
        return;
    }

    console.log("\nRESULT: eth_estimateUserOperationGas SUCCEEDED.");

    if (!shouldSend) {
        console.log("(pass --send to also attempt eth_sendUserOperation)");
        return;
    }

    // 6. Attempt a real send using the estimated gas limits plus a real
    // current gas price from the chain (Alto ignores the caller-supplied
    // fees during *estimation* but requires plausible ones to actually
    // include the op in a bundle).
    const gasPrice = await publicClient.getGasPrice();
    const maxPriorityFeePerGas = gasPrice; // simple, generous, non-scientific
    const maxFeePerGas = gasPrice * 2n;

    // Unlike estimation (where a syntactically-valid-but-wrong dummy
    // signature is the documented, correct thing to send -- see
    // DUMMY_ECDSA_SIG above), a real eth_sendUserOperation needs a signature
    // that actually recovers to the owner, or EntryPoint will reject it with
    // AA24 the moment real (non-estimation) validation runs. Compute the
    // exact userOpHash the live EntryPoint v0.7 contract will itself derive
    // (via its own getUserOpHash, so this can't drift from the real
    // packing/hashing rules) and sign that raw digest with the throwaway
    // owner key -- matching ECDSAValidator.validateUserOp's
    // `ECDSA.recover(userOpHash, sig)` check exactly (see
    // src/validator/ECDSAValidator.sol read earlier).
    const unsignedForHash = {
        ...userOpForEstimate,
        callGasLimit: BigInt(estimateResult.result.callGasLimit),
        verificationGasLimit: BigInt(estimateResult.result.verificationGasLimit),
        preVerificationGas: BigInt(estimateResult.result.preVerificationGas),
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce: BigInt(userOpForEstimate.nonce),
    };
    const packedForHash = toPackedUserOperation(unsignedForHash);
    const userOpHash = await publicClient.readContract({
        address: ENTRY_POINT_V07,
        abi: entryPoint07Abi,
        functionName: "getUserOpHash",
        args: [packedForHash],
    });
    console.log("\nReal userOpHash (from live EntryPoint.getUserOpHash):", userOpHash);

    const realSignature = await signRawHash({ hash: userOpHash, privateKey: ownerPrivateKey });
    const packedSignature = concatHex([realSignature.r, realSignature.s, toHex(realSignature.v, { size: 1 })]);

    const userOpForSend = {
        ...userOpForEstimate,
        callGasLimit: estimateResult.result.callGasLimit,
        verificationGasLimit: estimateResult.result.verificationGasLimit,
        preVerificationGas: estimateResult.result.preVerificationGas,
        maxFeePerGas: toHex(maxFeePerGas),
        maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
        signature: packedSignature,
    };

    console.log("\n--- eth_sendUserOperation request ---");
    console.log(JSON.stringify(userOpForSend, null, 2));

    const sendResult = await rpcCall(BUNDLER_URL, "eth_sendUserOperation", [
        userOpForSend,
        ENTRY_POINT_V07,
    ]);

    console.log("\n--- eth_sendUserOperation RAW RESPONSE ---");
    console.log(JSON.stringify(sendResult, null, 2));

    if (sendResult.error) {
        console.log("\nRESULT: eth_sendUserOperation FAILED. See error above.");
        process.exitCode = 1;
        return;
    }

    // NOTE: intentionally a distinct binding from `userOpHash` above (the
    // value this script computed locally via EntryPoint.getUserOpHash
    // before signing). Alto's returned hash SHOULD be identical -- it is
    // the account/EntryPoint that defines this hash, not the bundler -- so
    // the two are compared below as a cheap sanity check rather than
    // silently trusting either one.
    const returnedUserOpHash = sendResult.result;
    console.log("\nRESULT: eth_sendUserOperation ACCEPTED. UserOpHash:", returnedUserOpHash);
    if (returnedUserOpHash.toLowerCase() !== userOpHash.toLowerCase()) {
        console.log(
            "WARNING: bundler-returned userOpHash does not match the hash this script computed locally.",
            "\n  locally computed:", userOpHash,
            "\n  bundler returned:", returnedUserOpHash,
        );
    }
    console.log("Polling eth_getUserOperationReceipt every 3s (up to 2 minutes)...");

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const receipt = await rpcCall(BUNDLER_URL, "eth_getUserOperationReceipt", [returnedUserOpHash]);
        if (receipt.result) {
            console.log("\n--- eth_getUserOperationReceipt RAW RESPONSE ---");
            console.log(JSON.stringify(receipt, null, 2));
            console.log(
                "\nRESULT: UserOperation",
                receipt.result.success ? "SUCCEEDED on-chain." : "was included but reverted (success=false).",
            );
            return;
        }
        process.stdout.write(".");
    }
    console.log("\nRESULT: no receipt after 2 minutes -- op may still be pending. Check manually with the hash above.");
}

main().catch((err) => {
    console.error("\nFATAL:", err);
    process.exitCode = 1;
});
