/**
 * Client-safe environment access: both values are `NEXT_PUBLIC_*`, so this
 * module may be imported from "use client" components. `PRIVY_APP_SECRET`
 * is read only by the SDK's `/privy/server` (`createEnsureWalletRoute`).
 */

export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "";

/**
 * Optional override for the paymaster contract whose EntryPoint deposit the
 * demo reads before and after the tap. Unset means the SDK's registry
 * address (the v2 `PepuSponsoredPaymasterV7` canary live on PEPU mainnet), which
 * `getPaymasterDeposit` uses by default.
 */
const override = process.env.NEXT_PUBLIC_PAYMASTER_CONTRACT_ADDRESS?.trim();
export const paymasterContractAddress = override ? (override as `0x${string}`) : undefined;
