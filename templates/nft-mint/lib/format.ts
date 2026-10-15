/** Truncate an address/hash to the familiar `0x1234…abcd` shape. */
export function truncateHex(value: string, lead = 6, trail = 4): string {
  if (value.length <= lead + trail + 2) return value;
  return `${value.slice(0, lead)}…${value.slice(-trail)}`;
}
