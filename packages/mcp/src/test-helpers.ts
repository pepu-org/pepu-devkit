/** Shared test-only helpers: spin up a real McpServer wired to a real Client over an in-process transport. */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPepuMcpServer } from "./server.js";

/** The SDK types callTool()'s return as a union (normal result vs. a legacy `toolResult` compatibility shape) since resultSchema is optional — every tool in this server always returns the normal shape, so the helpers below narrow to it at runtime. */
export type CallToolResponse = Awaited<ReturnType<Client["callTool"]>>;

export async function createTestClient(): Promise<Client> {
  const server = createPepuMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "pepu-mcp-test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

export function textOf(result: CallToolResponse): string {
  if ("content" in result && Array.isArray(result.content)) {
    const first: unknown = result.content[0];
    if (first && typeof first === "object" && "type" in first && first.type === "text" && "text" in first) {
      return String(first.text);
    }
  }
  return JSON.stringify(result);
}

export function jsonOf(result: CallToolResponse): unknown {
  return JSON.parse(textOf(result));
}

export function isError(result: CallToolResponse): boolean {
  return "isError" in result && result.isError === true;
}
