/**
 * MCP tool annotations. Every tool declares all four hints so a client can
 * decide what to auto-approve. Defaults are the safe reading: read-only,
 * non-destructive, idempotent. `openWorld` is true when the tool talks to the
 * network or the filesystem outside this package.
 */

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export interface AnnotationOptions {
  /** Default true: the tool changes nothing. */
  readOnly?: boolean;
  /** Default false: the tool never overwrites or deletes anything. */
  destructive?: boolean;
  /** Default true: calling twice with the same input has the same effect. */
  idempotent?: boolean;
  /** Default false: true when the tool reaches the network or the user's filesystem. */
  openWorld?: boolean;
}

export function annotate(o: AnnotationOptions = {}): ToolAnnotations {
  const readOnly = o.readOnly ?? true;
  return {
    readOnlyHint: readOnly,
    // Per the MCP spec destructiveHint is only meaningful when readOnlyHint is false.
    destructiveHint: readOnly ? false : (o.destructive ?? false),
    idempotentHint: o.idempotent ?? true,
    openWorldHint: o.openWorld ?? false,
  };
}

/** Pure/static data: no network, no files. */
export const STATIC_READ = annotate({ openWorld: false });
/** Reads from RPC, pepuscan or another remote service. */
export const REMOTE_READ = annotate({ openWorld: true });
