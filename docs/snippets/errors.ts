// The SDK error model. See docs/sdk/core.md and docs/sdk/errors.md
import { PepuError, explainError, toErrorResponse, toPepuError } from "@pepu-chain/sdk";

export async function handler(run: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await run());
  } catch (e) {
    // { error: { code, message, hint } } with the status from the catalog.
    return toErrorResponse(e);
  }
}

export function describe(e: unknown): string {
  if (e instanceof PepuError) return `${e.code}: ${e.hint}`;
  const explained = explainError(e);
  return `${explained.code}: ${explained.fix}`;
}

export function retryable(e: unknown): boolean {
  return toPepuError(e, { op: "send" }).retryable;
}
