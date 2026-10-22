# Self-hosting the bundler and paymaster: notes

Only for people who run the services themselves (PEPU hosts its own at bundler.pepeunchained.com and paymaster.pepeunchained.com). Config lives in `services/bundler/README.md` and `services/paymaster`.

- **The chain's plain RPC does not serve bundler methods.** Conduit's endpoints do not implement `eth_sendUserOperation`, `eth_estimateUserOperationGas` and the rest; those come from a bundler service.
- **Alto `safe-mode` must be `false`** on `@pimlico/alto` 0.0.21 (with it on, `eth_sendUserOperation` fails with HTTP 500 for every operation while gas estimation still works: that is the tell). Run with `--chain-type arbitrum` for Nitro's dual-fee gas model.
- **Alto `enable-cors` must be `true`** when Privy's smart-wallet client calls the bundler from the browser; without it the preflight gets no answer and the browser shows `Failed to fetch`. That exposes the bundler to any web page, so put it behind a filtering proxy in production.
- **Privy's SDK calls `pm_getPaymasterData` more than once per operation**, sometimes in parallel. The policy service is idempotent by `userOpHash`; a paymaster you write must be too.
- **A denial is a JSON-RPC error**; the real reason is in `error.data.reason`. The SDK maps it with `mapPaymasterReason` and `describeUserOpFailure`.
- **`pm_getPaymasterStubData` is unauthenticated by ERC-7677's design** (gas estimation only); the policy is enforced on `pm_getPaymasterData`. Request params are `[userOperation, entryPoint, chainIdHex, context?]`; the result carries `paymaster`, `paymasterData`, `paymasterVerificationGasLimit`, `paymasterPostOpGasLimit`. The SDK builders are `buildPaymasterStubDataRequest`, `buildPaymasterDataRequest` and `buildPaymasterContext` in `@pepu-chain/sdk`.
- Check a running pair with `pepu_bundler_health`, `pepu_paymaster_health`, or `probeBundler(url)` / `probePaymaster(url?)` from `@pepu-chain/sdk/aa`.
