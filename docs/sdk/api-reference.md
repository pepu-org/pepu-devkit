# Generated API Reference

A complete index of every export of `@pepu-chain/sdk` version 0.2.4, one table per import path, derived from the compiled type declarations. Use it to confirm a symbol exists before you import it. Signatures, behavior, errors and examples are on the per-subpath pages linked from each section.

The lists below were extracted from the built package with the TypeScript compiler API, so they match the shipped exports and not the source comments.

## How this page is produced

This index comes from a one-off extraction, not a typedoc build. typedoc would add a dev dependency and a config outside `docs/`, and its per-symbol pages would duplicate the signatures that the subpath pages already carry next to their examples and error codes. Two sources keep it honest:

- The SDK test `packages/sdk/test/exports.test.ts` fails when the set of import paths changes.
- The MCP tool `pepu_sdk_exports` returns the export list live from the installed package.

When an export changes, update this page and the subpath page in the same change.

## How it relates to the subpath pages

| You want | Go to |
|---|---|
| Which import path holds a symbol | This page |
| Signature, what it abstracts, server or client, peers, errors, an example | The subpath page, linked under each heading |
| Which subpath for which pillar | [SDK Overview and Reference](reference.md#pillar-to-subpath-decision-table) |
| Error codes | [SDK Error Catalog](errors.md) |

## Exports by import path

### `@pepu-chain/sdk`

client-safe. Page: [core](core.md).

| Kind | Exports |
|---|---|
| Values (91) | `isPepuChain`, `pepuChains`, `pepuMainnet`, `pepuTestnet`, `getPepuSwapContract`, `listPepuSwapContracts`, `pepuSwapContracts`, `pepuTokenList`, `getPublicClient`, `createPepuscanClient`, `toAddEthereumChainParameter`, `switchOrAddPepuChain`, `DEFAULT_MAX_SEND_MARGIN_BPS`, `estimateTransactionCost`, `explainDualFeeModel`, `formatPepu`, `formatPepuGasPrice`, `formatUnitsCompact`, `getNitroFeeBreakdown`, `maxSendableAmount`, `buildPaymasterContext`, `buildPaymasterDataRequest`, `buildPaymasterStubDataRequest`, `getContract`, `listContracts`, `isDeployed`, `getPepuAddresses`, `pepuContracts`, `explorerUrl`, `txUrl`, `addressUrl`, `tokenUrl`, `blockUrl`, `explorerLinks`, `getPepuKernelStack`, `getSponsorshipStatus`, `getKernelAccountAddress`, `checkSponsorship`, `arbGasInfoAbi`, `ARB_GAS_INFO_ADDRESS`, `entryPointV07Abi`, `ERC7579_MODULE_TYPE`, `kernelEcdsaValidatorAbi`, `KERNEL_V3_1_IMPLEMENTATION_ADDRESS`, `kernelFactoryAbi`, `pepuSwapMulticallAbi`, `pepuSwapPermit2Abi`, `pepuSwapPositionManagerAbi`, `pepuSwapQuoterAbi`, `pepuSwapRouterAbi`, `pepuSwapTickLensAbi`, `pepuSwapUniversalRouterAbi`, `pepuSwapV3FactoryAbi`, `pepuSwapV3PoolAbi`, `wpepuAbi`, `multicall3Abi`, `permit2Abi`, `erc20Abi`, `erc721Abi`, `getErrorEntry`, `errorDocsUrl`, `explainError`, `toPepuError`, `toErrorBody`, `toErrorResponse`, `PEPU_ERRORS_DOCS_URL`, `PEPU_ERROR_CATALOG`, `PepuError`, `PepuConfigError`, `PepuAuthError`, `PepuPolicyError`, `PepuSessionError`, `PepuBundlerError`, `PepuPaymasterError`, `PepuChainError`, `resolvePepuEndpoints`, `isHostedSponsorshipLive`, `PEPU_HOSTED`, `PEPU_ENV`, `PEPU_PUBLIC_ENV`, `assertNotCanonicalMulticall3`, `getMulticall3`, `pepuMulticall`, `encodeAggregate3`, `decodeAggregate3Result`, `CANONICAL_MULTICALL3_ADDRESS`, `getPermit2`, `permit2Domain`, `buildPermitSingleTypedData`, `buildPermitTransferFromTypedData`, `readPermit2Allowance` |
| Types (42) | `PepuChain`, `PepuChainId`, `PepuSwapContractName`, `PepuTokenInfo`, `PepuTokenList`, `PepuscanClient`, `PepuscanTokenMetadata`, `DualFeeModelExplanation`, `FormatPepuOptions`, `MaxSendableAmountOptions`, `MaxSendableAmountResult`, `NitroFeeBreakdown`, `TransactionCostEstimate`, `BuildPaymasterRequestOptions`, `Erc7677UserOperation`, `PaymasterContext`, `PaymasterDataRequest`, `PaymasterDataResult`, `PaymasterRpcError`, `PaymasterRpcParams`, `PaymasterRpcResponse`, `PaymasterStubDataRequest`, `PaymasterStubDataResult`, `PepuContractName`, `DeployedContract`, `PendingContract`, `ContractEntry`, `PepuContractRegistry`, `PepuAddressRow`, `ExplorerResourceType`, `PepuKernelStack`, `SponsorshipStatus`, `GetSponsorshipStatusOptions`, `SponsorshipReport`, `CheckSponsorshipOptions`, `PepuErrorCode`, `ErrorCatalogEntry`, `PepuErrorOptions`, `ErrorExplanation`, `ResolvePepuEndpointsOptions`, `PepuEndpoints`, `Permit2TypedData` |

### `@pepu-chain/sdk/react`

client (React). Page: [core](core.md).

| Kind | Exports |
|---|---|
| Values (3) | `usePepuBalance`, `usePepuChain`, `useSponsorshipStatus` |
| Types (3) | `UsePepuBalanceOptions`, `UsePepuBalanceResult`, `UsePepuChainResult` |

### `@pepu-chain/sdk/privy`

client-safe. Page: [privy](privy.md).

| Kind | Exports |
|---|---|
| Values (6) | `createPepuPrivyConfig`, `checkPrivyDashboardConfig`, `privyDashboardChecker`, `PRIVY_ENV`, `PRIVY_ENV_ALIASES`, `PEPU_PRIVY_REQUIREMENTS` |
| Types (9) | `PrivyLoginMethod`, `EmbeddedWalletCreateOnLogin`, `PepuPrivyClientConfig`, `CreatePepuPrivyConfigOptions`, `PrivyPublicAppConfig`, `PrivyRequirementResult`, `PrivyRequirement`, `PrivyDashboardCheckItem`, `PrivyDoctorCheck` |

### `@pepu-chain/sdk/privy/react`

client (React). Page: [privy-react](privy-react.md).

| Kind | Exports |
|---|---|
| Values (9) | `composeProviders`, `PepuPrivyProvider`, `useEmbeddedWallet`, `shouldPinEmbeddedWallet`, `usePinEmbeddedWallet`, `useEnsureWallet`, `WalletGate`, `usePepuAuthFetch`, `requestEnsureWallet` |
| Types (2) | `PepuPrivyProviderProps`, `EnsureWalletStatus` |

### `@pepu-chain/sdk/privy/wagmi`

client (React). Page: [privy-wagmi](privy-wagmi.md).

| Kind | Exports |
|---|---|
| Values (4) | `pepuWagmiConfig`, `useActiveWalletPin`, `PepuPrivyWagmiProvider`, `EMBEDDED_WALLET_IS_ACTIVE_BY_DEFAULT` |
| Types (1) | `PepuPrivyWagmiProviderProps` |

### `@pepu-chain/sdk/privy/server`

server only. Page: [privy-server](privy-server.md).

| Kind | Exports |
|---|---|
| Values (8) | `privyEnvVar`, `readPrivyServerEnv`, `createPrivyServer`, `verifyRequestUser`, `findEmbeddedEthereumWallet`, `findDelegatedEthereumWallet`, `requireUser`, `createEnsureWalletRoute` |
| Types (4) | `LinkedWallet`, `PrivyUser`, `PepuUser`, `PrivyServerEnv` |

### `@pepu-chain/sdk/session`

client-safe. Page: [session](session.md).

| Kind | Exports |
|---|---|
| Values (16) | `checkApproval`, `describeKernelSessionScope`, `isCallInScope`, `parseApproval`, `assertWithinPolicyNameLimit`, `buildSessionPolicy`, `withGasLimitBuffer`, `broadcastSignedTransaction`, `signAndBroadcast`, `resolveSessionMinutes`, `sessionExpiry`, `describeSessionScope`, `PRIVY_POLICY_NAME_MAX_LENGTH`, `DEFAULT_SESSION_MINUTES`, `MAX_SESSION_MINUTES`, `SESSION_TRUST_NOTICE` |
| Types (15) | `ApprovalCheck`, `KernelSessionCall`, `KernelSessionScope`, `ParsedApproval`, `SessionPolicyCondition`, `SessionPolicyRule`, `SessionPolicy`, `BuildSessionPolicyParams`, `PrivyUnsignedTransaction`, `SignedTransactionLike`, `BroadcastClient`, `SignAndBroadcastClient`, `SignAndBroadcastParams`, `SessionScopeFunction`, `SessionScope` |

### `@pepu-chain/sdk/session/server`

server only. Page: [session](session.md).

| Kind | Exports |
|---|---|
| Values (6) | `createSessionRoutes`, `privySessionSigner`, `createSessionActionRoute`, `signAndBroadcast`, `broadcastSignedTransaction`, `withGasLimitBuffer` |
| Types (8) | `SessionScopeInput`, `LazySessionScopeInput`, `VerifyUser`, `SessionPrivyClient`, `CreateSessionRoutesOptions`, `PrivySessionSignerOptions`, `SessionCall`, `CreateSessionActionRouteOptions` |

### `@pepu-chain/sdk/session/react`

client (React). Page: [session](session.md).

| Kind | Exports |
|---|---|
| Values (6) | `errorFromResponse`, `deriveSessionState`, `useSessionGrant`, `useSessionStatus`, `useSessionRevoke`, `useSessionAct` |
| Types (5) | `AuthFetch`, `SessionState`, `SessionGrantStatus`, `SessionRevokeStatus`, `SessionActStatus` |

### `@pepu-chain/sdk/session/kernel`

mixed (session key server only). Page: [session-kernel](session-kernel.md).

| Kind | Exports |
|---|---|
| Values (16) | `buildKernelSessionPolicies`, `generateSessionKey`, `expectedPermissionId`, `approveKernelSession`, `loadKernelSessionAccount`, `KERNEL_VERSION`, `getKernelAddress`, `createMemoryStore`, `isLive`, `checkApproval`, `describeKernelSessionScope`, `isCallInScope`, `parseApproval`, `CALL_POLICY_V0_0_4_ADDRESS`, `TIMESTAMP_POLICY_ADDRESS`, `SESSION_GAS_RESERVATION_PEPU` |
| Types (8) | `KernelOwner`, `KernelSmartAccount`, `SessionRecord`, `SessionStore`, `ApprovalCheck`, `KernelSessionCall`, `KernelSessionScope`, `ParsedApproval` |

### `@pepu-chain/sdk/aa`

client-safe. Page: [aa](aa.md).

| Kind | Exports |
|---|---|
| Values (17) | `ENTRY_POINT_V07`, `createPepuBundlerClient`, `createPepuPaymasterClient`, `estimatePepuUserOpFees`, `getPaymasterDeposit`, `probeBundler`, `probePaymaster`, `describeUserOpFailure`, `redactSecrets`, `encodeKernelExecute`, `normalizeCalls`, `userOpEventFromReceipt`, `userOpEventsFromReceipt`, `getPepuKernelStack`, `getSponsorshipStatus`, `getKernelAccountAddress`, `checkSponsorship` |
| Types (13) | `BundlerProbeResult`, `FetchLike`, `PaymasterProbeResult`, `ProbeOptions`, `EncodedCall`, `UserOpEvent`, `Call`, `SponsoredResult`, `PepuKernelStack`, `SponsorshipStatus`, `GetSponsorshipStatusOptions`, `SponsorshipReport`, `CheckSponsorshipOptions` |

### `@pepu-chain/sdk/aa/kernel`

client-safe. Page: [aa](aa.md).

| Kind | Exports |
|---|---|
| Values (6) | `toPepuKernelAccount`, `getKernelAddress`, `createPepuSponsoredClient`, `sendSponsored`, `encodeKernelExecute`, `KERNEL_VERSION` |
| Types (5) | `Call`, `KernelSmartAccount`, `KernelAccountClient`, `KernelOwner`, `SendSponsoredResult` |

### `@pepu-chain/sdk/aa/react`

client (React). Page: [aa](aa.md).

| Kind | Exports |
|---|---|
| Values (3) | `usePepuSmartAccount`, `useSponsoredSend`, `usePepuSponsorship` |
| Types (4) | `Call`, `SponsoredResult`, `SponsoredSendStatus`, `UseSponsoredSendOptions` |

### `@pepu-chain/sdk/aa/react-direct`

client (React). Page: [aa](aa.md).

| Kind | Exports |
|---|---|
| Values (2) | `useDirectSmartAccount`, `useDirectSponsoredSend` |
| Types (4) | `Call`, `SponsoredResult`, `DirectSponsoredSendStatus`, `UseDirectSponsoredSendOptions` |

### `@pepu-chain/sdk/paymaster`

client-safe. Page: [paymaster](paymaster.md).

| Kind | Exports |
|---|---|
| Values (30) | `pepuSponsoredPaymasterV2Abi`, `credentialKind`, `buildErc7677Url`, `assertApproved`, `createPaymasterApi`, `serializeAttestation`, `resolvePaymasterV2Address`, `computeProjectId`, `readProject`, `encodeDeposit`, `encodeClaimProject`, `encodeReclaimProject`, `encodeClaimFromVerification`, `encodeExecuteReclaim`, `encodeCancelReclaim`, `encodeSetTargets`, `encodeSetDailyLimit`, `encodeSetSenderDailyLimit`, `encodeSetPaused`, `encodeProposeProjectOwner`, `encodeAcceptProjectOwnership`, `configureProject`, `sendPaymasterCalls`, `depositFor`, `getProjectId`, `mapPaymasterReason`, `paymasterReasonToError`, `decodePaymasterRevert`, `PAYMASTER_DENIAL_REASONS`, `PAYMASTER_REASON_CODES` |
| Types (32) | `Quantity`, `SponsorUserOp`, `SponsorApproval`, `SponsorDenial`, `SponsorResult`, `SponsorAuth`, `V2LoginResult`, `V2ConfigResponse`, `V2FreeTierInfo`, `V2ContractInfo`, `PreparedTx`, `PrepareRequest`, `SerializedAttestation`, `RegisterProjectRequest`, `RegisterProjectResponse`, `ProjectSettings`, `ProjectDetail`, `V2RequestOptions`, `CreatePaymasterApiOptions`, `PaymasterApiV1`, `PaymasterApiV2`, `PaymasterApi`, `LoginWithWalletOptions`, `BuildErc7677UrlOptions`, `PaymasterCall`, `ProjectClaimAttestation`, `PaymasterAddressOption`, `ProjectState`, `ReadProjectOptions`, `ConfigureProjectParams`, `DepositForParams`, `PaymasterDenialReason` |

### `@pepu-chain/sdk/paymaster/server`

server only. Page: [paymaster](paymaster.md).

| Kind | Exports |
|---|---|
| Values (1) | `requestClaimAttestation` |
| Types (2) | `RequestClaimAttestationParams`, `ClaimAttestationResult` |

### `@pepu-chain/sdk/combo`

server only. Page: [combo](combo.md).

| Kind | Exports |
|---|---|
| Values (5) | `createSponsoredSessionRoutes`, `assertCallsInScope`, `createMemoryStore`, `isLive`, `resolveSessionMinutes` |
| Types (9) | `SessionRecord`, `SessionStore`, `KernelSessionCall`, `KernelSessionScope`, `SponsoredActResult`, `ComboUser`, `ComboAuthenticate`, `SponsoredSessionRoutesOptions`, `SponsoredSessionRoutes` |

### `@pepu-chain/sdk/combo/react`

client (React). Page: [combo](combo.md).

| Kind | Exports |
|---|---|
| Values (4) | `deriveSessionPhase`, `grantKernelSession`, `useSponsoredSession`, `DEFAULT_SESSION_ENDPOINTS` |
| Types (6) | `SponsoredActResult`, `SponsoredSessionEndpoints`, `SponsoredSessionPhase`, `PreparedSession`, `SponsoredSessionStatus`, `UseSponsoredSessionOptions` |

### `@pepu-chain/sdk/server`

server only. Page: [session](session.md).

| Kind | Exports |
|---|---|
| Values (12) | `assertWithinPolicyNameLimit`, `buildSessionPolicy`, `withGasLimitBuffer`, `broadcastSignedTransaction`, `signAndBroadcast`, `resolveSessionMinutes`, `sessionExpiry`, `describeSessionScope`, `PRIVY_POLICY_NAME_MAX_LENGTH`, `DEFAULT_SESSION_MINUTES`, `MAX_SESSION_MINUTES`, `SESSION_TRUST_NOTICE` |
| Types (11) | `SessionPolicyCondition`, `SessionPolicyRule`, `SessionPolicy`, `BuildSessionPolicyParams`, `PrivyUnsignedTransaction`, `SignedTransactionLike`, `BroadcastClient`, `SignAndBroadcastClient`, `SignAndBroadcastParams`, `SessionScopeFunction`, `SessionScope` |

### `@pepu-chain/sdk/doctor`

node or any. Page: [doctor](doctor.md).

| Kind | Exports |
|---|---|
| Values (8) | `runDoctor`, `checkPepuEnv`, `PRIVY_APP_ID_PATTERN`, `checkChainRpc`, `checkPrivyAppIdFormat`, `checkSponsorshipEndpoints`, `TEMPLATE_REQUIREMENTS`, `generatePrivyAuthorizationKey` |
| Types (12) | `PrivyAuthorizationKeyPair`, `CheckStatus`, `DoctorCheck`, `DoctorReport`, `EnvCheckResult`, `EnvItem`, `EnvItemStatus`, `Pillar`, `PrivyDashboardChecker`, `PrivyDashboardRequirementKey`, `TemplateRequirement`, `RunDoctorOptions` |

## Related

- [SDK Overview and Reference](reference.md)
- [SDK Error Catalog](errors.md)
- [Migration Notes](migration.md)
