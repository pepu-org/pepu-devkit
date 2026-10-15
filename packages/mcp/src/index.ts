#!/usr/bin/env node
/**
 * stdio entry point for the PEPU MCP server. This is what an MCP client
 * (Claude Code, Claude Desktop, etc.) actually launches — see README.md for
 * the config JSON to paste into a client.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPepuMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const server = createPepuMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for JSON-RPC framing; all diagnostic output must go to stderr.
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((error: unknown) => {
  console.error("Fatal error starting pepu-mcp:", error);
  process.exit(1);
});
