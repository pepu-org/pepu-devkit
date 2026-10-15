/**
 * pepu_prepare_project_tx
 *
 * WHAT: Encodes the unsigned transactions for a v2 sponsorship project with the
 * SDK's paymaster helpers: deposit (`encodeDeposit`), claim and re-claim
 * (`encodeClaimProject`, `encodeReclaimProject`), execute and cancel re-claim,
 * the three post-claim configuration calls (`configureProject`), and pause.
 * Returns `{ to, data, value }` plus a plain-English warning. It NEVER signs
 * or sends: the owner's wallet does that.
 *
 * The v2 paymaster is a deployed canary on PEPU mainnet (external audit pending).
 * With no `paymaster` argument the registry's `paymasterV2` address is used;
 * an explicit address overrides it. If neither exists this tool says so.
 */

import { z } from "zod";
import { isAddress, parseEther, type Address, type Hex } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatPepu, getContract, isDeployed, pepuMainnet } from "@pepu-chain/sdk";
import {
  computeProjectId,
  configureProject,
  encodeCancelReclaim,
  encodeClaimProject,
  encodeDeposit,
  encodeExecuteReclaim,
  encodeReclaimProject,
  encodeSetPaused,
  type PaymasterCall,
  type ProjectClaimAttestation,
} from "@pepu-chain/sdk/paymaster";
import { STATIC_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { V2_NOT_DEPLOYED_NOTE, sdkCall } from "../sdk-helpers.js";

const ACTIONS = ["deposit", "claim", "reclaim", "executeReclaim", "cancelReclaim", "configure", "setPaused"] as const;

const inputSchema = {
  action: z.enum(ACTIONS).describe("deposit: depositFor(projectId) with native PEPU. claim and reclaim: need the attestation from requestClaimAttestation (server). executeReclaim and cancelReclaim: finish or cancel a timelocked claim or re-claim (the first claim of a project that already holds funds is also timelocked). configure: setTargets + setDailyLimit + setSenderDailyLimit. setPaused: pause or resume sponsorship."),
  paymaster: z.string().optional().describe("Override the v2 paymaster address. Defaults to the registry's deployed canary (0xdb28528C9399C33c9A0297E8A62F39145acbC30D)."),
  appId: z.string().min(1).optional().describe("The Privy app id (case-sensitive). projectId = keccak256(bytes(appId)). Give appId or projectId."),
  projectId: z.string().optional().describe("A bytes32 project id (0x + 64 hex)."),
  amountPepu: z.string().optional().describe("deposit: amount in PEPU as a decimal string, e.g. '2.5'."),
  amountWei: z.string().regex(/^\d+$/).optional().describe("deposit: amount in wei. Give amountPepu or amountWei."),
  attestation: z
    .object({
      appId: z.string(),
      newOwner: z.string(),
      nonce: z.union([z.string(), z.number()]),
      deadline: z.union([z.string(), z.number()]),
      signature: z.string(),
    })
    .optional()
    .describe("claim and reclaim: the EIP-712 ProjectClaim attestation from POST /v2/projects/verify (requestClaimAttestation in @pepu-chain/sdk/paymaster/server)."),
  targets: z.array(z.string()).max(50).optional().describe("configure: destination contracts to sponsor (1 to 50)."),
  dailyLimitPepu: z.string().optional().describe("configure: total daily budget in PEPU."),
  senderDailyLimitPepu: z.string().optional().describe("configure: per-wallet daily budget in PEPU."),
  paused: z.boolean().optional().describe("setPaused: true to pause, false to resume."),
};

function pepuToWei(value: string, label: string): bigint {
  try {
    return parseEther(value);
  } catch {
    return actionableError(`${label} is not a valid PEPU amount.`, `Got "${value}".`, "Use a decimal string such as '2.5'.");
  }
}

function present(call: PaymasterCall) {
  return { to: call.to, data: call.data, value: call.value.toString(), valuePepu: formatPepu(call.value), function: call.function };
}

export function registerPrepareProjectTxTool(server: McpServer): void {
  server.registerTool(
    "pepu_prepare_project_tx",
    {
      title: "Prepare a v2 sponsorship project transaction",
      description:
        "Encode unsigned transactions for a v2 sponsorship project with the paymaster helpers in @pepu-chain/sdk/paymaster: encodeDeposit (depositFor), encodeClaimProject and encodeReclaimProject (from a claim attestation), encodeExecuteReclaim, encodeCancelReclaim, configureProject (setTargets, setDailyLimit, setSenderDailyLimit) and encodeSetPaused. Returns { to, data, value } plus a plain-English warning; it never signs or sends. Deposits are ONE-WAY and the app id is case-sensitive. The v2 paymaster is a deployed canary (external audit pending); the registry address is the default and a verified paymaster address can override it.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ action, paymaster, appId, projectId, amountPepu, amountWei, attestation, targets, dailyLimitPepu, senderDailyLimitPepu, paused }) => {
      const registryEntry = getContract(pepuMainnet.id, "paymasterV2");
      if (paymaster === undefined && !isDeployed(registryEntry)) {
        return jsonResult({ prepared: false, v2Deployed: false, message: V2_NOT_DEPLOYED_NOTE, action });
      }
      if (paymaster !== undefined && !isAddress(paymaster)) {
        actionableError(`"${paymaster}" is not a valid address.`, "It must be 0x-prefixed with 40 hex characters.", "Pass the verified v2 paymaster contract address.");
      }
      const pm = (paymaster ?? (isDeployed(registryEntry) ? registryEntry.address : undefined)) as Address;
      const opts = { paymaster: pm };

      const needsProject = action !== "claim" && action !== "reclaim";
      let id: Hex | undefined;
      if (needsProject) {
        if ((appId === undefined) === (projectId === undefined)) {
          actionableError("Give exactly one of appId or projectId.", `${action} acts on one project.`, "Pass appId (preferred, case-sensitive) or projectId.");
        }
        id = projectId !== undefined ? (projectId as Hex) : computeProjectId(appId as string);
      }

      const requireAttestation = (): ProjectClaimAttestation => {
        if (!attestation) {
          return actionableError(`${action} needs an attestation.`, "The contract only accepts a claim signed by the paymaster service (EIP-712 ProjectClaim).", "Prove the Privy app with requestClaimAttestation (@pepu-chain/sdk/paymaster/server) and pass its result.");
        }
        if (!isAddress(attestation.newOwner)) {
          actionableError("attestation.newOwner is not a valid address.", `Got "${attestation.newOwner}".`, "Use the owner address from the attestation.");
        }
        return {
          appId: attestation.appId,
          newOwner: attestation.newOwner as Address,
          nonce: String(attestation.nonce),
          deadline: String(attestation.deadline),
          signature: attestation.signature as Hex,
        };
      };

      switch (action) {
        case "deposit": {
          if ((amountPepu === undefined) === (amountWei === undefined)) {
            actionableError("Give exactly one of amountPepu or amountWei.", "A deposit needs one amount.", "Pass amountPepu: '2.5' or amountWei.");
          }
          const wei = amountWei !== undefined ? BigInt(amountWei) : pepuToWei(amountPepu as string, "amountPepu");
          const call = await sdkCall("encodeDeposit", () => encodeDeposit(id as Hex, wei, opts));
          return jsonResult({
            prepared: true,
            action,
            projectId: id,
            transactions: [present(call)],
            warnings: [
              "Deposits are ONE-WAY: nobody, including the project owner, can ever withdraw them. They can only be spent as sponsored gas.",
              ...(appId !== undefined ? [`The id is keccak256 of the case-sensitive app id "${appId}". A typo deposits into a project nobody can claim. Check the spelling.`] : []),
              "An unclaimed or unconfigured project spends nothing: the owner must claim it (pending for at least 48 hours once the project holds funds) and set targets and both daily limits first (pepu_project_balance shows the state).",
              "Send from the funder's wallet; this tool never signs.",
            ],
            sdkFunction: "encodeDeposit (@pepu-chain/sdk/paymaster)",
          });
        }
        case "claim":
        case "reclaim": {
          const att = requireAttestation();
          const call = await sdkCall(action === "claim" ? "encodeClaimProject" : "encodeReclaimProject", () => (action === "claim" ? encodeClaimProject(att, opts) : encodeReclaimProject(att, opts)));
          return jsonResult({
            prepared: true,
            action,
            transactions: [present(call)],
            warnings: [
              action === "claim"
                ? "claimProject sets ONLY the owner, and takes effect at once only if the project holds no funds. If it already holds deposits, the claim is PENDING for the admin change delay (at least 48 hours): the contract owner or manager can cancel it, and anyone finishes it with action executeReclaim. Nothing is sponsored until the owner also runs setTargets, setDailyLimit and setSenderDailyLimit (action: configure); a project with no per-wallet limit is rejected."
                : "A re-claim of an owned project is timelocked (at least 48 hours) and the current owner can cancel it once per new owner (a second attested re-claim by the same new owner cannot be cancelled). It expires 30 days after it becomes executable. It is not instant.",
              "Send from the new owner's wallet (the attestation's newOwner).",
            ],
            sdkFunction: `${action === "claim" ? "encodeClaimProject" : "encodeReclaimProject"} (@pepu-chain/sdk/paymaster)`,
          });
        }
        case "executeReclaim":
        case "cancelReclaim": {
          const call = await sdkCall(action, () => (action === "executeReclaim" ? encodeExecuteReclaim(id as Hex, opts) : encodeCancelReclaim(id as Hex, opts)));
          return jsonResult({ prepared: true, action, projectId: id, transactions: [present(call)], warnings: [action === "executeReclaim" ? "Anyone may send this once the delay has passed and before the pending claim expires (30 days later). It fails if the attesting signer has since been removed." : "Current owner only (and only once per new owner); for a pending FIRST claim of an unowned project the contract owner or manager cancels. This tool never signs."], sdkFunction: `${action === "executeReclaim" ? "encodeExecuteReclaim" : "encodeCancelReclaim"} (@pepu-chain/sdk/paymaster)` });
        }
        case "setPaused": {
          if (paused === undefined) actionableError("setPaused needs paused: true or false.", "It was not given.", "Pass paused: true to pause sponsorship, false to resume.");
          const call = await sdkCall("encodeSetPaused", () => encodeSetPaused(id as Hex, paused as boolean, opts));
          return jsonResult({ prepared: true, action, projectId: id, transactions: [present(call)], warnings: ["Owner-only call."], sdkFunction: "encodeSetPaused (@pepu-chain/sdk/paymaster)" });
        }
        case "configure": {
          if (!targets || targets.length === 0 || dailyLimitPepu === undefined || senderDailyLimitPepu === undefined) {
            actionableError("configure needs targets, dailyLimitPepu and senderDailyLimitPepu.", "A project spends nothing until all three are set.", "Pass 1 to 50 target contracts and both daily limits in PEPU.");
          }
          const bad = (targets as string[]).find((t) => !isAddress(t));
          if (bad !== undefined) actionableError(`"${bad}" in targets is not a valid address.`, "Every target must be a 0x address.", "Fix the list.");
          const result = await sdkCall("configureProject", () =>
            configureProject({
              ...(appId !== undefined ? { appId } : {}),
              ...(projectId !== undefined ? { projectId: projectId as Hex } : {}),
              targets: targets as Address[],
              dailyLimitWei: pepuToWei(dailyLimitPepu as string, "dailyLimitPepu"),
              senderDailyLimitWei: pepuToWei(senderDailyLimitPepu as string, "senderDailyLimitPepu"),
              paymaster: pm,
            })
          );
          return jsonResult({
            prepared: true,
            action,
            projectId: result.projectId,
            transactions: result.calls.map(present),
            order: "Send in this order. All three are owner-only calls to the same contract, so a smart account can batch them in one UserOperation; an EOA sends them one after another.",
            warnings: ["Spend caps should sit above the paymaster's per-operation gas reservation (about 20.5 PEPU for a session's first operation), or users hit cap errors after their first action."],
            sdkFunction: "configureProject (@pepu-chain/sdk/paymaster)",
          });
        }
      }
    }
  );
}
