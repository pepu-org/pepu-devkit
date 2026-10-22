/**
 * Wire types shared by the combo server routes and the browser hook. Types
 * only: safe to import from both entries.
 */

/**
 * What `createSponsoredSessionRoutes(...).act.POST` returns after one sponsored
 * action. `actualGasCostWei` is a decimal string (JSON has no bigint).
 *
 * @example
 * const session = useSponsoredSession<undefined, SponsoredActResult>({ scope });
 */
export interface SponsoredActResult {
  userOpHash: string;
  transactionHash: string;
  kernelAddress: string;
  success: boolean;
  /** The paymaster that sponsored the operation, or `null` when none did. */
  paymaster: string | null;
  actualGasCostWei: string;
  explorerUrl: string;
  /** Successful actions in this session, as counted by the server. */
  actions: number;
}
