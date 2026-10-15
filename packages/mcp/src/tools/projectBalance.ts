/**
 * pepu_project_balance
 *
 * WHAT: Reads a v2 sponsorship project's on-chain state (owner, claimed,
 * balance, limits, spent today, pause flag, pending reclaim) with the SDK's
 * `readProject`. The project id is `keccak256(bytes(appId))`
 * (`computeProjectId`), case-sensitive.
 *
 * The v2 paymaster is a deployed canary on PEPU mainnet (external audit pending),
 * read from the registry unless an explicit `paymaster` address is passed. If
 * neither exists this tool returns the computed project id; it never guesses an address.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContract, isDeployed, formatPepu, pepuMainnet } from "@pepu-chain/sdk";
import { computeProjectId, readProject } from "@pepu-chain/sdk/paymaster";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { REMOTE_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { getPublicClient } from "../rpc.js";
import { V2_NOT_DEPLOYED_NOTE, sdkCall } from "../sdk-helpers.js";

const inputSchema = {
  appId: z.string().min(1).optional().describe("The Privy app id (case-sensitive). The project id is keccak256(bytes(appId)). Give appId or projectId."),
  projectId: z.string().optional().describe("A 32-byte project id (0x + 64 hex). Give appId or projectId."),
  paymaster: z
    .string()
    .optional()
    .describe("Override the v2 paymaster address. Defaults to the registry's deployed canary (0xdb28528C9399C33c9A0297E8A62F39145acbC30D)."),
};

export function registerProjectBalanceTool(server: McpServer): void {
  server.registerTool(
    "pepu_project_balance",
    {
      title: "PEPU v2 sponsorship project balance",
      description:
        "Read a v2 sponsorship project on-chain with readProject from @pepu-chain/sdk/paymaster (projectId from computeProjectId = keccak256 of the case-sensitive app id): owner, claimed, balance, spendable limits, spent today, paused, pending reclaim. Reads the deployed v2 canary from the registry by default (external audit pending); an explicit paymaster address overrides it. Deposits are one-way and cannot be withdrawn.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ appId, projectId, paymaster }) => {
      if ((appId === undefined) === (projectId === undefined)) {
        actionableError("Give exactly one of appId or projectId.", "The project id is derived from the app id, so passing both is ambiguous.", "Pass appId (preferred) or projectId.");
      }
      let id: Hex;
      if (projectId !== undefined) {
        if (!isHex(projectId) || projectId.length !== 66) {
          actionableError(`"${projectId}" is not a project id.`, "It must be 0x followed by 64 hex characters (a bytes32).", "Pass appId instead and the id is computed for you.");
        }
        id = projectId;
      } else {
        id = computeProjectId(appId as string);
      }

      const registryEntry = getContract(pepuMainnet.id, "paymasterV2");
      let pm: Address | undefined;
      if (paymaster !== undefined) {
        if (!isAddress(paymaster)) {
          actionableError(`"${paymaster}" is not a valid address.`, "It must be 0x-prefixed with 40 hex characters.", "Pass the verified v2 paymaster contract address.");
        }
        pm = paymaster;
      } else if (isDeployed(registryEntry)) {
        pm = registryEntry.address;
      }

      if (!pm) {
        return jsonResult({
          v2Deployed: false,
          projectId: id,
          message: V2_NOT_DEPLOYED_NOTE,
          registry: registryEntry?.status === "pending" ? registryEntry.reason : undefined,
          sdkFunction: "readProject (@pepu-chain/sdk/paymaster)",
        });
      }

      const state = await sdkCall("readProject", () => readProject(getPublicClient("mainnet"), id, { paymaster: pm }));
      return jsonResult({
        v2Deployed: true,
        projectId: state.projectId,
        paymaster: state.paymaster,
        owner: state.owner,
        claimed: state.claimed,
        paused: state.paused,
        balanceWei: state.balance,
        balancePepu: formatPepu(state.balance),
        dailyLimitWei: state.dailyLimit,
        senderDailyLimitWei: state.senderDailyLimit,
        spentTodayWei: state.spentToday,
        limitsConfigured: state.limitsConfigured,
        pendingReclaim: state.pendingReclaim,
        pendingOwner: state.pendingOwner,
        readiness: !state.claimed
          ? "Not claimed: deposits sit unused until the owner claims the project and sets targets and limits."
          : state.paused
            ? "Paused by the owner."
            : !state.limitsConfigured
              ? "Claimed but limits are not set: nothing is sponsored until setDailyLimit and setSenderDailyLimit run."
              : "Claimed and configured.",
        warning: "Deposits are one-way: nobody can withdraw them.",
        sdkFunction: "readProject (@pepu-chain/sdk/paymaster)",
      });
    }
  );
}
