/**
 * Small shared helpers for shaping tool output.
 *
 * Conventions followed across every tool in this server (see README "Tool
 * design conventions"):
 *  - strip internal/opaque ids (Blockscout watchlist ids, private tags, etc.)
 *    before returning anything to the model
 *  - support `response_format: "concise" | "detailed"` wherever a tool could
 *    return a lot; concise is the default
 *  - truncate lists with a short, actionable guidance string rather than
 *    dumping everything
 */

import { formatUnits } from "viem";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ResponseFormat = "concise" | "detailed";

export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2) }],
  };
}

/** Formats a wei-denominated string balance as a human PEPU amount, e.g. "1234.5" -> keeps full precision, just moves the decimal point. */
export function formatPepu(weiString: string | null | undefined): string | null {
  if (weiString === null || weiString === undefined) return null;
  try {
    return formatUnits(BigInt(weiString), 18);
  } catch {
    return null;
  }
}

/**
 * Truncates an array to `limit` items and appends a guidance note describing
 * how many were omitted and how to narrow the query, instead of silently
 * dropping data or dumping everything.
 */
export function paginate<T>(items: T[], limit: number): { items: T[]; note: string | null } {
  if (items.length <= limit) {
    return { items, note: null };
  }
  return {
    items: items.slice(0, limit),
    note: `Showing ${limit} of ${items.length} results. Narrow your query (e.g. a more specific search term, or a smaller address set) to see more relevant results instead of raising this limit.`,
  };
}
