// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";

import { PepuSponsoredPaymasterV7 as PM } from "../src/PepuSponsoredPaymasterV7.sol";
import { SponsoredTestUtils } from "./mocks/SponsoredTestUtils.sol";

/// @notice Tests for the fixes of the internal review (services/paymaster/audits/2026-10-internal-review.md):
/// M-2 (timelocked signer/bundler additions, on-chain fee cap), L-2 (account codehash restriction), I-1/I-6/I-7.
contract PepuSponsoredPaymasterV7GovernanceTest is SponsoredTestUtils {
    address internal admin = makeAddr("admin");
    address internal manager = makeAddr("manager");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal sender = makeAddr("sender");
    address internal carol = makeAddr("carol");
    address internal rogue = makeAddr("rogue");
    address internal constant TARGET_A = address(0xA0A0);

    uint32 internal constant DELAY = 2 days;
    uint256 internal constant MAX_COST = 12 ether;
    uint256 internal constant FEE = 1 gwei;
    bytes32 internal idA;

    function setUp() public {
        vm.warp(1_700_000_000);
        _deployPaymaster(admin, manager, DELAY);
        idA = pm.projectIdOf("app-a");
        vm.deal(alice, 1_000_000 ether);
        vm.deal(bob, 1_000_000 ether);
        vm.deal(admin, 1_000_000 ether);
    }

    function _one(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function _registerA(uint256 deposit) internal {
        _register(alice, "app-a", _one(TARGET_A), 1_000 ether, 1_000 ether, deposit);
    }

    function _opWithFee(uint128 maxFee) internal returns (PackedUserOperation memory) {
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.maxFee = maxFee;
        return _buildOp(s);
    }

    /*//////////////////////////////////////////////////////////////////////////
                         TIMELOCK ON SIGNER / BUNDLER ADDITIONS (M-2a)
    //////////////////////////////////////////////////////////////////////////*/

    function test_AdminDelay_IsTheImmutableConstructorValue_AtLeast48h() public view {
        assertEq(pm.adminChangeDelay(), DELAY);
        assertGe(pm.adminChangeDelay(), 48 hours);
        assertEq(pm.MIN_ADMIN_CHANGE_DELAY(), 48 hours);
    }

    function test_Signer_AddIsTimelocked() public {
        address s2 = makeAddr("s2");
        uint48 t0 = uint48(block.timestamp);
        uint48 delay = pm.adminChangeDelay();
        vm.prank(manager);
        pm.proposeAdminChange(1, s2);
        bytes32 key = keccak256(abi.encode(uint8(1), s2));
        assertEq(pm.pendingAdminChange(key), t0 + delay);
        assertFalse(pm.signers(s2));

        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(PM.AdminChangeNotReady.selector, t0 + delay));
        pm.executeAdminChange(1, s2);

        vm.warp(block.timestamp + delay - 1);
        vm.prank(manager);
        vm.expectRevert();
        pm.executeAdminChange(1, s2);

        vm.warp(block.timestamp + 1);
        vm.prank(manager);
        pm.executeAdminChange(1, s2);
        assertTrue(pm.signers(s2));
        assertEq(pm.pendingAdminChange(key), 0);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(PM.AdminChangeNotProposed.selector));
        pm.executeAdminChange(1, s2); // a proposal is single-use
    }

    function test_Bundler_AddIsTimelocked() public {
        address b2 = makeAddr("b2");
        vm.prank(manager);
        pm.proposeAdminChange(2, b2);
        assertFalse(pm.isBundlerAllowed(b2));
        vm.prank(manager);
        vm.expectRevert();
        pm.executeAdminChange(2, b2);
        vm.warp(block.timestamp + pm.adminChangeDelay());
        vm.prank(manager);
        pm.executeAdminChange(2, b2);
        assertTrue(pm.isBundlerAllowed(b2));
    }

    function test_Timelock_OnlyOwnerOrManager_ZeroAddressAndDuplicatesRejected() public {
        vm.prank(carol);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.proposeAdminChange(1, carol);
        vm.prank(carol);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.proposeAdminChange(2, carol);
        vm.prank(carol);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.executeAdminChange(1, carol);
        vm.prank(carol);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.cancelAdminChange(1, carol);
        vm.prank(manager);
        vm.expectRevert(PM.InvalidAdminChange.selector);
        pm.proposeAdminChange(1, address(0));
        vm.startPrank(manager);
        pm.proposeAdminChange(1, carol);
        vm.expectRevert(abi.encodeWithSelector(PM.AdminChangeAlreadyProposed.selector));
        pm.proposeAdminChange(1, carol);
        vm.stopPrank();
    }

    /// @dev The owner can veto a manager's pending addition.
    function test_Owner_CanCancelManagersProposal() public {
        vm.prank(manager);
        pm.proposeAdminChange(1, rogue);
        vm.prank(manager);
        pm.proposeAdminChange(2, rogue);
        vm.startPrank(admin);
        pm.cancelAdminChange(1, rogue);
        pm.cancelAdminChange(2, rogue);
        vm.expectRevert();
        pm.cancelAdminChange(1, rogue);
        vm.stopPrank();
        vm.warp(block.timestamp + pm.adminChangeDelay());
        vm.prank(manager);
        vm.expectRevert();
        pm.executeAdminChange(1, rogue);
        vm.prank(manager);
        vm.expectRevert();
        pm.executeAdminChange(2, rogue);
    }

    /// @dev Removals stay instant and also kill any pending addition of the same address.
    function test_Removals_AreInstant_AndClearPendingAdditions() public {
        address s0 = vm.addr(SIGNER_KEY);
        vm.prank(manager);
        pm.removeSigner(s0);
        assertFalse(pm.signers(s0));

        vm.prank(manager);
        pm.proposeAdminChange(1, rogue);
        vm.prank(manager);
        pm.removeSigner(rogue);
        assertEq(pm.pendingAdminChange(keccak256(abi.encode(uint8(1), rogue))), 0);

        vm.prank(manager);
        pm.proposeAdminChange(2, rogue);
        vm.prank(manager);
        pm.removeBundlers(_one(rogue));
        assertEq(pm.pendingAdminChange(keccak256(abi.encode(uint8(2), rogue))), 0);

        vm.prank(manager);
        pm.removeBundlers(_one(bundler));
        assertFalse(pm.isBundlerAllowed(bundler));
    }

    uint256 internal constant ROGUE_KEY = 0xB0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0;

    function _rogueOp() internal returns (PackedUserOperation memory) {
        OpSpec memory sp = _spec(sender, _singleCall(TARGET_A), idA);
        sp.signerKey = ROGUE_KEY;
        return _buildOp(sp);
    }

    /// @dev M-2 end to end, deposits one-way: a rogue manager proposes itself as signer. Projects cannot exit, so the
    /// defence is PAUSE: the project owner sees the proposal, pauses within the window, and once the rogue signer is
    /// live its signature cannot spend the paused project's ledger.
    function test_RogueManager_CannotSpendProjectThatPausesAfterSeeingTheProposal() public {
        _registerA(100 ether);
        address rogueSigner = vm.addr(ROGUE_KEY);
        vm.prank(manager);
        pm.proposeAdminChange(1, rogueSigner);
        uint256 effectiveAt = block.timestamp + pm.adminChangeDelay();
        // the rogue cannot act before the delay ...
        vm.warp(effectiveAt - 1);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(PM.AdminChangeNotReady.selector, uint48(effectiveAt)));
        pm.executeAdminChange(1, rogueSigner);
        // ... the project owner pauses inside the window (and pausing is instant, with no delay of its own)
        vm.prank(alice);
        pm.setPaused(idA, true);
        vm.warp(effectiveAt);
        vm.prank(manager);
        pm.executeAdminChange(1, rogueSigner);
        assertTrue(pm.signers(rogueSigner));
        // the rogue signer is now valid, but the paused project cannot be charged
        PackedUserOperation memory op = _rogueOp();
        vm.expectRevert(abi.encodeWithSelector(PM.SponsorPaused.selector, idA));
        _run(op, MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 100 ether, "nothing was spent");
        assertEq(ep.balanceOf(address(pm)), 100 ether);
    }

    /// @dev A project that does not pause can still bound the damage inside the window by tightening its limits: the
    /// rogue signer can spend at most the (tightened) daily limit, never the whole balance, and never above the
    /// (tightened) fee cap.
    function test_RogueManager_ProjectThatTightensLimitsBoundsTheLoss() public {
        _registerA(100 ether);
        address rogueSigner = vm.addr(ROGUE_KEY);
        vm.prank(manager);
        pm.proposeAdminChange(1, rogueSigner);
        vm.startPrank(alice); // all of these are instant and need no delay
        pm.setDailyLimit(idA, 13 ether); // one 12 ether reservation fits, a second does not
        pm.setMaxFeePerGas(idA, 3 gwei);
        vm.stopPrank();
        vm.warp(block.timestamp + pm.adminChangeDelay());
        vm.prank(manager);
        pm.executeAdminChange(1, rogueSigner);

        OpSpec memory hi = _spec(sender, _singleCall(TARGET_A), idA);
        hi.signerKey = ROGUE_KEY;
        hi.maxFee = 4 gwei;
        PackedUserOperation memory tooPricey = _buildOp(hi);
        vm.expectRevert(abi.encodeWithSelector(PM.MaxFeePerGasTooHigh.selector, 4 gwei, 3 gwei));
        _run(tooPricey, MAX_COST, 3 ether, FEE, false);

        _run(_rogueOp(), MAX_COST, MAX_COST, FEE, false); // the first op can burn its full 12 ether
        PackedUserOperation memory second = _rogueOp();
        vm.expectRevert();
        _run(second, MAX_COST, MAX_COST, FEE, false); // the daily limit stops the second
        assertGe(_bal(idA), 100 ether - MAX_COST - 1 ether, "loss bounded by the tightened daily limit");
    }

    /// @dev The owner/manager cannot shorten the window: it is immutable, and there is no setter.
    function test_Timelock_CannotBeShortenedByOwnerOrManager() public {
        (bool ok,) = address(pm).call(abi.encodeWithSignature("setAdminChangeDelay(uint48)", uint48(1)));
        assertFalse(ok);
        vm.prank(admin);
        pm.proposeAdminChange(1, rogue);
        uint256 at = block.timestamp + DELAY;
        vm.warp(at - 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(PM.AdminChangeNotReady.selector, uint48(at)));
        pm.executeAdminChange(1, rogue);
    }

    /*//////////////////////////////////////////////////////////////////////////
                              ON-CHAIN FEE CAP (M-2b / L-4)
    //////////////////////////////////////////////////////////////////////////*/

    function test_FeeCap_DefaultAppliesToProjectsAndFreePool() public {
        _registerA(100 ether);
        assertEq(pm.effectiveMaxFeePerGas(idA), DEFAULT_MAX_FEE);
        assertEq(pm.effectiveMaxFeePerGas(bytes32(0)), DEFAULT_MAX_FEE);
        PackedUserOperation memory bad = _opWithFee(uint128(DEFAULT_MAX_FEE) + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.MaxFeePerGasTooHigh.selector, DEFAULT_MAX_FEE + 1, DEFAULT_MAX_FEE));
        _run(bad, MAX_COST, 3 ether, FEE, false);
        _run(_opWithFee(DEFAULT_MAX_FEE), MAX_COST, 3 ether, FEE, false);
    }

    function test_FeeCap_ProjectOwnerSetsItOwn_OthersCannot() public {
        _registerA(100 ether);
        vm.prank(bob);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setMaxFeePerGas(idA, 1 gwei);
        vm.prank(manager);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setMaxFeePerGas(idA, 1 gwei);
        vm.prank(alice);
        vm.expectRevert(PM.ZeroFeeCap.selector);
        pm.setMaxFeePerGas(idA, 0);
        vm.prank(alice);
        pm.setMaxFeePerGas(idA, 1 gwei);
        assertEq(pm.effectiveMaxFeePerGas(idA), 1 gwei);
        PackedUserOperation memory tooHigh = _opWithFee(2 gwei);
        vm.expectRevert(abi.encodeWithSelector(PM.MaxFeePerGasTooHigh.selector, 2 gwei, 1 gwei));
        _run(tooHigh, MAX_COST, 3 ether, FEE, false);
        _run(_opWithFee(1 gwei), MAX_COST, 3 ether, FEE, false);
    }

    function test_FeeCap_FreePoolCapIsOwnerOnly() public {
        vm.prank(manager);
        vm.expectRevert();
        pm.setFreeMaxFeePerGas(1 gwei);
        vm.prank(admin);
        vm.expectRevert(PM.ZeroFeeCap.selector);
        pm.setFreeMaxFeePerGas(0);
        vm.prank(admin);
        pm.setFreeMaxFeePerGas(1 gwei);
        assertEq(pm.effectiveMaxFeePerGas(bytes32(0)), 1 gwei);
        // the free pool's cap does not touch projects
        assertEq(pm.effectiveMaxFeePerGas(idA), DEFAULT_MAX_FEE);
    }

    /*//////////////////////////////////////////////////////////////////////////
                         ACCOUNT CODEHASH RESTRICTION (L-2)
    //////////////////////////////////////////////////////////////////////////*/

    function test_Codehash_AccessControl() public {
        _registerA(0);
        bytes32 h = keccak256("a");
        vm.prank(bob);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setRequiredAccountCodehash(idA, h);
        vm.prank(manager);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setRequiredAccountCodehash(idA, h);
        vm.startPrank(alice);
        pm.setRequiredAccountCodehash(idA, h);
        assertEq(pm.requiredAccountCodehash(idA), h);
        pm.setRequiredAccountCodehash(idA, bytes32(0)); // 0 turns the restriction off
        assertEq(pm.requiredAccountCodehash(idA), bytes32(0));
        vm.stopPrank();
    }

    /// @dev The free pool has no codehash restriction knob (its senders are Privy-verified off-chain); the
    /// project-only setter rejects the free pool id for everyone.
    function test_Codehash_NotSettableOnFreePool() public {
        vm.prank(admin);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setRequiredAccountCodehash(bytes32(0), keccak256("a"));
        vm.prank(manager);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setRequiredAccountCodehash(bytes32(0), keccak256("a"));
    }

    function test_AdminChange_RejectsUnknownKind() public {
        vm.prank(manager);
        vm.expectRevert(PM.InvalidAdminChange.selector);
        pm.proposeAdminChange(0, carol);
        vm.prank(manager);
        vm.expectRevert(PM.InvalidAdminChange.selector);
        pm.proposeAdminChange(3, carol);
    }

    function test_Codehash_RestrictionEnforcedInValidation() public {
        _registerA(100 ether);
        vm.etch(sender, hex"600160005260206000f3"); // some account code
        vm.prank(alice);
        pm.setRequiredAccountCodehash(idA, keccak256("not-the-sender-code"));
        PackedUserOperation memory op = _opWithFee(2 gwei);
        vm.expectRevert(abi.encodeWithSelector(PM.AccountCodehashMismatch.selector, sender, sender.codehash));
        _run(op, MAX_COST, 3 ether, FEE, false);
        vm.prank(alice);
        pm.setRequiredAccountCodehash(idA, sender.codehash);
        _run(_opWithFee(2 gwei), MAX_COST, 3 ether, FEE, false);
    }

    /*//////////////////////////////////////////////////////////////////////////
                    DAILY COUNTER TRACKS REAL SPEND ACROSS DAY BOUNDARIES (L-1)
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev Whatever mix of older and newer `validAfter` days ops carry, after each settlement the project and sender
    /// counters moved by exactly what was charged (a reservation is released from the bucket it landed in).
    function testFuzz_DayBuckets_CountersTrackChargesExactly(uint8[5] calldata dayOffsets, uint32 actualSeed) public {
        _registerA(500 ether);
        vm.warp(10 days);
        for (uint256 i = 0; i < dayOffsets.length; i++) {
            OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
            s.validAfter = uint48(block.timestamp - (uint256(dayOffsets[i]) % 3) * 1 days);
            s.validUntil = uint48(block.timestamp + 90);
            PackedUserOperation memory op = _buildOp(s);
            (,,,,, uint112 spentBefore, uint32 dayBefore) = pm.getProject(idA);
            (uint32 sDayBefore, uint112 sSpentBefore) = pm.getSenderSpend(idA, sender);
            uint128 balBefore = _bal(idA);
            uint256 actual = bound(uint256(keccak256(abi.encode(actualSeed, i))), 0.1 ether, 2 ether);
            _run(op, MAX_COST, actual, FEE, false);
            uint256 charged = balBefore - _bal(idA);
            uint32 opDay = uint32(s.validAfter / 1 days);
            (,,,,, uint112 spentAfter,) = pm.getProject(idA);
            (, uint112 sSpentAfter) = pm.getSenderSpend(idA, sender);
            assertEq(spentAfter, (opDay > dayBefore ? 0 : spentBefore) + charged, "project counter != real spend");
            assertEq(sSpentAfter, (opDay > sDayBefore ? 0 : sSpentBefore) + charged, "sender counter != real spend");
            vm.warp(block.timestamp + 1);
        }
    }

    /*//////////////////////////////////////////////////////////////////////////
                         SIGNATURE HANDLING (I-1 / I-7), STAKE (I-6)
    //////////////////////////////////////////////////////////////////////////*/

    function test_Signature_MustBeExactly65Bytes() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _opWithFee(2 gwei);
        // drop one byte: 64 bytes, the EIP-2098 form, is no longer accepted by the length check
        bytes memory pd = op.paymasterAndData;
        bytes memory short = new bytes(pd.length - 1);
        for (uint256 i = 0; i < short.length; i++) {
            short[i] = pd[i];
        }
        op.paymasterAndData = short;
        vm.prank(ENTRY_POINT, bundler);
        vm.expectRevert(PM.PaymasterSignatureLengthInvalid.selector);
        pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
    }

    function test_Signature_Malformed65Bytes_IsSigFailureNotRevert() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _opWithFee(2 gwei);
        bytes memory pd = op.paymasterAndData;
        for (uint256 i = 97; i < pd.length; i++) {
            pd[i] = 0x00; // r = s = 0, v = 0: unrecoverable
        }
        op.paymasterAndData = pd;
        vm.prank(ENTRY_POINT, bundler);
        (bytes memory ctx, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        assertEq(ctx.length, 0, "no reservation");
        assertEq(vd & 1, 1, "SIG_VALIDATION_FAILED");
        assertEq(_bal(idA), 100 ether, "no state change");
    }

    /// @dev Malleability: the high-s twin of a valid signature recovers the same signer on the EVM, but must NOT validate.
    function test_Signature_HighS_Twin_IsRejected() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _opWithFee(2 gwei);
        bytes memory pd = op.paymasterAndData;
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 s;
        assembly {
            s := mload(add(pd, add(32, 129)))
        }
        uint8 v = uint8(pd[161]);
        bytes32 highS = bytes32(n - uint256(s));
        uint8 flipped = v == 27 ? 28 : 27;
        // sanity: the original validates
        vm.prank(ENTRY_POINT, bundler);
        (bytes memory ctx,) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        assertGt(ctx.length, 0);
        assembly {
            mstore(add(pd, add(32, 129)), highS)
            mstore8(add(pd, add(32, 161)), flipped)
        }
        op.paymasterAndData = pd;
        vm.prank(ENTRY_POINT, bundler);
        (bytes memory ctx2, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(uint256(2)), MAX_COST);
        assertEq(ctx2.length, 0);
        assertEq(vd & 1, 1, "high-s twin must be a signature failure");
    }

    function test_RuntimeCodeSize_UnderEip170() public view {
        assertLe(address(pm).code.length, 24_576, "contract exceeds the EIP-170 limit");
    }

    function test_UnlockStake_OwnerOnly() public {
        vm.prank(manager);
        vm.expectRevert();
        pm.unlockStake();
        vm.prank(admin);
        pm.unlockStake();
    }
}
