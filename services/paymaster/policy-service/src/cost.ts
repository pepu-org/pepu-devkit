/**
 * Worst-case sponsorship cost, per the brief (Part 2 step 8): the ceiling
 * this approval could allow the bundler to draw from the paymaster's
 * EntryPoint deposit, computed and booked BEFORE the actual on-chain cost is
 * known (there is no "actual cost" yet — we're approving a ceiling).
 *
 *   worstCaseCostWei = (verificationGasLimit + callGasLimit + preVerificationGas
 *                        + paymasterVerificationGasLimit + paymasterPostOpGasLimit)
 *                       * maxFeePerGas
 *
 * NOTE (documented per the brief, not implemented here — out of scope):
 * actual on-chain cost is typically lower than this due to EntryPoint gas
 * refunds (unused callGasLimit, EIP-1559 basefee vs maxFeePerGas spread).
 * Reconciling approved-vs-actual from on-chain `UserOperationSponsored`
 * events — and alerting on a signer-key-compromise pattern where approved
 * volume diverges from on-chain volume — is real, valuable follow-up work
 * this service does not implement (it needs the contract deployed and
 * indexed). See README "Known gaps".
 */
export function computeWorstCaseCostWei(params: {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  maxFeePerGas: bigint;
}): bigint {
  const totalGas =
    params.verificationGasLimit +
    params.callGasLimit +
    params.preVerificationGas +
    params.paymasterVerificationGasLimit +
    params.paymasterPostOpGasLimit;
  return totalGas * params.maxFeePerGas;
}
