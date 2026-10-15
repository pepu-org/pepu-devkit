/**
 * pepu_explain_tx
 *
 * WHAT: Explains one transaction in plain terms, from the RPC alone (no
 * pepuscan needed): was it a plain EOA transaction or an ERC-4337 bundle, who
 * sent it, who paid the gas, did it succeed, what did it cost in PEPU, and
 * where to look at it on pepuscan. For a bundle it decodes each
 * UserOperationEvent (sender, paymaster, success, actual gas cost) with the
 * SDK's `userOpEventFromReceipt`.
 *
 * Accepts a transaction hash. A UserOperation hash also works when a bundler
 * is configured (PEPU_BUNDLER_URL): it is resolved through
 * `eth_getUserOperationReceipt` to its bundle transaction first.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { explorerLinks, formatPepu, getContract, isDeployed, pepuMainnet, resolvePepuEndpoints } from "@pepu-chain/sdk";
import { userOpEventFromReceipt } from "@pepu-chain/sdk/aa";
import { isHash, toEventSelector, type Address, type Hash, type Hex } from "viem";
import { REMOTE_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { getPublicClient } from "../rpc.js";
import { hostOf } from "../sdk-helpers.js";

const inputSchema = {
  hash: z.string().describe("A transaction hash (0x + 64 hex), or a UserOperation hash if a bundler URL is configured."),
};

// TODO(sdk): the SDK only decodes the UserOperationEvent for a known sender (userOpEventFromReceipt).
// This topic is used only to find candidate senders in a bundle; the decode itself is the SDK's.
const USER_OP_EVENT_TOPIC = toEventSelector(
  "UserOperationEvent(bytes32,address,address,address,uint256,bool,uint256,uint256)"
);

async function userOpToTxHash(bundlerUrl: string, userOpHash: string): Promise<Hash | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getUserOperationReceipt", params: [userOpHash] }),
      signal: ctl.signal,
    });
    const body = (await res.json()) as { result?: { receipt?: { transactionHash?: string } } | null };
    const h = body.result?.receipt?.transactionHash;
    return h && isHash(h) ? h : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isNotFound(e: unknown): boolean {
  return e instanceof Error && (e.name === "TransactionNotFoundError" || /could not be found/i.test(e.message));
}

export function registerExplainTxTool(server: McpServer): void {
  server.registerTool(
    "pepu_explain_tx",
    {
      title: "Explain a PEPU transaction",
      description:
        "Explain a transaction or ERC-4337 bundle from the RPC alone: EOA transaction vs UserOperation bundle, sender, who paid gas (the EOA, a paymaster, or the smart account's own EntryPoint deposit), success or revert, fee in PEPU (formatPepu from @pepu-chain/sdk), and pepuscan links (explorerLinks). Decodes each UserOperationEvent in a bundle with userOpEventFromReceipt from @pepu-chain/sdk/aa. A UserOperation hash also works when PEPU_BUNDLER_URL is set. Use pepu_get_transaction for pepuscan's decoded input and Arbitrum L1 batch status.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ hash }) => {
      if (!isHash(hash)) {
        actionableError(`"${hash}" is not a transaction or UserOperation hash.`, "It must be 0x followed by 64 hex characters.", "Copy the full hash from your wallet or pepuscan.");
      }
      const client = getPublicClient("mainnet");
      let txHash: Hash = hash;
      let resolvedFromUserOp = false;

      let tx;
      try {
        tx = await client.getTransaction({ hash: txHash });
      } catch (e) {
        if (!isNotFound(e)) throw e;
        let bundlerUrl: string | null = null;
        try {
          bundlerUrl = resolvePepuEndpoints().bundlerUrl;
        } catch {
          bundlerUrl = null;
        }
        const resolved = bundlerUrl ? await userOpToTxHash(bundlerUrl, hash) : null;
        if (!resolved) {
          return jsonResult({
            found: false,
            hash,
            message: bundlerUrl
              ? `No transaction with this hash on PEPU mainnet, and the bundler at ${hostOf(bundlerUrl)} has no UserOperation receipt for it. It may be pending, dropped, or from another chain.`
              : "No transaction with this hash on PEPU mainnet. If it is a UserOperation hash, set PEPU_BUNDLER_URL so it can be resolved; otherwise it may be pending, dropped, or from another chain.",
          });
        }
        txHash = resolved;
        resolvedFromUserOp = true;
        tx = await client.getTransaction({ hash: txHash });
      }

      const receipt = await client.getTransactionReceipt({ hash: txHash }).catch((e: unknown) => {
        if (isNotFound(e) || (e instanceof Error && /receipt/i.test(e.message))) return null;
        throw e;
      });

      const entryPoints = new Set(
        (["entryPoint06", "entryPoint07"] as const)
          .map((k) => getContract(pepuMainnet.id, k))
          .filter(isDeployed)
          .map((c) => c.address.toLowerCase())
      );
      const toEntryPoint = tx.to !== null && tx.to !== undefined && entryPoints.has(tx.to.toLowerCase());

      type OpSummary = { userOpHash: Hex; sender: Address; paymaster: Address | null; success: boolean; actualGasCostWei: string; actualGasCostPepu: string; paidBy: string };
      const userOps: OpSummary[] = [];
      if (receipt) {
        const senders = new Set<Address>();
        for (const log of receipt.logs) {
          if (log.topics[0] === USER_OP_EVENT_TOPIC && entryPoints.has(log.address.toLowerCase()) && log.topics[2]) {
            senders.add(`0x${log.topics[2].slice(26)}` as Address);
          }
        }
        for (const sender of senders) {
          const ev = userOpEventFromReceipt(receipt, sender);
          if (!ev) continue;
          userOps.push({
            userOpHash: ev.userOpHash,
            sender,
            paymaster: ev.paymaster,
            success: ev.success,
            actualGasCostWei: ev.actualGasCost.toString(),
            actualGasCostPepu: formatPepu(ev.actualGasCost),
            paidBy: ev.paymaster ? `paymaster ${ev.paymaster} (sponsored)` : `the smart account ${sender} from its own EntryPoint deposit`,
          });
        }
      }

      const kind = userOps.length > 0 || toEntryPoint ? "erc4337-bundle" : "eoa-transaction";
      const feeWei = receipt ? receipt.gasUsed * receipt.effectiveGasPrice : null;
      const status = receipt ? receipt.status : "pending";

      return jsonResult({
        found: true,
        hash: txHash,
        ...(resolvedFromUserOp ? { resolvedFromUserOpHash: hash } : {}),
        kind,
        status,
        blockNumber: receipt ? receipt.blockNumber.toString() : null,
        from: tx.from,
        to: tx.to ?? null,
        valueWei: tx.value.toString(),
        valuePepu: formatPepu(tx.value),
        selector: tx.input.length >= 10 ? tx.input.slice(0, 10) : null,
        gasUsed: receipt ? receipt.gasUsed.toString() : null,
        effectiveGasPriceWei: receipt ? receipt.effectiveGasPrice.toString() : null,
        transactionFeePepu: feeWei !== null ? formatPepu(feeWei) : null,
        whoPaidGas:
          kind === "eoa-transaction"
            ? `The sender ${tx.from} paid the fee from its own PEPU balance.`
            : "The bundler (the outer sender) fronted the fee and is repaid by the EntryPoint from each UserOperation's paymaster or smart-account deposit; see userOps[].paidBy.",
        userOps,
        ...(kind === "erc4337-bundle"
          ? {
              twoAddressNote:
                "For a UserOperation, sender is the Kernel smart account (the address that holds assets and shows on pepuscan). Its owner is a different address: the EOA, for example the Privy embedded wallet, that signs.",
            }
          : {}),
        ...(status === "reverted"
          ? { revertHint: "Reverted. Run pepu_explain_error on the revert data or message, and pepu_get_transaction for pepuscan's decoded input." }
          : {}),
        links: explorerLinks({ tx: txHash, address: tx.from }),
        sdkFunctions: "explorerLinks, formatPepu (@pepu-chain/sdk); userOpEventFromReceipt (@pepu-chain/sdk/aa)",
      });
    }
  );
}
