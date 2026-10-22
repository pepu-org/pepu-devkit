#!/usr/bin/env node
/**
 * Sends a plain native-token (PEPU) transfer from a funder key to a target
 * address. Used during manual bundler verification to give a counterfactual
 * ERC-4337 smart account (or any other test address) a real balance --
 * without a paymaster, a smart account must hold its own PEPU to pay
 * EntryPoint's prefund (see Kernel.sol's `validateUserOp`, which forwards
 * `missingAccountFunds` out of the account's own balance).
 *
 * This script never hardcodes, prints, or logs a private key. It reads the
 * signer's key from the FUNDER_PRIVATE_KEY environment variable only, and
 * only ever logs public information (addresses, balances, tx hashes).
 *
 * Usage:
 *   FUNDER_PRIVATE_KEY=0x... node scripts/fund-address.mjs <targetAddress> [amountInPepu]
 *
 * amountInPepu defaults to "1". Chain RPC URL is read from this service's
 * own .env (ALTO_RPC_URL) so it never has to be typed/pasted separately.
 */
import { createWalletClient, createPublicClient, http, parseEther, defineChain, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = join(__dirname, "..");

const target = process.argv[2];
const amountPepu = process.argv[3] || "1";

if (!target || !isAddress(target)) {
    console.error("Usage: FUNDER_PRIVATE_KEY=0x... node scripts/fund-address.mjs <targetAddress> [amountInPepu]");
    process.exit(1);
}

const pk = process.env.FUNDER_PRIVATE_KEY;
if (!pk) {
    console.error("FUNDER_PRIVATE_KEY environment variable is not set. Refusing to guess a key.");
    process.exit(1);
}
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const envText = readFileSync(join(SERVICE_ROOT, ".env"), "utf8");
const rpcUrlMatch = envText.match(/^ALTO_RPC_URL=(.+)$/m);
if (!rpcUrlMatch) throw new Error("ALTO_RPC_URL not found in .env");
const rpcUrl = rpcUrlMatch[1].trim();

// Minimal inline chain definition (mirrors packages/sdk/src/chains.ts
// pepuMainnet) -- kept local so this script has no dependency on the
// monorepo's other packages.
const pepuMainnet = defineChain({
    id: 97741,
    name: "Pepe Unchained V2",
    nativeCurrency: { name: "Pepe Unchained", symbol: "PEPU", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
});

const publicClient = createPublicClient({ chain: pepuMainnet, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: pepuMainnet, transport: http(rpcUrl) });

async function main() {
    console.log("Funder address:", account.address);
    console.log("Target address:", target);

    const funderBalance = await publicClient.getBalance({ address: account.address });
    console.log("Funder balance before:", (Number(funderBalance) / 1e18).toFixed(6), "PEPU");

    const targetBalanceBefore = await publicClient.getBalance({ address: target });
    console.log("Target balance before:", (Number(targetBalanceBefore) / 1e18).toFixed(6), "PEPU");

    const hash = await walletClient.sendTransaction({
        to: target,
        value: parseEther(amountPepu),
    });
    console.log("Funding tx sent:", hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("Funding tx status:", receipt.status, "block:", receipt.blockNumber.toString());

    const targetBalanceAfter = await publicClient.getBalance({ address: target });
    console.log("Target balance after:", (Number(targetBalanceAfter) / 1e18).toFixed(6), "PEPU");
}

main().catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
});
