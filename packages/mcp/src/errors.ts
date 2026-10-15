/**
 * A tool-facing error carrying actionable guidance for the calling model.
 *
 * McpServer.registerTool catches any Error thrown from a tool handler and
 * turns it into a CallToolResult with isError: true (a Tool Execution Error
 * per the MCP spec), rather than a JSON-RPC protocol-level error. That is
 * exactly the behavior we want: the model sees the error as tool output it
 * can reason about and recover from, not a transport failure. See
 * @modelcontextprotocol/sdk/server/mcp.js's tool request handler.
 *
 * Every message thrown via this class should follow the shape:
 *   what went wrong -> why -> what to do instead.
 */
export class PepuToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PepuToolError";
  }
}

/** Throws a PepuToolError with a consistent "what/why/fix" template. */
export function actionableError(what: string, why: string, fix: string): never {
  throw new PepuToolError(`${what} ${why} ${fix}`);
}
