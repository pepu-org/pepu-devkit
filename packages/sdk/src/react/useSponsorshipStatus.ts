import { useMemo } from "react";

import { getSponsorshipStatus } from "../aa/status.js";
import type { GetSponsorshipStatusOptions, SponsorshipStatus } from "../aa/status.js";

/**
 * React wrapper around {@link getSponsorshipStatus} — reports whether PEPU
 * gas sponsorship is available. **Deprecated: always reports unavailable.**
 * The hosted bundler and paymaster service are live and sponsorship is proven
 * on mainnet, but the ERC-7677 URL embeds a project token, so availability can
 * only be answered by a live probe. Use `usePepuSponsorship()` from
 * `@pepu-chain/sdk/aa/react` (it wraps `checkSponsorship`) instead. This hook
 * stays so 0.1 callers keep compiling.
 */
/**
 * @deprecated Always reports unavailable. Use `usePepuSponsorship()` from
 * `@pepu-chain/sdk/aa/react` (live probe). Kept for 0.1 callers.
 */
export function useSponsorshipStatus(
  options?: GetSponsorshipStatusOptions,
): SponsorshipStatus {
  const bundlerUrl = options?.bundlerUrl;
  return useMemo(
    () => getSponsorshipStatus(bundlerUrl === undefined ? undefined : { bundlerUrl }),
    [bundlerUrl],
  );
}
