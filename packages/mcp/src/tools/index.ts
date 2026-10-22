import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerChainInfoTool } from "./chainInfo.js";
import { registerAddressOverviewTool } from "./addressOverview.js";
import { registerGetTransactionTool } from "./getTransaction.js";
import { registerReadContractTool } from "./readContract.js";
import { registerVerifyContractStatusTool } from "./verifyContractStatus.js";
import { registerEstimateGasCostTool } from "./estimateGasCost.js";
import { registerSearchTool } from "./search.js";
import { registerCheckContractDeployedTool } from "./checkContractDeployed.js";
import { registerGasPriceTool } from "./gasPrice.js";
import { registerGetTokenInfoTool } from "./getTokenInfo.js";
import { registerHealthCheckTool } from "./healthCheck.js";
import { registerKnownGotchasTool } from "./knownGotchas.js";
import { registerDecodeErrorTool } from "./decodeError.js";
import { registerSmartAccountInfoTool } from "./smartAccountInfo.js";
import { registerVerifyContractGuideTool } from "./verifyContractGuide.js";
import { registerBundlerHealthTool } from "./bundlerHealth.js";
import { registerPaymasterHealthTool } from "./paymasterHealth.js";
import { registerSponsorshipStatusTool } from "./sponsorshipStatus.js";
import { registerProjectBalanceTool } from "./projectBalance.js";
import { registerExplainErrorTool } from "./explainError.js";
import { registerExplainTxTool } from "./explainTx.js";
import { registerDecodeTxLogsTool } from "./decodeTxLogs.js";
import { registerListTemplatesTool } from "./listTemplates.js";
import { registerScaffoldAppTool } from "./scaffoldApp.js";
import { registerCheckEnvTool } from "./checkEnv.js";
import { registerCheckPrivyConfigTool } from "./checkPrivyConfig.js";
import { registerGenerateAuthorizationKeyTool } from "./generateAuthorizationKey.js";
import { registerSessionPolicyTool } from "./sessionPolicy.js";
import { registerEncodeCallsTool } from "./encodeCalls.js";
import { registerPrepareProjectTxTool } from "./prepareProjectTx.js";
import { registerGetDocsTool } from "./getDocs.js";
import { registerSdkSnippetTool } from "./sdkSnippet.js";
import { registerSdkExportsTool } from "./sdkExports.js";

export type ToolRegistrar = (server: McpServer) => void;

/**
 * Every PEPU tool, as data. Adding a tool is one line here (plus its file).
 * Grouped: chain and Blockscout lookups, then the SDK-backed probes and
 * explainers (C2), then generate, scaffold and docs tools (C3).
 */
export const TOOL_REGISTRARS: readonly ToolRegistrar[] = [
  // Chain facts, lookups and reference (the original tools)
  registerChainInfoTool,
  registerAddressOverviewTool,
  registerGetTransactionTool,
  registerReadContractTool,
  registerVerifyContractStatusTool,
  registerEstimateGasCostTool,
  registerSearchTool,
  registerCheckContractDeployedTool,
  registerGasPriceTool,
  registerGetTokenInfoTool,
  registerHealthCheckTool,
  registerKnownGotchasTool,
  registerDecodeErrorTool,
  registerSmartAccountInfoTool,
  registerVerifyContractGuideTool,
  // Probes, status and explainers
  registerBundlerHealthTool,
  registerPaymasterHealthTool,
  registerSponsorshipStatusTool,
  registerProjectBalanceTool,
  registerExplainErrorTool,
  registerExplainTxTool,
  registerDecodeTxLogsTool,
  // Generate, scaffold, docs
  registerListTemplatesTool,
  registerScaffoldAppTool,
  registerCheckEnvTool,
  registerCheckPrivyConfigTool,
  registerGenerateAuthorizationKeyTool,
  registerSessionPolicyTool,
  registerEncodeCallsTool,
  registerPrepareProjectTxTool,
  registerGetDocsTool,
  registerSdkSnippetTool,
  registerSdkExportsTool,
];

/** Registers every PEPU-specific tool onto the given server instance. */
export function registerAllTools(server: McpServer): void {
  for (const register of TOOL_REGISTRARS) register(server);
}
