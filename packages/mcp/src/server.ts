/**
 * Transport-agnostic server factory. index.ts (stdio) is the only wired-up
 * entry point today, but any future transport (e.g. Streamable HTTP) just
 * needs to call createPepuMcpServer() and connect its own Transport — no
 * tool code changes required. See README "Adding HTTP transport later".
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json";
import { registerAllPrompts } from "./prompts.js";
import { registerAllResources } from "./resources.js";
import { registerAllTools } from "./tools/index.js";

export const SERVER_NAME = "pepu-mcp";
/** The package version, read from package.json at build time so the two can never drift. */
export const SERVER_VERSION: string = pkg.version;

export function createPepuMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAllTools(server);
  registerAllResources(server);
  registerAllPrompts(server);

  return server;
}
