/**
 * Error text that is safe to log or return: RPC provider URLs embed an API key (a secret), and viem's error
 * messages quote the request URL verbatim. Keep the first line of the short message and mask every URL.
 */
export function safeErrorMessage(error: unknown): string {
  const e = error as { shortMessage?: unknown; message?: unknown } | null;
  const raw =
    typeof e?.shortMessage === "string" ? e.shortMessage : typeof e?.message === "string" ? e.message : String(error);
  const firstLine = raw.split("\n")[0] ?? "";
  return firstLine.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "<url>").slice(0, 300);
}
