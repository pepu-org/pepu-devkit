import { pepuMainnet } from "@pepu-chain/sdk";

export function NetworkBadge() {
  return (
    <span className="chip chip-tag chip-brand" title={`Chain ID ${pepuMainnet.id}`}>
      <span className="dot dot-live" />
      {pepuMainnet.name}
      <span className="sr-only"> (mainnet)</span>
    </span>
  );
}
