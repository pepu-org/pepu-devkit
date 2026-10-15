#!/usr/bin/env node
/**
 * Smoke test: spawns the built server as a real subprocess over stdio (the
 * exact way an MCP client like Claude Code would), connects an SDK Client to
 * it, lists tools, and calls a couple of them for real against live PEPU
 * infra. Run with `pnpm smoke` after `pnpm build`.
 *
 * This is deliberately a standalone script rather than a vitest test: it
 * makes real network calls against pepuscan.com and the PEPU RPC, which we
 * don't want running on every `pnpm test` / CI invocation.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, "..", "dist", "index.js");

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : JSON.stringify(result);
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
  });

  const client = new Client({ name: "pepu-mcp-smoke-test", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`\nConnected. Server exposes ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}`);
  }

  const expectedMin = 32;
  if (tools.length < expectedMin) throw new Error(`Expected at least ${expectedMin} tools, got ${tools.length}`);
  const unannotated = tools.filter((t) => t.annotations?.readOnlyHint === undefined || t.annotations?.openWorldHint === undefined);
  if (unannotated.length > 0) throw new Error(`Tools missing annotations: ${unannotated.map((t) => t.name).join(", ")}`);
  const { resources } = await client.listResources();
  const { resourceTemplates } = await client.listResourceTemplates();
  const { prompts } = await client.listPrompts();
  console.log(`Resources: ${resources.map((r) => r.uri).join(", ")}`);
  console.log(`Resource templates: ${resourceTemplates.map((r) => r.uriTemplate).join(", ")}`);
  console.log(`Prompts: ${prompts.map((p) => p.name).join(", ")}`);

  console.log("\n=== pepu_explain_error (offline) ===");
  console.log(textOf((await client.callTool({ name: "pepu_explain_error", arguments: { error: "project_not_claimed_onchain" } })) as CallToolResult));
  console.log("\n=== pepu_sponsorship_status (no URLs configured) ===");
  console.log(textOf((await client.callTool({ name: "pepu_sponsorship_status", arguments: { include_deposit: false } })) as CallToolResult));

  console.log("\n=== pepu_chain_info (network: mainnet, concise, live-verified) ===");
  const chainInfo = (await client.callTool({
    name: "pepu_chain_info",
    arguments: { network: "mainnet", response_format: "concise", verify_live: true },
  })) as CallToolResult;
  console.log(textOf(chainInfo));

  console.log("\n=== pepu_get_address_overview (WPEPU, live Blockscout call) ===");
  const overview = (await client.callTool({
    name: "pepu_get_address_overview",
    arguments: { address: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8" },
  })) as CallToolResult;
  console.log(textOf(overview));

  console.log("\n=== pepu_read_contract (WPEPU.symbol(), live RPC call) ===");
  const readResult = (await client.callTool({
    name: "pepu_read_contract",
    arguments: {
      address: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8",
      abi: [{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
      functionName: "symbol",
    },
  })) as CallToolResult;
  console.log(textOf(readResult));

  console.log("\n=== pepu_get_token_info (WPEPU, live Blockscout + RPC cross-check) ===");
  const tokenInfo = (await client.callTool({
    name: "pepu_get_token_info",
    arguments: { address: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8" },
  })) as CallToolResult;
  console.log(textOf(tokenInfo));

  console.log("\n=== pepu_check_contract_deployed (canonical Multicall3 address — should redirect to PEPU's own) ===");
  const multicall = (await client.callTool({
    name: "pepu_check_contract_deployed",
    arguments: { query: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  })) as CallToolResult;
  console.log(textOf(multicall));

  console.log("\n=== pepu_check_contract_deployed (Permit2 by name — should now report deployed:true) ===");
  const permit2 = (await client.callTool({
    name: "pepu_check_contract_deployed",
    arguments: { query: "permit2" },
  })) as CallToolResult;
  console.log(textOf(permit2));

  console.log("\n=== pepu_gas_price (live) ===");
  const gasPrice = (await client.callTool({ name: "pepu_gas_price", arguments: {} })) as CallToolResult;
  console.log(textOf(gasPrice));

  console.log("\n=== pepu_health_check (both networks, live) ===");
  const health = (await client.callTool({ name: "pepu_health_check", arguments: {} })) as CallToolResult;
  console.log(textOf(health));

  console.log("\n=== pepu_smart_account_info (live call to the Kernel v3 Account Factory's getAddress) ===");
  const smartAccount = (await client.callTool({
    name: "pepu_smart_account_info",
    arguments: { owner: "0x000000000000000000000000000000000000dEaD" },
  })) as CallToolResult;
  console.log(textOf(smartAccount));

  console.log("\n=== pepu_decode_error (EntryPoint FailedOp, no network call — pure decode) ===");
  const decodeResult = (await client.callTool({
    name: "pepu_decode_error",
    arguments: { data: "0x220266b600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000001741413231206469646e2774207061792070726566756e64000000000000000000" },
  })) as CallToolResult;
  console.log(textOf(decodeResult));

  console.log("\n=== pepu_verify_contract_guide (static reference, no network call) ===");
  const verifyGuide = (await client.callTool({ name: "pepu_verify_contract_guide", arguments: { tool: "foundry" } })) as CallToolResult;
  console.log(textOf(verifyGuide));

  console.log("\n=== pepu_known_gotchas (static reference, no network call) ===");
  const gotchas = (await client.callTool({ name: "pepu_known_gotchas", arguments: {} })) as CallToolResult;
  console.log(textOf(gotchas));

  console.log("\n=== Error-path check: invalid address to pepu_get_address_overview ===");
  const errorResult = (await client.callTool({
    name: "pepu_get_address_overview",
    arguments: { address: "not-an-address" },
  })) as CallToolResult;
  console.log("isError:", errorResult.isError);
  console.log(textOf(errorResult));

  console.log("\n=== Error-path check: Blockscout tool asked for testnet ===");
  const testnetResult = (await client.callTool({
    name: "pepu_get_address_overview",
    arguments: { address: "0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8", network: "testnet" },
  })) as CallToolResult;
  console.log("isError:", testnetResult.isError);
  console.log(textOf(testnetResult));

  await client.close();
  console.log("\nSmoke test complete.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
