// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { _packValidationData } from "@account-abstraction-v7/core/Helpers.sol";
import { UserOperationLib } from "@account-abstraction-v7/core/UserOperationLib.sol";

import { ECDSA } from "@openzeppelin-v5.0.2/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";

import { BaseSingletonPaymaster } from "./base/BaseSingletonPaymaster.sol";
import { IPaymasterV7 } from "./interfaces/IPaymasterV7.sol";
import { PostOpMode } from "./interfaces/PostOpMode.sol";

using UserOperationLib for PackedUserOperation;

/// @title PepuVerifyingPaymasterV7
/// @author Pimlico (original: https://github.com/pimlicolabs/singleton-paymaster/blob/main/src/SingletonPaymasterV7.sol)
/// @author Fork maintained for Pepe Unchained (PEPU)
/// @notice A **verifying-mode-only** ERC-4337 v0.7 paymaster. An off-chain policy service decides whether to
/// sponsor a UserOperation (per-user limits, destination allowlists, budgets — all enforced off-chain) and signs
/// its approval with a dedicated ECDSA key. This contract's only job is to check that signature on-chain and, if
/// valid, pay gas from its EntryPoint deposit. The contract itself enforces NO spending caps.
///
/// @dev WHAT WAS REMOVED FROM UPSTREAM AND WHY
/// Upstream `SingletonPaymasterV7` supports two modes: Verifying (mode 0) and ERC-20 (mode 1, where the user pays
/// gas in an ERC-20 token instead of it being sponsored). On PEPU, sponsorship is always free-to-user — there is no
/// use case for ERC-20 mode, and every line of code implementing it is unused attack surface for a fork whose
/// entire security model rests on "the contract does exactly what the audited upstream code does, verifiably."
/// This fork therefore deletes ERC-20 mode entirely: `_validateERC20Mode`, `_expectedPenaltyGasCost`, the ERC-20
/// branch of `_postOp`, the `ERC20_MODE` constant, and (in `BaseSingletonPaymaster`) the `ERC20PaymasterData` /
/// `ERC20PostOpContext` structs, `_parseErc20Config`, `_createPostOpContext`, `_parsePostOpContext`, and
/// `getCostInToken`. See `UPSTREAM.md` at the repo root of this project for the full diff and the pinned upstream
/// commit this was forked from.
///
/// `postOp` is retained only because `IPaymasterV7` requires the selector to exist, but it is dead code: verifying
/// mode's `_validateVerifyingMode` always returns an empty (`""`) context, and per ERC-4337, EntryPoint does not
/// call a paymaster's `postOp` at all when `validatePaymasterUserOp` returned a zero-length context (this exact
/// behavior is documented directly in Pimlico's own comment on `_postOp`, preserved below). It intentionally
/// reverts, so that if it is ever somehow invoked despite that, it fails loudly rather than silently no-op'ing.
///
/// @dev ============================================================================================================
/// SIGNATURE SCHEME SPEC — this is the exact contract the off-chain policy service must implement to produce valid
/// sponsorship approvals. Any deviation here breaks sponsorship silently (no compile-time signal), or in the worst
/// case creates real financial exposure. Do not change this without updating the policy service in lock-step.
///
/// The signer signs `MessageHashUtils.toEthSignedMessageHash(getHash(VERIFYING_MODE, userOp))` (EIP-191
/// personal-sign), which this contract verifies via OpenZeppelin `ECDSA.recover` (from the pinned
/// openzeppelin-contracts-v5.0.2, which enforces low-`s` and reverts rather than misrecovering on a malformed
/// signature) against the `signers` mapping (see `MultiSigner.sol`).
///
/// `getHash` / `_getHash` computes:
///   ```
///   bytes32 userOpHash = keccak256(abi.encode(
///       _userOp.getSender(), _userOp.nonce, _userOp.accountGasLimits, _userOp.preVerificationGas,
///       _userOp.gasFees, keccak256(_userOp.initCode), keccak256(_userOp.callData),
///       keccak256(_userOp.paymasterAndData[:PAYMASTER_DATA_OFFSET + paymasterDataLength])
///   ));
///   return keccak256(abi.encode(userOpHash, block.chainid));
///   ```
/// where `PAYMASTER_DATA_OFFSET = 52` (`UserOperationLib.PAYMASTER_DATA_OFFSET` for v0.7: 20-byte paymaster
/// address + 16-byte paymasterVerificationGasLimit + 16-byte paymasterPostOpGasLimit), and for verifying mode
/// `paymasterDataLength = MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH (1) + VERIFYING_PAYMASTER_DATA_LENGTH (12) = 13`, so
/// the hash covers `paymasterAndData[0:65]` — i.e. paymaster address + both gas limits + the mode/allowAllBundlers
/// byte + validUntil (6 bytes) + validAfter (6 bytes) — explicitly EXCLUDING the trailing signature bytes.
///
/// `paymasterAndData` layout for mode 0 (verifying, the only mode this fork supports):
///   - paymaster address                        (20 bytes)  [offset  0..20]
///   - paymaster verification gas limit         (16 bytes)  [offset 20..36]
///   - paymaster postOp gas limit                (16 bytes) [offset 36..52]
///   - mode and allowAllBundlers                 (1 byte)   [offset 52..53]  — lowest bit = allowAllBundlers,
///                                                                             remaining bits = mode (must be 0)
///   - validUntil                                (6 bytes)  [offset 53..59]
///   - validAfter                                (6 bytes)  [offset 59..65]
///   - signature                                 (64 or 65 bytes) [offset 65..]  — NOT covered by the hash
///
/// This byte layout, field order, and arithmetic are copied byte-for-byte from upstream and MUST NOT be changed,
/// cosmetically or otherwise — it is the exact spec the separately-built policy service reproduces to sign.
/// @dev ============================================================================================================
///
/// @dev Inherits from BaseSingletonPaymaster.
/// @custom:security-contact security@pimlico.io
contract PepuVerifyingPaymasterV7 is BaseSingletonPaymaster, IPaymasterV7 {
    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                  CONSTANTS AND IMMUTABLES                  */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    uint256 private immutable PAYMASTER_DATA_OFFSET = UserOperationLib.PAYMASTER_DATA_OFFSET;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        CONSTRUCTOR                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    constructor(
        address _entryPoint,
        address _owner,
        address _manager,
        address[] memory _signers
    )
        BaseSingletonPaymaster(_entryPoint, _owner, _manager, _signers)
    { }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*        ENTRYPOINT V0.7 ERC-4337 PAYMASTER OVERRIDES        */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IPaymasterV7
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 requiredPreFund
    )
        external
        override
        returns (bytes memory context, uint256 validationData)
    {
        _requireFromEntryPoint();
        return _validatePaymasterUserOp(userOp, userOpHash, requiredPreFund);
    }

    /// @inheritdoc IPaymasterV7
    /// @dev Unreachable in normal operation — see the contract-level NatSpec above. Retained only because
    /// IPaymasterV7 requires the selector; reverts loudly instead of silently no-op'ing if somehow invoked.
    function postOp(
        PostOpMode, /* mode */
        bytes calldata, /* context */
        uint256, /* actualGasCost */
        uint256 /* actualUserOpFeePerGas */
    )
        external
        view
        override
    {
        _requireFromEntryPoint();
        revert("not supported");
    }

    /**
     * @notice Internal helper to parse and validate the userOperation's paymasterAndData.
     * @param _userOp The userOperation.
     * @param _userOpHash The userOperation hash.
     * @return (context, validationData) The context and validation data to return to the EntryPoint.
     *
     * @dev paymasterAndData for mode 0 (verifying — the only mode this fork supports):
     * - paymaster address (20 bytes)
     * - paymaster verification gas (16 bytes)
     * - paymaster postop gas (16 bytes)
     * - mode and allowAllBundlers (1 byte) - lowest bit represents allowAllBundlers, rest of the bits represent mode
     * - validUntil (6 bytes)
     * - validAfter (6 bytes)
     * - signature (64 or 65 bytes)
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata _userOp,
        bytes32 _userOpHash,
        uint256 /* _requiredPreFund */
    )
        internal
        returns (bytes memory, uint256)
    {
        (uint8 mode, bool allowAllBundlers, bytes calldata paymasterConfig) =
            _parsePaymasterAndData(_userOp.paymasterAndData, PAYMASTER_DATA_OFFSET);

        if (!allowAllBundlers && !isBundlerAllowed[tx.origin]) {
            revert BundlerNotAllowed(tx.origin);
        }

        if (mode != VERIFYING_MODE) {
            revert PaymasterModeInvalid();
        }

        return _validateVerifyingMode(_userOp, paymasterConfig, _userOpHash);
    }

    /**
     * @notice Internal helper to validate the paymasterAndData when used in verifying mode.
     * @param _userOp The userOperation.
     * @param _paymasterConfig The encoded paymaster config taken from paymasterAndData.
     * @param _userOpHash The userOperation hash.
     * @return (context, validationData) The validation data to return to the EntryPoint.
     * @dev Always returns an empty ("") context — this is what makes `postOp` above unreachable. See
     * `test/PepuVerifyingPaymasterV7.t.sol`'s `test_PostOp_UnreachableBecauseContextIsAlwaysEmpty` for a test that
     * proves this.
     */
    function _validateVerifyingMode(
        PackedUserOperation calldata _userOp,
        bytes calldata _paymasterConfig,
        bytes32 _userOpHash
    )
        internal
        returns (bytes memory, uint256)
    {
        (uint48 validUntil, uint48 validAfter, bytes calldata signature) = _parseVerifyingConfig(_paymasterConfig);

        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(getHash(VERIFYING_MODE, _userOp));
        address recoveredSigner = ECDSA.recover(hash, signature);

        bool isSignatureValid = signers[recoveredSigner];
        uint256 validationData = _packValidationData(!isSignatureValid, validUntil, validAfter);

        emit UserOperationSponsored(_userOpHash, _userOp.getSender(), VERIFYING_MODE, address(0), 0, 0);
        return ("", validationData);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      PUBLIC HELPERS                        */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /**
     * @notice Hashes the userOperation data for the given mode. Only VERIFYING_MODE (0) is supported by this fork;
     * any other value reverts. Kept as `getHash(uint8, ...)` (rather than dropping the mode parameter) so the
     * function selector matches upstream and the off-chain policy service's call convention
     * (`getHash(VERIFYING_MODE, userOp)`) needs no adjustment.
     * @param _mode The mode to get the hash for. Must equal VERIFYING_MODE (0).
     * @param _userOp The user operation data.
     * @return bytes32 The hash that the signer should sign over (after wrapping in
     * `MessageHashUtils.toEthSignedMessageHash`).
     */
    function getHash(uint8 _mode, PackedUserOperation calldata _userOp) public view virtual returns (bytes32) {
        if (_mode != VERIFYING_MODE) {
            revert PaymasterModeInvalid();
        }
        return _getHash(_userOp, MODE_AND_ALLOW_ALL_BUNDLERS_LENGTH + VERIFYING_PAYMASTER_DATA_LENGTH);
    }

    /**
     * @notice Internal helper that hashes the user operation data.
     * @dev We hash over all fields in paymasterAndData but the paymaster signature.
     * @dev DO NOT MODIFY — see the SIGNATURE SCHEME SPEC in this contract's top-level NatSpec. This function's
     * field order, encoding, and arithmetic are copied byte-for-byte from upstream and are load-bearing for the
     * separately-built off-chain policy service, which must reproduce this exact hash to produce valid signatures.
     * @param paymasterDataLength The paymasterData length.
     * @return bytes32 The hash that the signer should sign over.
     */
    function _getHash(
        PackedUserOperation calldata _userOp,
        uint256 paymasterDataLength
    )
        internal
        view
        returns (bytes32)
    {
        bytes32 userOpHash = keccak256(
            abi.encode(
                _userOp.getSender(),
                _userOp.nonce,
                _userOp.accountGasLimits,
                _userOp.preVerificationGas,
                _userOp.gasFees,
                keccak256(_userOp.initCode),
                keccak256(_userOp.callData),
                // hashing over all paymaster fields besides signature
                keccak256(_userOp.paymasterAndData[:PAYMASTER_DATA_OFFSET + paymasterDataLength])
            )
        );

        return keccak256(abi.encode(userOpHash, block.chainid));
    }
}
