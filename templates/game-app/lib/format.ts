/** Truncate an address/hash to the familiar `0x1234…abcd` shape. */
export function truncateHex(value: string, lead = 6, trail = 4): string {
  if (value.length <= lead + trail + 2) return value;
  return `${value.slice(0, lead)}…${value.slice(-trail)}`;
}

/** Format seconds remaining as `mm:ss`, clamped at zero. */
export function formatCountdown(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  return `${Math.floor(clamped / 60)}:${(clamped % 60).toString().padStart(2, "0")}`;
}
