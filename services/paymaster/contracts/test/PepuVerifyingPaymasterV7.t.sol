// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";

import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { _parseValidationData, ValidationData } from "@account-abstraction-v7/core/Helpers.sol";

import { IAccessControl } from "@openzeppelin-v5.0.2/contracts/access/IAccessControl.sol";

import { PepuVerifyingPaymasterV7 } from "../src/PepuVerifyingPaymasterV7.sol";
import { BaseSingletonPaymaster } from "../src/base/BaseSingletonPaymaster.sol";
import { PostOpMode } from "../src/interfaces/PostOpMode.sol";

import { MockEntryPoint } from "./mocks/MockEntryPoint.sol";

/// @title PepuVerifyingPaymasterV7Test
/// @notice Covers everything the PEPU gas-sponsorship brief calls out as security-critical: the exact byte layout
/// signed/verified by `getHash`/`_getHash`, bundler allowlisting, multi-signer revocation, access control, and the
/// claim that `postOp` is unreachable in verifying mode.
///
/// Test key: Anvil/Hardhat's well-known, funds-free default account #0 private key. Safe to hardcode — this is a
/// universally-published test key, never anything from deploy/.keys.env.
contract PepuVerifyingPaymasterV7Test is Test {
    uint256 internal constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    address internal signer;
    address internal owner = makeAddr("owner");
    address internal manager = makeAddr("manager");

    PepuVerifyingPaymasterV7 internal paymaster;

    function setUp() public {
        // Realistic-ish timestamp so `validUntil = block.timestamp - 1` style expiry tests never underflow.
        vm.warp(1_700_000_000);

        signer = vm.addr(SIGNER_KEY);

        address[] memory signers = new address[](1);
        signers[0] = signer;
        paymaster = new PepuVerifyingPaymasterV7(ENTRY_POINT, owner, manager, signers);

        // BasePaymaster's deposit/withdraw/stake functions call out to the real EntryPoint contract. We don't
        // vendor EntryPoint's implementation (only its interface, for compilation), so give the real EntryPoint
        // address a minimal working stub for the tests that exercise those functions. This does not affect
        // `_requireFromEntryPoint` checks, which only compare msg.sender against this same address.
        MockEntryPoint mock = new MockEntryPoint();
        vm.etch(ENTRY_POINT, address(mock).code);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                    HELPERS
    //////////////////////////////////////////////////////////////////////////*/

    function _pack128(uint128 hi, uint128 lo) internal pure returns (bytes32) {
        return bytes32((uint256(hi) << 128) | uint256(lo));
    }

    function _baseUserOp(address sender) internal pure returns (PackedUserOperation memory userOp) {
        userOp.sender = sender;
        userOp.nonce = 0;
        userOp.initCode = bytes("");
        userOp.callData = abi.encodeWithSignature("execute(address,uint256,bytes)", address(0xBEEF), uint256(0), bytes(""));
        userOp.accountGasLimits = _pack128(100_000, 100_000); // verificationGasLimit, callGasLimit
        userOp.preVerificationGas = 50_000;
        userOp.gasFees = _pack128(1 gwei, 2 gwei); // maxPriorityFeePerGas, maxFeePerGas
        userOp.paymasterAndData = bytes("");
        userOp.signature = bytes("");
    }

    /// @dev Builds the unsigned paymasterAndData prefix (the exact 65 bytes covered by the hash): paymaster
    /// address (20) + paymasterVerificationGasLimit (16) + paymasterPostOpGasLimit (16) + mode/allowAllBundlers
    /// byte (1) + validUntil (6) + validAfter (6).
    function _prefixWithMode(
        uint8 mode,
        uint48 validUntil,
        uint48 validAfter,
        bool allowAllBundlers
    )
        internal
        view
        returns (bytes memory)
    {
        uint8 modeByte = uint8((mode << 1) | (allowAllBundlers ? 1 : 0));
        return abi.encodePacked(
            address(paymaster), uint128(3_000_000), uint128(1_000_000), modeByte, validUntil, validAfter
        );
    }

    function _prefixVerifying(
        uint48 validUntil,
        uint48 validAfter,
        bool allowAllBundlers
    )
        internal
        view
        returns (bytes memory)
    {
        return _prefixWithMode(0, validUntil, validAfter, allowAllBundlers);
    }

    /// @dev Asks the contract itself for the hash (rather than re-implementing `_getHash`'s abi.encode here),
    /// so there is zero risk of the test's notion of "the hash" drifting from the contract's.
    function _sign(uint256 privKey, PackedUserOperation memory userOp) internal view returns (bytes memory) {
        bytes32 hash = paymaster.getHash(0, userOp);
        bytes32 digest = _toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev EIP-191 personal-sign wrapper, replicated locally (rather than importing OZ's MessageHashUtils) to
    /// keep this test file's only dependency on the signature scheme being `paymaster.getHash` itself.
    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _signedUserOp(
        address sender,
        uint48 validUntil,
        uint48 validAfter,
        bool allowAllBundlers,
        uint256 privKey
    )
        internal
        view
        returns (PackedUserOperation memory userOp)
    {
        userOp = _baseUserOp(sender);
        bytes memory prefix = _prefixVerifying(validUntil, validAfter, allowAllBundlers);
        userOp.paymasterAndData = prefix; // hash covers only these 65 bytes; signature not needed yet.
        bytes memory sig = _sign(privKey, userOp);
        userOp.paymasterAndData = abi.encodePacked(prefix, sig);
    }

    function _isSigFailed(uint256 validationData) internal pure returns (bool) {
        ValidationData memory vd = _parseValidationData(validationData);
        return vd.aggregator == address(1);
    }

    /*//////////////////////////////////////////////////////////////////////////
                          VALID SIGNATURE / TIME WINDOW
    //////////////////////////////////////////////////////////////////////////*/

    function test_ValidSignature_SucceedsWithEmptyContext() public {
        address sender = makeAddr("sender");
        uint48 validUntil = uint48(block.timestamp + 1 days);
        uint48 validAfter = uint48(block.timestamp - 1);

        PackedUserOperation memory userOp = _signedUserOp(sender, validUntil, validAfter, true, SIGNER_KEY);

        vm.prank(ENTRY_POINT);
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(uint256(1)), 1 ether);

        assertEq(context.length, 0, "context must be empty in verifying mode");
        ValidationData memory vd = _parseValidationData(validationData);
        assertEq(vd.aggregator, address(0), "signature should be valid");
        assertEq(vd.validUntil, validUntil, "validUntil mismatch");
        assertEq(vd.validAfter, validAfter, "validAfter mismatch");
    }

    /// @notice Proves postOp is unreachable: verifying mode's validatePaymasterUserOp always returns a
    /// zero-length context, and per ERC-4337, EntryPoint never calls postOp when context is empty.
    function test_ValidatePaymasterUserOp_AlwaysReturnsEmptyContext() public {
        address sender = makeAddr("sender");

        // Try several different validUntil/validAfter/allowAllBundlers/signer-validity combinations — context
        // must be empty regardless of outcome (valid signature, invalid signature, or any time window).
        PackedUserOperation memory op1 =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, true, SIGNER_KEY);
        PackedUserOperation memory op2 =
            _signedUserOp(sender, uint48(block.timestamp - 1), 0, true, SIGNER_KEY); // expired
        PackedUserOperation memory op3 =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, true, 0xBAD1); // unauthorized signer

        vm.prank(ENTRY_POINT);
        (bytes memory c1,) = paymaster.validatePaymasterUserOp(op1, bytes32(0), 1 ether);
        vm.prank(ENTRY_POINT);
        (bytes memory c2,) = paymaster.validatePaymasterUserOp(op2, bytes32(0), 1 ether);
        vm.prank(ENTRY_POINT);
        (bytes memory c3,) = paymaster.validatePaymasterUserOp(op3, bytes32(0), 1 ether);

        assertEq(c1.length, 0);
        assertEq(c2.length, 0);
        assertEq(c3.length, 0);
    }

    function test_UnauthorizedSigner_SigFails() public {
        uint256 randomKey = 0xB0B5;
        address sender = makeAddr("sender");
        PackedUserOperation memory userOp =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, true, randomKey);

        vm.prank(ENTRY_POINT);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertTrue(_isSigFailed(validationData));
    }

    function test_TimeWindow_ExpiredIsEncodedNotReverted() public {
        address sender = makeAddr("sender");
        uint48 validUntil = uint48(block.timestamp - 1); // already expired
        uint48 validAfter = 0;

        PackedUserOperation memory userOp = _signedUserOp(sender, validUntil, validAfter, true, SIGNER_KEY);

        vm.prank(ENTRY_POINT);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);

        // Per ERC-4337, the contract does not revert on expiry — it encodes the window and EntryPoint enforces it.
        ValidationData memory vd = _parseValidationData(validationData);
        assertEq(vd.aggregator, address(0), "signature itself is valid");
        assertEq(vd.validUntil, validUntil);
        assertEq(vd.validAfter, validAfter);
    }

    function test_TimeWindow_NotYetValidIsEncodedNotReverted() public {
        address sender = makeAddr("sender");
        uint48 validUntil = uint48(block.timestamp + 1 days);
        uint48 validAfter = uint48(block.timestamp + 1 hours); // not yet valid

        PackedUserOperation memory userOp = _signedUserOp(sender, validUntil, validAfter, true, SIGNER_KEY);

        vm.prank(ENTRY_POINT);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);

        ValidationData memory vd = _parseValidationData(validationData);
        assertEq(vd.aggregator, address(0), "signature itself is valid");
        assertEq(vd.validUntil, validUntil);
        assertEq(vd.validAfter, validAfter);
    }

    function test_WrongChainId_SigFails() public {
        address sender = makeAddr("sender");
        uint48 validUntil = uint48(block.timestamp + 1 days);
        uint48 validAfter = 0;

        PackedUserOperation memory userOp = _baseUserOp(sender);
        bytes memory prefix = _prefixVerifying(validUntil, validAfter, true);
        userOp.paymasterAndData = prefix;

        uint256 realChainId = block.chainid;
        vm.chainId(realChainId + 424_242); // sign as if this were a different chain
        bytes memory sig = _sign(SIGNER_KEY, userOp);
        vm.chainId(realChainId); // switch back before validating, like the real chain would be

        userOp.paymasterAndData = abi.encodePacked(prefix, sig);

        vm.prank(ENTRY_POINT);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertTrue(_isSigFailed(validationData), "signature signed for the wrong chain id must fail");
    }

    function test_TamperedCallData_SigFails() public {
        address sender = makeAddr("sender");
        PackedUserOperation memory userOp =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, true, SIGNER_KEY);

        // Flip one byte of callData after the signature was computed over the original.
        userOp.callData[0] = userOp.callData[0] == bytes1(0xff) ? bytes1(0x00) : bytes1(0xff);

        vm.prank(ENTRY_POINT);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertTrue(_isSigFailed(validationData), "tampering with callData must invalidate the signature");
    }

    /*//////////////////////////////////////////////////////////////////////////
                                  MODE / ENTRYPOINT
    //////////////////////////////////////////////////////////////////////////*/

    function test_RevertWhen_ModeInvalid() public {
        address sender = makeAddr("sender");
        PackedUserOperation memory userOp = _baseUserOp(sender);
        bytes memory prefix = _prefixWithMode(1, uint48(block.timestamp + 1 days), 0, true); // mode=1 is invalid
        userOp.paymasterAndData = abi.encodePacked(prefix, new bytes(65)); // dummy sig; never reached

        vm.prank(ENTRY_POINT);
        vm.expectRevert(BaseSingletonPaymaster.PaymasterModeInvalid.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
    }

    function test_RevertWhen_ValidatePaymasterUserOp_NotCalledByEntryPoint() public {
        address sender = makeAddr("sender");
        PackedUserOperation memory userOp =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, true, SIGNER_KEY);

        vm.expectRevert(bytes("Sender not EntryPoint"));
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
    }

    function test_PostOp_RevertsIfCalledByEntryPoint() public {
        vm.prank(ENTRY_POINT);
        vm.expectRevert(bytes("not supported"));
        paymaster.postOp(PostOpMode.opSucceeded, "", 0, 0);
    }

    function test_RevertWhen_PostOp_NotCalledByEntryPoint() public {
        vm.expectRevert(bytes("Sender not EntryPoint"));
        paymaster.postOp(PostOpMode.opSucceeded, "", 0, 0);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                BUNDLER ALLOWLIST
    //////////////////////////////////////////////////////////////////////////*/

    function test_RevertWhen_BundlerNotAllowed() public {
        address sender = makeAddr("sender");
        address someBundler = makeAddr("someBundler");
        PackedUserOperation memory userOp =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, false, SIGNER_KEY);

        vm.prank(ENTRY_POINT, someBundler);
        vm.expectRevert(abi.encodeWithSelector(BaseSingletonPaymaster.BundlerNotAllowed.selector, someBundler));
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
    }

    function test_BundlerAllowed_AfterAllowlisting() public {
        address sender = makeAddr("sender");
        address someBundler = makeAddr("someBundler");
        PackedUserOperation memory userOp =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, false, SIGNER_KEY);

        address[] memory bundlers = new address[](1);
        bundlers[0] = someBundler;
        vm.prank(manager);
        paymaster.updateBundlerAllowlist(bundlers, true);

        vm.prank(ENTRY_POINT, someBundler);
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertFalse(_isSigFailed(validationData), "bundler should now be allowed");
    }

    /*//////////////////////////////////////////////////////////////////////////
                                    MULTISIGNER
    //////////////////////////////////////////////////////////////////////////*/

    function test_Manager_CanAddAndRemoveSigner() public {
        address newSigner = makeAddr("newSigner");
        assertFalse(paymaster.signers(newSigner));

        vm.prank(manager);
        paymaster.addSigner(newSigner);
        assertTrue(paymaster.signers(newSigner));

        vm.prank(manager);
        paymaster.removeSigner(newSigner);
        assertFalse(paymaster.signers(newSigner));
    }

    /// @notice Proves a compromised signer key can be revoked without a redeploy: a previously-valid signature
    /// from a removed signer must report sigFailed=true on the very next validation.
    function test_RemoveSigner_InvalidatesPreviouslyValidSignature() public {
        address sender = makeAddr("sender");
        PackedUserOperation memory userOp =
            _signedUserOp(sender, uint48(block.timestamp + 1 days), 0, true, SIGNER_KEY);

        // Sanity: signature is valid before revocation.
        vm.prank(ENTRY_POINT);
        (, uint256 beforeRevoke) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertFalse(_isSigFailed(beforeRevoke));

        vm.prank(manager);
        paymaster.removeSigner(signer);

        vm.prank(ENTRY_POINT);
        (, uint256 afterRevoke) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
        assertTrue(_isSigFailed(afterRevoke), "signature from a removed signer must fail after revocation");
    }

    /*//////////////////////////////////////////////////////////////////////////
                                  ACCESS CONTROL
    //////////////////////////////////////////////////////////////////////////*/

    function test_RevertWhen_ManagerAloneWithdraws() public {
        vm.prank(manager);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, manager, bytes32(0))
        );
        paymaster.withdrawTo(payable(manager), 0);
    }

    function test_Owner_CanWithdraw() public {
        vm.deal(address(this), 1 ether);
        paymaster.deposit{ value: 1 ether }();
        assertEq(paymaster.getDeposit(), 1 ether);

        uint256 balanceBefore = owner.balance;
        vm.prank(owner);
        paymaster.withdrawTo(payable(owner), 1 ether);

        assertEq(paymaster.getDeposit(), 0);
        assertEq(owner.balance, balanceBefore + 1 ether);
    }
}
