/**
 * Environment access, centralized so there is exactly one place that
 * decides what happens when required configuration is missing.
 *
 * `NEXT_PUBLIC_*` variables are inlined at build time by Next.js, so they
 * read the same on the server and in the browser. Privy/PEPU env checks
 * live in the SDK (`PepuPrivyWagmiProvider`, `checkPepuEnv` in
 * `npm run doctor`); this file only parses this template's own addresses.
 */

import { isAddress, type Address } from "viem";

/**
 * Parse a `NEXT_PUBLIC_*` env var as an optional token address. Blank or
 * malformed values become `undefined` rather than letting a typo'd
 * address reach wagmi and fail in a more confusing way downstream.
 */
function readGateAddress(raw: string | undefined): Address | undefined {
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 && isAddress(trimmed) ? trimmed : undefined;
}

/**
 * The ERC-20 token this app gates on, if configured. `.env.example`
 * defaults this to WPEPU purely so the template runs out of the box —
 * that default is not a recommendation to gate on WPEPU specifically.
 */
export const gateErc20Address: Address | undefined = readGateAddress(
  process.env.NEXT_PUBLIC_GATE_ERC20_ADDRESS,
);

/**
 * The ERC-721 collection this app gates on, if configured. Blank by
 * default — there is no verified NFT collection address on Pepe
 * Unchained today. See `.env.example`.
 */
export const gateErc721Address: Address | undefined = readGateAddress(
  process.env.NEXT_PUBLIC_GATE_ERC721_ADDRESS,
);

/**
 * At least one of the two gate tokens must be configured for this
 * template to do anything meaningful. Checked by `components/setup-gate.tsx`.
 */
export const hasAnyGateToken: boolean = Boolean(
  gateErc20Address || gateErc721Address,
);
