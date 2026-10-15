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
 * The deployed PepuNft contract this app mints from. `undefined` when
 * unset or malformed (rather than letting a typo'd address reach wagmi
 * and fail deeper in the stack) — see components/setup-gate.tsx, which
 * blocks rendering the app until this is a real address.
 */
function readAddress(raw: string | undefined): Address | undefined {
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 && isAddress(trimmed) ? trimmed : undefined;
}

export const nftContractAddress: Address | undefined = readAddress(
  process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS,
);

export const hasNftContractAddress = Boolean(nftContractAddress);
