import { pepuMainnet } from "@pepu-chain/sdk";

export function NetworkBadge() {
  return (
    <span className="chip chip-tag chip-brand" title={`Chain ID ${pepuMainnet.id}`}>
      <span className="dot dot-live" />
      {pepuMainnet.name}
      {/* Text, not just colour, says which kind of network this is. */}
      <span className="sr-only"> (mainnet)</span>
    </span>
  );
}
