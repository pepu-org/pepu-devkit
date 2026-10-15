#!/usr/bin/env node
/**
 * Operational healthcheck for the PEPU Alto bundler. Checks four
 * independent things and reports each one separately, because "the bundler
 * is down" and "the chain RPC is down" and "the executor wallet is broke"
 * are different incidents with different fixes -- collapsing them into one
 * boolean would make the on-call response guesswork.
 *
 *   1. Bundler responding    -- eth_chainId against the bundler's own port
 *                               (from alto.config.json), and the returned
 *                               chain id matches PEPU mainnet (97741).
 *   2. Chain RPC reachable   -- eth_blockNumber against ALTO_RPC_URL
 *                               directly (bypassing the bundler entirely),
 *                               so a "bundler down" alert can be told apart
 *                               from a "Conduit RPC down" alert.
 *   3. EntryPoint reachable  -- eth_supportedEntryPoints against the
 *                               bundler, cross-checked against the two
 *                               addresses this service is supposed to be
 *                               configured for (EntryPoint v0.6 and v0.7).
 *   4. Executor EOA funded   -- every key in ALTO_EXECUTOR_PRIVATE_KEYS is
 *                               resolved to its public address (never
 *                               printed: the key itself) and that address's
 *                               on-chain PEPU balance is read directly from
 *                               the chain and compared against a minimum
 *                               threshold.
 *
 * This script NEVER reads a private key for any purpose other than
 * deriving its (public) address -- the key material itself is never
 * logged, returned, or written anywhere.
 *
 * Usage:
 *   node scripts/healthcheck.js
 *   npm run healthcheck
 *
 * Exit code 0 = all checks passed. Exit code 1 = at least one check
 * failed (see the FAIL lines printed to stderr for which one and why).
 *
 * Environment overrides (all optional):
 *   ALTO_HEALTHCHECK_MIN_EXECUTOR_BALANCE_PEPU
 *     Minimum acceptable PEPU balance per executor EOA before this reports
 *     a failure. Default: 500. Chosen because every UserOperation observed
 *     during this service's live verification run (see README.md "Proof of
 *     life") cost between ~3 and ~8 PEPU in real gas -- 500 PEPU is dozens
 *     of operations of headroom, not a number this bundler is expected to
 *     approach quickly, which is the point: this should fire an alert with
 *     enough runway to top up before anything actually fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = join(__dirname, "..");

const PEPU_CHAIN_ID_HEX = "0x17dcd"; // 97741, confirmed live (see README.md)
const EXPECTED_ENTRYPOINTS = [
    "0x0000000071727de22e5e9d8baf0edac6f37da032", // v0.7
    "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789", // v0.6
];
const DEFAULT_MIN_EXECUTOR_BALANCE_PEPU = 500;

function loadEnvVar(name) {
    const envPath = join(SERVICE_ROOT, ".env");
    let contents;
    try {
        contents = readFileSync(envPath, "utf8");
    } catch {
        return undefined;
    }
    const re = new RegExp(`^${name}=(.*)$`, "m");
    const match = contents.match(re);
    return match ? match[1].trim() : undefined;
}

function loadBundlerPort() {
    const configPath = join(SERVICE_ROOT, "alto.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return config.port;
}

async function rpcCall(url, method, params, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: controller.signal,
        });
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const results = [];
function record(name, ok, detail) {
    results.push({ name, ok, detail });
    const tag = ok ? "PASS" : "FAIL";
    console.log(`[${tag}] ${name}${detail ? " -- " + detail : ""}`);
}

async function main() {
    const bundlerPort = loadBundlerPort();
    const bundlerUrl = `http://localhost:${bundlerPort}`;
    const rpcUrl = loadEnvVar("ALTO_RPC_URL");
    const executorKeysRaw = loadEnvVar("ALTO_EXECUTOR_PRIVATE_KEYS");
    const minBalancePepu = Number(
        process.env.ALTO_HEALTHCHECK_MIN_EXECUTOR_BALANCE_PEPU ?? DEFAULT_MIN_EXECUTOR_BALANCE_PEPU,
    );

    console.log("=== PEPU Alto bundler healthcheck ===");
    console.log("Bundler URL:", bundlerUrl);
    console.log("Minimum executor balance threshold:", minBalancePepu, "PEPU");
    console.log("");

    // --- Check 1: bundler responding + correct chain ---
    try {
        const chainIdResult = await rpcCall(bundlerUrl, "eth_chainId", []);
        if (chainIdResult.error) {
            record("bundler responding", false, `RPC error: ${JSON.stringify(chainIdResult.error)}`);
        } else if (chainIdResult.result !== PEPU_CHAIN_ID_HEX) {
            record(
                "bundler responding",
                false,
                `wrong chain: got ${chainIdResult.result}, expected ${PEPU_CHAIN_ID_HEX} (PEPU mainnet, 97741)`,
            );
        } else {
            record("bundler responding", true, `eth_chainId = ${chainIdResult.result} (PEPU mainnet)`);
        }
    } catch (err) {
        record("bundler responding", false, `could not reach ${bundlerUrl}: ${err.message}`);
    }

    // --- Check 2: chain RPC reachable (independent of the bundler) ---
    if (!rpcUrl) {
        record("chain RPC reachable", false, "ALTO_RPC_URL not set in .env -- copy .env.example and fill it in");
    } else {
        try {
            const publicClient = createPublicClient({ transport: http(rpcUrl) });
            const blockNumber = await publicClient.getBlockNumber();
            record("chain RPC reachable", true, `latest block = ${blockNumber}`);
        } catch (err) {
            record("chain RPC reachable", false, `eth_blockNumber failed: ${err.message}`);
        }
    }

    // --- Check 3: EntryPoint(s) reachable through the bundler ---
    try {
        const entryPointsResult = await rpcCall(bundlerUrl, "eth_supportedEntryPoints", []);
        if (entryPointsResult.error) {
            record("EntryPoint reachable", false, `RPC error: ${JSON.stringify(entryPointsResult.error)}`);
        } else {
            const returned = (entryPointsResult.result || []).map((a) => a.toLowerCase());
            const missing = EXPECTED_ENTRYPOINTS.filter((e) => !returned.includes(e));
            if (missing.length > 0) {
                record(
                    "EntryPoint reachable",
                    false,
                    `missing expected EntryPoint(s): ${missing.join(", ")} (got: ${returned.join(", ")})`,
                );
            } else {
                record("EntryPoint reachable", true, `supported: ${returned.join(", ")}`);
            }
        }
    } catch (err) {
        record("EntryPoint reachable", false, `could not reach ${bundlerUrl}: ${err.message}`);
    }

    // --- Check 4: executor EOA(s) funded above threshold ---
    // Never logs the key itself -- only the address it derives to and that
    // address's public, on-chain balance.
    if (!executorKeysRaw) {
        record("executor EOA funded", false, "ALTO_EXECUTOR_PRIVATE_KEYS not set in .env");
    } else if (!rpcUrl) {
        record("executor EOA funded", false, "cannot check balance without a working ALTO_RPC_URL (see above)");
    } else {
        try {
            const publicClient = createPublicClient({ transport: http(rpcUrl) });
            const keys = executorKeysRaw.split(",").map((k) => k.trim()).filter(Boolean);
            if (keys.length === 0) {
                record("executor EOA funded", false, "ALTO_EXECUTOR_PRIVATE_KEYS is set but empty");
            } else {
                let allOk = true;
                const details = [];
                for (const key of keys) {
                    if (!isHex(key)) {
                        allOk = false;
                        details.push("(one key is not valid hex -- skipped, see stderr)");
                        console.error("[FAIL] executor EOA funded -- one ALTO_EXECUTOR_PRIVATE_KEYS entry is not valid hex (not printing it)");
                        continue;
                    }
                    const account = privateKeyToAccount(key);
                    const balance = await publicClient.getBalance({ address: account.address });
                    const balancePepu = Number(balance) / 1e18;
                    const ok = balancePepu >= minBalancePepu;
                    allOk = allOk && ok;
                    details.push(`${account.address} = ${balancePepu.toFixed(4)} PEPU${ok ? "" : " (BELOW THRESHOLD)"}`);
                }
                record("executor EOA funded", allOk, details.join("; "));
            }
        } catch (err) {
            record("executor EOA funded", false, `balance check failed: ${err.message}`);
        }
    }

    console.log("");
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.log(`RESULT: UNHEALTHY -- ${failed.length}/${results.length} check(s) failed.`);
        process.exitCode = 1;
    } else {
        console.log(`RESULT: HEALTHY -- ${results.length}/${results.length} checks passed.`);
    }
}

main().catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
});
