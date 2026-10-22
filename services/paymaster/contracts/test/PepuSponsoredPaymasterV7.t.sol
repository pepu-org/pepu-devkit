// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { IAccessControl } from "@openzeppelin-v5.0.2/contracts/access/IAccessControl.sol";

import { PepuSponsoredPaymasterV7 as PM } from "../src/PepuSponsoredPaymasterV7.sol";
import { SponsoredTestUtils } from "./mocks/SponsoredTestUtils.sol";
import { MockEntryPointSim } from "./mocks/MockEntryPointSim.sol";
import { PostOpMode } from "../src/interfaces/PostOpMode.sol";

/// @notice Unit + fuzz tests for the tiered-sponsorship paymaster. Money-holding contract: tests are exhaustive about
/// accounting, authorisation, delay, and failure modes. The invariant suite is in PepuSponsoredPaymasterV7.Invariant.t.sol
/// and reentrancy in PepuSponsoredPaymasterV7.Reentrancy.t.sol.
contract PepuSponsoredPaymasterV7Test is SponsoredTestUtils {
    address internal admin = makeAddr("admin");
    address internal manager = makeAddr("manager");
    address internal alice = makeAddr("alice"); // project A owner
    address internal bob = makeAddr("bob"); // project B owner
    address internal sender = makeAddr("sender"); // a smart account
    address internal carol = makeAddr("carol");
    address internal constant TARGET_A = address(0xA0A0);
    address internal constant TARGET_B = address(0xB0B0);
    address internal constant TARGET_FREE = address(0xF2EE);

    string internal constant APP_A = "cm-app-a";
    string internal constant APP_B = "cm-app-b";
    bytes32 internal idA;
    bytes32 internal idB;

    uint32 internal constant DELAY = 2 days;
    uint256 internal constant FEE = 1 gwei;
    uint256 internal constant MAX_COST = 12 ether;
    uint112 internal constant SENDER_LIMIT = 1_000 ether;
    // _buildOp: callGasLimit 100_000 + paymasterPostOpGasLimit 80_000 => EntryPoint unused-gas penalty basis
    uint256 internal constant PENALTY_BASIS = 180_000;

    function setUp() public {
        vm.warp(1_700_000_000);
        _deployPaymaster(admin, manager, DELAY);
        idA = pm.projectIdOf(APP_A);
        idB = pm.projectIdOf(APP_B);
        vm.deal(alice, 1_000_000 ether);
        vm.deal(bob, 1_000_000 ether);
        vm.deal(admin, 1_000_000 ether);
        vm.deal(carol, 1_000 ether);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                    HELPERS
    //////////////////////////////////////////////////////////////////////////*/

    function _one(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function _registerA(uint256 deposit) internal {
        _register(alice, APP_A, _one(TARGET_A), 1_000 ether, SENDER_LIMIT, deposit);
    }

    function _registerB(uint256 deposit) internal {
        _register(bob, APP_B, _one(TARGET_B), 1_000 ether, SENDER_LIMIT, deposit);
    }

    function _enableFree(uint256 fund) internal {
        vm.startPrank(admin);
        pm.setFreeTier(40 ether, 1_000 ether, true);
        pm.setFreeTargets(_one(TARGET_FREE), true);
        pm.fundFreePool{ value: fund }();
        vm.stopPrank();
    }

    function _projectOp(bytes32 id, address target) internal returns (PackedUserOperation memory) {
        return _buildOp(_spec(sender, _singleCall(target), id));
    }

    /// @dev Real EntryPoint checks the TOTAL deposit (AA31) before the paymaster runs. Unowned surplus lets tests reach
    /// the paymaster-level (per-sponsor) checks.
    function _padSurplus(uint256 amount) internal {
        vm.prank(carol);
        ep.depositTo{ value: amount }(address(pm));
    }

    function _chargeFor(uint256 actual) internal view returns (uint256) {
        return actual + (uint256(pm.postOpOverheadGas()) + PENALTY_BASIS / 10) * FEE;
    }

    /*//////////////////////////////////////////////////////////////////////////
                        CLAIMS (EIP-712 ATTESTED OWNERSHIP)
    //////////////////////////////////////////////////////////////////////////*/

    function _claim(address newOwner, string memory appId, uint256 deadline, uint256 key)
        internal
        returns (PM.Claim memory)
    {
        return _claimStruct(pm, key, appId, newOwner, deadline);
    }

    /// @dev First claim, then the owner configures the project (the claim itself sets no configuration, delta L2).
    function _firstClaim(PM.Claim memory c) internal returns (bytes32 id) {
        id = pm.claimProject(c);
        if (id == bytes32(0)) return id; // the claim was expected to revert (vm.expectRevert swallowed it)
        _finishClaim(pm, id); // a claim of a FUNDED project is pending for the admin delay (review 3, M-1)
        vm.startPrank(c.newOwner);
        pm.setTargets(id, _one(TARGET_A), true);
        pm.setDailyLimit(id, 1_000 ether);
        pm.setSenderDailyLimit(id, SENDER_LIMIT);
        vm.stopPrank();
    }

    function test_Claim_HappyPath() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.expectEmit(true, true, false, true);
        emit PM.ProjectClaimed(idA, alice, APP_A);
        bytes32 id = _firstClaim(c); // relayed by anyone (this test contract), the attestation fixes the owner
        assertEq(id, idA);
        assertEq(_owner(idA), alice);
        assertTrue(pm.isTargetAllowed(idA, TARGET_A));
        assertFalse(pm.isTargetAllowed(idA, TARGET_B));
        (,, uint112 senderLimit,, uint112 limit,,) = pm.getProject(idA);
        assertEq(limit, 1_000 ether);
        assertEq(senderLimit, SENDER_LIMIT);
        assertEq(pm.projectIdOf(APP_A), idA);
        assertEq(idA, keccak256(bytes(APP_A)), "one canonical project per Privy app id");
        assertTrue(pm.claimUsed(pm.claimDigest(APP_A, alice, c.nonce, c.deadline)));
    }

    function test_Claim_ThenDeposit_CreditsLedgerAndEntryPoint() public {
        _registerA(500 ether);
        assertEq(_bal(idA), 500 ether);
        assertEq(pm.totalLiabilities(), 500 ether);
        assertEq(ep.balanceOf(address(pm)), 500 ether);
        assertEq(address(ep).balance, 500 ether);
    }

    /// @dev No registrar, owner or manager approval anywhere: only a current signer's attestation. Stays true after
    /// the contract owner renounces.
    function test_Claim_NeedsOnlyASignerAttestation_EvenAfterOwnerRenounced() public {
        vm.prank(admin);
        pm.renounceOwnership();
        address stranger = makeAddr("stranger");
        bytes32 id = _register(stranger, "any-app", _one(TARGET_A), 1 ether, 1 ether, 0);
        assertEq(_owner(id), stranger);
    }

    function test_Claim_Replay_Reverts() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        _firstClaim(c);
        bytes32 digest = pm.claimDigest(APP_A, alice, c.nonce, c.deadline);
        vm.expectRevert(abi.encodeWithSelector(PM.ClaimAlreadyUsed.selector, digest));
        _firstClaim(c);
        // also not replayable as a RE-claim of the same project
        vm.expectRevert(abi.encodeWithSelector(PM.ClaimAlreadyUsed.selector, digest));
        pm.reclaimProject(c);
    }

    function test_Claim_AttestationIsSingleUse_EvenAfterOwnerMovedOn() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        _firstClaim(c);
        vm.prank(alice);
        pm.proposeProjectOwner(idA, bob);
        vm.prank(bob);
        pm.acceptProjectOwnership(idA);
        vm.expectRevert(abi.encodeWithSelector(PM.ClaimAlreadyUsed.selector, pm.claimDigest(APP_A, alice, c.nonce, c.deadline)));
        _firstClaim(c);
        assertEq(_owner(idA), bob);
    }

    function test_Claim_Expired_Reverts() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.ClaimExpired.selector, c.deadline));
        _firstClaim(c);
        // exactly at the deadline is still valid
        PM.Claim memory ok = _claim(alice, APP_A, block.timestamp, SIGNER_KEY);
        _firstClaim(ok);
        assertEq(_owner(idA), alice);
    }

    function test_Claim_WrongChain_Reverts() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.chainId(block.chainid + 1); // the attestation was signed for another chain
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(c);
    }

    function test_Claim_WrongPaymaster_Reverts() public {
        // an attestation for a DIFFERENT paymaster deployment (same signer, same app, same owner) is useless here
        address[] memory sigs = new address[](1);
        sigs[0] = vm.addr(SIGNER_KEY);
        PM other = new PM(ENTRY_POINT, admin, manager, sigs, sigs, 2 days, 18_000, 10 gwei);
        assertTrue(other.domainSeparator() != pm.domainSeparator());
        PM.Claim memory c = _claimStruct(other, SIGNER_KEY, APP_A, alice, block.timestamp + 1 hours);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(c);
        // and it does work on the paymaster it was meant for
        other.claimProject(c);
        assertEq(_ownerOf(other, idA), alice);
    }

    function _ownerOf(PM p, bytes32 id) internal view returns (address o) {
        (o,,,,,,) = p.getProject(id);
    }

    function test_Claim_TamperedFields_Revert() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        PM.Claim memory t = PM.Claim(c.appId, carol, c.nonce, c.deadline, c.signature); // redirect to another owner
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(t);
        t = PM.Claim(APP_B, alice, c.nonce, c.deadline, c.signature); // another app id
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(t);
        t = PM.Claim(c.appId, alice, c.nonce + 1, c.deadline, c.signature);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(t);
        t = PM.Claim(c.appId, alice, c.nonce, c.deadline - 1, c.signature);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(t);
    }

    function test_Claim_NonSignerAndRemovedSigner_AreRejected() public {
        PM.Claim memory fake = _claim(carol, APP_A, block.timestamp + 1 hours, 0xBADBAD);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(fake);

        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.prank(manager);
        pm.removeSigner(vm.addr(SIGNER_KEY)); // signer removed AFTER signing, BEFORE the claim lands
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(c);
        assertEq(_owner(idA), address(0));
    }

    function test_Claim_MalformedSignature_Reverts() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        c.signature = new bytes(64);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(c);
        c.signature = new bytes(65); // r = s = 0, v = 0: unrecoverable
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(c);
    }

    function test_Claim_AlreadyClaimed_Reverts_WithNewAttestation() public {
        _registerA(0);
        PM.Claim memory c = _claim(carol, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(PM.ProjectAlreadyClaimed.selector, idA));
        _firstClaim(c);
        assertEq(_owner(idA), alice);
    }

    function test_Claim_InputValidation() public {
        PM.Claim memory c = _claim(alice, "", block.timestamp + 1 hours, SIGNER_KEY);
        vm.expectRevert(PM.InvalidAppId.selector);
        _firstClaim(c);
        bytes memory tooLong = new bytes(129);
        for (uint256 i = 0; i < 129; i++) {
            tooLong[i] = "a";
        }
        c = _claim(alice, string(tooLong), block.timestamp + 1 hours, SIGNER_KEY);
        vm.expectRevert(PM.InvalidAppId.selector);
        _firstClaim(c);
        c = _claim(address(0), APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.expectRevert(PM.InvalidOwner.selector);
        _firstClaim(c);
        c = _claim(address(pm), APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.expectRevert(PM.InvalidOwner.selector);
        _firstClaim(c);
        // a failed claim did not burn the attestation
        c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        _firstClaim(c);
        assertEq(_owner(idA), alice);
    }

    /// @dev Anti-squatting by construction: without an attestation naming you, you cannot own anything. A squatter
    /// cannot redirect alice's attestation, forge one, or make up an app id they do not control.
    function test_Squatting_IsImpossible_WithoutAnAttestation() public {
        PM.Claim memory selfSigned = _claim(carol, APP_A, block.timestamp + 1 hours, 0xCA401);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(selfSigned);
        PM.Claim memory alices = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        PM.Claim memory redirected = PM.Claim(alices.appId, carol, alices.nonce, alices.deadline, alices.signature);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        _firstClaim(redirected);
        _firstClaim(alices);
        assertEq(_owner(idA), alice);
    }

    /// @dev Funds may arrive before anyone owns the project, but cannot be spent until it is claimed (and its
    /// allowlist and limits are set by the claim itself).
    function test_Unclaimed_ReceivesDeposits_ButCannotBeSpentUntilClaimed() public {
        vm.prank(carol);
        pm.depositFor{ value: 100 ether }(idA); // the Privy app's team has not claimed yet
        assertEq(_bal(idA), 100 ether);
        assertEq(_owner(idA), address(0), "unclaimed");

        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(abi.encodeWithSelector(PM.UnknownSponsor.selector, idA));
        _run(op, MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 100 ether);

        _firstClaim(_claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY)); // claim with allowlist TARGET_A only
        assertEq(_bal(idA), 100 ether, "the earlier deposit is in the project's ledger");
        PackedUserOperation memory bad = _projectOp(idA, TARGET_B);
        vm.expectRevert(abi.encodeWithSelector(PM.TargetNotAllowed.selector, TARGET_B));
        _run(bad, MAX_COST, 3 ether, FEE, false);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 100 ether - _chargeFor(3 ether));
    }

    /*//////////////////////////////////////////////////////////////////////////
                        RE-CLAIM (TIMELOCKED OWNER CHANGE)
    //////////////////////////////////////////////////////////////////////////*/

    function test_Reclaim_IsTimelocked_AndEmitsEvent() public {
        _registerA(10 ether);
        PM.Claim memory c = _claim(bob, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        uint48 at = uint48(block.timestamp + pm.adminChangeDelay());
        vm.expectEmit(true, true, true, true);
        emit PM.ProjectReclaimProposed(idA, alice, bob, at);
        pm.reclaimProject(c); // anyone may relay it
        assertEq(_owner(idA), alice, "no change yet: the current owner keeps control");
        (address pendingOwner, uint48 executableAt, address who) = pm.pendingReclaim(idA);
        assertEq(pendingOwner, bob);
        assertEq(executableAt, at);
        assertEq(who, vm.addr(SIGNER_KEY));

        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimNotReady.selector, at));
        pm.executeReclaim(idA);
        vm.warp(at - 1);
        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimNotReady.selector, at));
        pm.executeReclaim(idA);

        vm.warp(at);
        vm.expectEmit(true, true, true, true);
        emit PM.ProjectOwnershipTransferred(idA, alice, bob);
        pm.executeReclaim(idA);
        assertEq(_owner(idA), bob);
        assertEq(_bal(idA), 10 ether, "the ledger is untouched by an owner change");
        // old owner lost control, new owner has it; the pending entry is gone
        vm.prank(alice);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setPaused(idA, true);
        vm.prank(bob);
        pm.setPaused(idA, true);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, idA));
        pm.executeReclaim(idA);
    }

    function test_Reclaim_OnUnclaimedProject_Reverts() public {
        PM.Claim memory c = _claim(bob, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        vm.expectRevert(abi.encodeWithSelector(PM.ProjectNotClaimed.selector, idA));
        pm.reclaimProject(c);
    }

    function test_Reclaim_NeedsValidAttestation() public {
        _registerA(0);
        PM.Claim memory fake = _claim(carol, APP_A, block.timestamp + 1 hours, 0xBADBAD);
        vm.expectRevert(PM.InvalidClaimSignature.selector);
        pm.reclaimProject(fake);
        PM.Claim memory expired = _claim(carol, APP_A, block.timestamp + 1, SIGNER_KEY);
        vm.warp(block.timestamp + 2);
        vm.expectRevert(abi.encodeWithSelector(PM.ClaimExpired.selector, expired.deadline));
        pm.reclaimProject(expired);
    }

    function test_Reclaim_CurrentOwnerCanCancel() public {
        _registerA(0);
        pm.reclaimProject(_claim(bob, APP_A, block.timestamp + 1 hours, SIGNER_KEY));
        vm.prank(carol);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.cancelReclaim(idA);
        vm.expectEmit(true, false, false, false);
        emit PM.ProjectReclaimCancelled(idA);
        vm.prank(alice);
        pm.cancelReclaim(idA);
        vm.warp(block.timestamp + pm.adminChangeDelay());
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, idA));
        pm.executeReclaim(idA);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, idA));
        pm.cancelReclaim(idA);
        assertEq(_owner(idA), alice);
    }

    /// @dev Removing the attesting signer also kills the re-claims it started.
    function test_Reclaim_DiesIfAttestingSignerIsRemoved() public {
        _registerA(0);
        pm.reclaimProject(_claim(bob, APP_A, block.timestamp + 1 hours, SIGNER_KEY));
        vm.prank(manager);
        pm.removeSigner(vm.addr(SIGNER_KEY));
        vm.warp(block.timestamp + pm.adminChangeDelay());
        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimSignerRemoved.selector, vm.addr(SIGNER_KEY)));
        pm.executeReclaim(idA);
        assertEq(_owner(idA), alice);
    }

    function test_Reclaim_NewerAttestationReplacesPendingAndRestartsDelay() public {
        _registerA(0);
        pm.reclaimProject(_claim(bob, APP_A, block.timestamp + 1 hours, SIGNER_KEY));
        vm.warp(block.timestamp + pm.adminChangeDelay() - 10);
        pm.reclaimProject(_claim(carol, APP_A, block.timestamp + 1 hours, SIGNER_KEY));
        vm.warp(block.timestamp + 20);
        vm.expectRevert();
        pm.executeReclaim(idA); // the first delay has passed, but the replacement restarted it
        vm.warp(block.timestamp + pm.adminChangeDelay());
        pm.executeReclaim(idA);
        assertEq(_owner(idA), carol);
    }

    /// @dev During the window the current owner keeps full control: pausing (the exit) and tightening both work.
    function test_Reclaim_OwnerCanPauseAndTightenDuringWindow() public {
        _registerA(50 ether);
        pm.reclaimProject(_claim(bob, APP_A, block.timestamp + 1 hours, SIGNER_KEY));
        vm.startPrank(alice);
        pm.setPaused(idA, true);
        pm.setDailyLimit(idA, 1 ether);
        vm.stopPrank();
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(abi.encodeWithSelector(PM.SponsorPaused.selector, idA));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_Reclaim_ExecutionClearsPendingVoluntaryTransfer() public {
        _registerA(0);
        vm.prank(alice);
        pm.proposeProjectOwner(idA, carol);
        pm.reclaimProject(_claim(bob, APP_A, block.timestamp + 1 hours, SIGNER_KEY));
        vm.warp(block.timestamp + pm.adminChangeDelay());
        pm.executeReclaim(idA);
        vm.prank(carol);
        vm.expectRevert(PM.NotPendingProjectOwner.selector);
        pm.acceptProjectOwnership(idA);
        assertEq(_owner(idA), bob);
    }

    function test_Claim_DigestMatchesEip712Reference() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PepuSponsoredPaymaster"),
                keccak256("1"),
                block.chainid,
                address(pm)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("ProjectClaim(string appId,address newOwner,uint256 nonce,uint256 deadline)"),
                keccak256(bytes(APP_A)),
                alice,
                uint256(7),
                uint256(1_800_000_000)
            )
        );
        assertEq(pm.domainSeparator(), domain);
        assertEq(pm.claimDigest(APP_A, alice, 7, 1_800_000_000), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }

    /*//////////////////////////////////////////////////////////////////////////
                              DEPOSITS ARE ONE-WAY (NO WITHDRAWAL)
    //////////////////////////////////////////////////////////////////////////*/

    function test_Deposit_AnyoneCanTopUp_ClaimedOrNot() public {
        vm.prank(carol);
        pm.depositFor{ value: 7 ether }(idA); // not claimed yet
        assertEq(_bal(idA), 7 ether);
        _registerA(0);
        vm.prank(carol);
        pm.depositFor{ value: 3 ether }(idA);
        assertEq(_bal(idA), 10 ether);
        assertEq(pm.totalLiabilities(), 10 ether);
        assertEq(ep.balanceOf(address(pm)), 10 ether);
    }

    function test_Deposit_RevertsForZeroAmountAndFreePoolId() public {
        vm.expectRevert(PM.ZeroAmount.selector);
        pm.depositFor(idA);
        // the free pool id cannot be funded through the project path (it has its own function)
        vm.expectRevert(abi.encodeWithSelector(PM.UnknownSponsor.selector, bytes32(0)));
        pm.depositFor{ value: 1 ether }(bytes32(0));
    }

    function test_Deposit_StillWorksAfterOwnershipTransfer() public {
        _registerA(0);
        vm.prank(alice);
        pm.proposeProjectOwner(idA, bob);
        vm.prank(bob);
        pm.acceptProjectOwnership(idA);
        vm.prank(carol);
        pm.depositFor{ value: 1 ether }(idA); // the id is the Privy app id's hash: it never changes with the owner
        assertEq(_bal(idA), 1 ether);
        assertEq(_owner(idA), bob);
    }

    /// @dev Owner decision: anyone deposits, no one withdraws. None of the old withdrawal entry points exist.
    function test_NoWithdrawalEntryPointExists() public {
        _registerA(100 ether);
        bytes[5] memory calls = [
            abi.encodeWithSignature("requestWithdrawal(bytes32,uint128)", idA, uint128(1)),
            abi.encodeWithSignature("cancelWithdrawal(bytes32)", idA),
            abi.encodeWithSignature("executeWithdrawal(bytes32,address)", idA, alice),
            abi.encodeWithSignature("withdrawFreePool(address,uint256)", admin, uint256(1)),
            abi.encodeWithSignature("withdrawTo(address,uint256)", admin, uint256(1))
        ];
        address[4] memory who = [alice, admin, manager, address(pm)];
        for (uint256 i = 0; i < calls.length; i++) {
            for (uint256 j = 0; j < who.length; j++) {
                vm.prank(who[j]);
                (bool ok,) = address(pm).call(calls[i]);
                assertFalse(ok, "withdraw selector must not exist");
            }
        }
        assertEq(_bal(idA), 100 ether);
        assertEq(ep.balanceOf(address(pm)), 100 ether);
    }

    /// @dev The runtime code never contains the EntryPoint `withdrawTo(address,uint256)` selector (0x205c2878), so
    /// no code path can pull the deposit out. Only `withdrawStake` (a different EntryPoint slot) remains.
    function test_Bytecode_DoesNotReferenceEntryPointWithdrawTo() public view {
        bytes memory code = address(pm).code;
        bytes4 withdrawTo = 0x205c2878;
        bytes4 withdrawStake = 0xc23a5cea;
        bool foundTo;
        bool foundStake;
        for (uint256 i = 0; i + 4 < code.length; i++) {
            if (code[i] == 0x63) {
                // PUSH4 <selector>
                bytes4 w = bytes4(abi.encodePacked(code[i + 1], code[i + 2], code[i + 3], code[i + 4]));
                if (w == withdrawTo) foundTo = true;
                if (w == withdrawStake) foundStake = true;
            }
        }
        assertFalse(foundTo, "no EntryPoint.withdrawTo call");
        assertTrue(foundStake, "sanity: the scan does find the (stake-only) withdrawStake selector");
    }

    /// @dev Deposits, settings, pause and stake management never move ledger funds out of the EntryPoint deposit.
    function test_NoDepositOutflow_ExceptGasSettlement() public {
        _registerA(50 ether);
        vm.deal(carol, 10 ether);
        vm.expectCall(ENTRY_POINT, abi.encodePacked(bytes4(0x205c2878)), 0);
        vm.prank(carol);
        pm.fundFreePool{ value: 5 ether }();
        vm.startPrank(alice);
        pm.setPaused(idA, true);
        pm.setPaused(idA, false);
        pm.setDailyLimit(idA, 1 ether);
        vm.stopPrank();
        vm.prank(admin);
        pm.setManager(bob);
        uint256 depositBefore = ep.balanceOf(address(pm));
        vm.prank(admin);
        pm.withdrawStake(payable(admin)); // stake slot only
        assertEq(ep.balanceOf(address(pm)), depositBefore, "stake withdrawal never touches the deposit");
        assertEq(ep.balanceOf(address(pm)), 55 ether);
    }

    function test_Ownership_TwoStepTransfer() public {
        _registerA(10 ether);
        vm.prank(alice);
        pm.proposeProjectOwner(idA, bob);
        assertEq(_owner(idA), alice, "not transferred until accepted");
        vm.prank(carol);
        vm.expectRevert(PM.NotPendingProjectOwner.selector);
        pm.acceptProjectOwnership(idA);
        vm.prank(bob);
        pm.acceptProjectOwnership(idA);
        assertEq(_owner(idA), bob);
        vm.prank(alice);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setPaused(idA, true);
        vm.prank(bob);
        pm.setPaused(idA, true);
    }

    function test_OwnerSetters() public {
        _registerA(0);
        vm.startPrank(alice);
        pm.setTargets(idA, _one(TARGET_B), true);
        assertTrue(pm.isTargetAllowed(idA, TARGET_B));
        pm.setTargets(idA, _one(TARGET_A), false);
        assertFalse(pm.isTargetAllowed(idA, TARGET_A));
        pm.setDailyLimit(idA, 5 ether);
        pm.setSenderDailyLimit(idA, 2 ether);
        vm.expectRevert(PM.ZeroDailyLimit.selector);
        pm.setSenderDailyLimit(idA, 0);
        (,, uint112 sl,,,,) = pm.getProject(idA);
        assertEq(sl, 2 ether);
        vm.expectRevert(PM.ZeroDailyLimit.selector);
        pm.setDailyLimit(idA, 0);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setTargets(idA, _one(TARGET_B), true);
    }

    /*//////////////////////////////////////////////////////////////////////////
                         VALIDATION + postOp ACTUAL-COST SETTLEMENT
    //////////////////////////////////////////////////////////////////////////*/

    function test_ProjectOp_PrepaysMaxThenRefundsUnused() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        uint256 actual = 3 ether;
        uint256 charge = _chargeFor(actual);

        _run(op, MAX_COST, actual, FEE, false);

        assertEq(_bal(idA), 100 ether - charge, "project pays actual (+postOp overhead), not max");
        assertEq(_spent(idA), charge, "daily counter reflects the refund");
        assertEq(pm.totalLiabilities(), 100 ether - charge);
        // EntryPoint: deposit = 100 - finalCost; finalCost <= charge (charge covers postOp gas)
        assertEq(ep.balanceOf(address(pm)), 100 ether - ep.lastFinalCost());
        assertLe(ep.lastFinalCost(), charge, "ledger charge covers the EntryPoint final cost");
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities(), "solvent");
        assertEq(beneficiary.balance, ep.lastFinalCost());
    }

    function test_PostOpGas_FitsInsideOverhead() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        _run(op, MAX_COST, 3 ether, FEE, false);
        emit log_named_uint("measured postOp gas (incl. dispatch allowance)", ep.lastPostOpGasUsed());
        assertLt(ep.lastPostOpGasUsed(), uint256(pm.postOpOverheadGas()), "overhead must exceed real postOp gas");
        assertLt(ep.lastPostOpGasUsed(), PM_POSTOP_GAS / 2, "plenty of headroom vs the post-op gas limit");
        assertFalse(ep.lastPostOpReverted());
    }

    /// @dev Cold-storage validation gas, to size the service default pmVerificationGasLimit. Run with --isolate for
    /// cold-slot accuracy: forge test --isolate --match-test test_ValidationGas -vv
    function test_ValidationGas_Logged() public {
        _registerA(100 ether);
        address[] memory three = new address[](3);
        three[0] = TARGET_A;
        three[1] = TARGET_A;
        three[2] = TARGET_A;
        PackedUserOperation memory single = _projectOp(idA, TARGET_A);
        PackedUserOperation memory batch = _buildOp(_spec(sender, _batchCall(three), idA));
        vm.prank(ENTRY_POINT, bundler);
        uint256 g0 = gasleft();
        pm.validatePaymasterUserOp(single, bytes32(uint256(1)), MAX_COST);
        uint256 gSingle = g0 - gasleft();
        vm.prank(ENTRY_POINT, bundler);
        g0 = gasleft();
        pm.validatePaymasterUserOp(batch, bytes32(uint256(2)), MAX_COST);
        uint256 gBatch = g0 - gasleft();
        emit log_named_uint("validate gas (single call)", gSingle);
        emit log_named_uint("validate gas (batch of 3)", gBatch);
        assertLt(gSingle, PM_VERIFICATION_GAS * 6 / 10);
        assertLt(gBatch, PM_VERIFICATION_GAS * 6 / 10);
    }

    function test_Charge_IsCappedAtReserved() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        _run(op, MAX_COST, MAX_COST, FEE, false); // actual == max: charge cannot exceed what was reserved
        assertEq(_bal(idA), 100 ether - MAX_COST);
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    function test_OpReverted_IsStillCharged() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        _run(op, MAX_COST, 2 ether, FEE, true);
        assertEq(_bal(idA), 100 ether - _chargeFor(2 ether));
    }

    function test_SettlementEmitsReservedAndSettledEvents() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        bytes32 h = _hashOf(op);
        vm.expectEmit(true, true, true, true);
        emit PM.SponsorReserved(idA, h, sender, MAX_COST);
        vm.expectEmit(true, true, true, true);
        emit PM.UserOpSettled(idA, h, sender, MAX_COST, _chargeFor(4 ether));
        _run(op, MAX_COST, 4 ether, FEE, false);
    }

    function test_PerProjectAccounting_IsIsolated() public {
        _registerA(100 ether);
        _registerB(50 ether);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idB), 50 ether, "B untouched by A's usage");
        _run(_projectOp(idB, TARGET_B), MAX_COST, 5 ether, FEE, false);
        assertEq(_bal(idA), 100 ether - _chargeFor(3 ether));
        assertEq(_bal(idB), 50 ether - _chargeFor(5 ether));
        assertEq(pm.totalLiabilities(), _bal(idA) + _bal(idB));
    }

    function test_FreePool_ChargesFreePoolNotProject() public {
        _registerA(100 ether);
        _enableFree(200 ether);
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0)));
        _run(op, MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(bytes32(0)), 200 ether - _chargeFor(3 ether));
        assertEq(_bal(idA), 100 ether, "project untouched");
        assertEq(pm.totalLiabilities(), _bal(bytes32(0)) + _bal(idA));
    }

    function test_Bundle_SameSponsor_ReservesEachOpThenSettles() public {
        _registerA(30 ether);
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _projectOp(idA, TARGET_A);
        ops[1] = _projectOp(idA, TARGET_A);
        MockEntryPointSim.OpCost[] memory costs = new MockEntryPointSim.OpCost[](2);
        costs[0] = MockEntryPointSim.OpCost(MAX_COST, 3 ether, false);
        costs[1] = MockEntryPointSim.OpCost(MAX_COST, 4 ether, false);
        _runBundle(ops, costs, FEE);
        assertEq(_bal(idA), 30 ether - _chargeFor(3 ether) - _chargeFor(4 ether));
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    function test_Bundle_SecondOpCannotOvercommitTheSameBalance() public {
        _registerA(20 ether); // covers one 12-ether max, not two
        _padSurplus(100 ether);
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _projectOp(idA, TARGET_A);
        ops[1] = _projectOp(idA, TARGET_A);
        MockEntryPointSim.OpCost[] memory costs = new MockEntryPointSim.OpCost[](2);
        costs[0] = MockEntryPointSim.OpCost(MAX_COST, 3 ether, false);
        costs[1] = MockEntryPointSim.OpCost(MAX_COST, 3 ether, false);
        vm.expectRevert(abi.encodeWithSelector(PM.InsufficientSponsorBalance.selector, idA, 8 ether, MAX_COST));
        _runBundle(ops, costs, FEE);
        assertEq(_bal(idA), 20 ether, "whole bundle rolled back");
    }

    function test_InsufficientBalance_Project_Rejects() public {
        _registerA(5 ether);
        _padSurplus(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(abi.encodeWithSelector(PM.InsufficientSponsorBalance.selector, idA, 5 ether, MAX_COST));
        _run(op, MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 5 ether);
    }

    function test_InsufficientBalance_FreePool_Rejects() public {
        _enableFree(10 ether);
        _padSurplus(100 ether);
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0)));
        vm.expectRevert(abi.encodeWithSelector(PM.InsufficientSponsorBalance.selector, bytes32(0), 10 ether, MAX_COST));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_PostOpRevert_OverchargesSponsor_NeverInsolvent() public {
        _registerA(100 ether);
        ep.setPostOpGasCap(3_000); // force an out-of-gas postOp
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        _run(op, MAX_COST, 3 ether, FEE, false);
        assertTrue(ep.lastPostOpReverted());
        assertEq(_bal(idA), 100 ether - MAX_COST, "sponsor keeps the full max deduction (overcharge, never undercharge)");
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
        assertGt(pm.surplus(), 0, "EntryPoint refund of the unused part becomes chain surplus");
    }

    /*//////////////////////////////////////////////////////////////////////////
                              DAILY LIMITS (on-chain)
    //////////////////////////////////////////////////////////////////////////*/

    function test_ProjectDailyLimit_RejectsAndResetsNextDay() public {
        _register(alice, APP_A, _one(TARGET_A), 20 ether, SENDER_LIMIT, 500 ether); // limit 20
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false); // spent ~3.03
        // second reservation would push spent (3.03) + 12 over... 15 < 20 ok
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        // now spent ~6.06 + 12 = 18 ok; third
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        // spent ~9.09 + 12 = 21 > 20
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert();
        _run(op, MAX_COST, 3 ether, FEE, false);

        // next UTC day: signed validAfter moves forward, counter resets
        vm.warp(block.timestamp + 1 days);
        PackedUserOperation memory op2 = _projectOp(idA, TARGET_A);
        _run(op2, MAX_COST, 3 ether, FEE, false);
        assertLt(_spent(idA), 4 ether);
    }

    function test_DailyLimit_ReservationCountsMaxUntilRefunded() public {
        _register(alice, APP_A, _one(TARGET_A), 14 ether, SENDER_LIMIT, 500 ether);
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _projectOp(idA, TARGET_A);
        ops[1] = _projectOp(idA, TARGET_A);
        MockEntryPointSim.OpCost[] memory costs = new MockEntryPointSim.OpCost[](2);
        costs[0] = MockEntryPointSim.OpCost(MAX_COST, 1 ether, false);
        costs[1] = MockEntryPointSim.OpCost(MAX_COST, 1 ether, false);
        // both validated before either settles: 12 + 12 > 13 => the bundle fails, even though actual use is tiny
        vm.expectRevert();
        _runBundle(ops, costs, FEE);
        // singly they fit (after the first settles, only ~1 ether counts)
        _run(ops[0], MAX_COST, 1 ether, FEE, false);
        assertLt(_spent(idA), 2 ether);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 1 ether, FEE, false);
    }

    function test_StaleValidAfter_DoesNotResetCounter() public {
        _register(alice, APP_A, _one(TARGET_A), 20 ether, SENDER_LIMIT, 500 ether);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        uint112 spent1 = _spent(idA);
        // A later day bucket is stored, then an approval with an OLD validAfter must not reset or lower the counter
        vm.warp(block.timestamp + 2 days);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        uint48 oldValidAfter = uint48(block.timestamp - 2 days);
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.validAfter = oldValidAfter;
        s.validUntil = uint48(block.timestamp + 90);
        PackedUserOperation memory staleOp = _buildOp(s);
        uint112 before = _spent(idA);
        _run(staleOp, MAX_COST, 3 ether, FEE, false);
        assertGt(_spent(idA), before, "stale day keeps counting in the current bucket (stricter), no reset");
        assertGt(before, spent1 - 1, "bucket was reset exactly once, by the real day rollover");
    }

    /*//////////////////////////////////////////////////////////////////////////
                                    FREE POOL
    //////////////////////////////////////////////////////////////////////////*/

    function test_FreePool_DisabledByDefault() public {
        vm.prank(admin);
        pm.fundFreePool{ value: 100 ether }();
        vm.prank(admin);
        pm.setFreeTargets(_one(TARGET_FREE), true);
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0)));
        vm.expectRevert(PM.FreeTierDisabled.selector);
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_FreePool_MaxOpCostEnforced() public {
        _enableFree(200 ether);
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0)));
        vm.expectRevert(abi.encodeWithSelector(PM.OpCostTooHigh.selector, 41 ether, 40 ether));
        _run(op, 41 ether, 3 ether, FEE, false);
    }

    /// @dev There is NO chain-wide daily ceiling on the free pool: many distinct senders keep being sponsored far past
    /// any amount a ceiling would have allowed, limited only by the per-op cap, per-sender limit and the pool balance.
    function test_FreePool_NoChainWideDailyCeiling() public {
        _enableFree(10_000 ether);
        uint256 spentTotal;
        for (uint256 i = 0; i < 60; i++) {
            uint256 before = _bal(bytes32(0));
            _run(_buildOp(_spec(address(uint160(i + 100)), _singleCall(TARGET_FREE), bytes32(0))), MAX_COST, 11 ether, FEE, false);
            spentTotal += before - _bal(bytes32(0));
        }
        assertGt(spentTotal, 600 ether, "60 distinct users drew > 600 PEPU in one day with no ceiling");
        (,,,, uint112 ceilingField, uint112 spentToday,) = pm.getProject(bytes32(0));
        assertEq(ceilingField, 0, "no ceiling is stored for the free pool");
        assertEq(spentToday, 0, "no chain-wide daily counter is kept");
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    /// @dev Per-sender (per-user) on-chain limit on the free pool stays; it is the on-chain backstop per smart account.
    function test_FreePool_PerSenderDailyLimit_Enforced() public {
        vm.startPrank(admin);
        pm.setFreeTier(15 ether, 30 ether, true); // 30 PEPU per sender per day
        pm.setFreeTargets(_one(TARGET_FREE), true);
        pm.fundFreePool{ value: 1_000 ether }();
        vm.stopPrank();
        // each op settles at ~3.00003; the 7th would need spent(~18.0002) + 12 reserved > 30
        for (uint256 i = 0; i < 6; i++) {
            _run(_buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0))), MAX_COST, 3 ether, FEE, false);
        }
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0)));
        vm.expectRevert();
        _run(op, MAX_COST, 3 ether, FEE, false);
        // a different sender is unaffected
        _run(_buildOp(_spec(carol, _singleCall(TARGET_FREE), bytes32(0))), MAX_COST, 3 ether, FEE, false);
        // next day resets
        vm.warp(block.timestamp + 1 days);
        _run(_buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0))), MAX_COST, 3 ether, FEE, false);
        (uint32 day, uint112 spent) = pm.getSenderSpend(bytes32(0), sender);
        assertEq(day, uint32(block.timestamp / 1 days));
        assertLt(spent, 4 ether);
    }

    function test_FreePool_TargetAllowlistEnforced() public {
        _enableFree(200 ether);
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_A), bytes32(0)));
        vm.expectRevert(abi.encodeWithSelector(PM.TargetNotAllowed.selector, TARGET_A));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_FreePool_AccessControl() public {
        vm.prank(carol);
        vm.expectRevert();
        pm.setFreeTier(1 ether, 1 ether, true);
        vm.prank(carol);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.setFreeTargets(_one(TARGET_FREE), true);
        vm.prank(manager);
        pm.setFreeTargets(_one(TARGET_FREE), true); // manager may curate the list
        vm.prank(manager);
        vm.expectRevert();
        pm.setFreeTier(1 ether, 1 ether, true); // but not the free-tier parameters
    }

    function test_FreePool_PauseByManager_ReenableOnlyByOwner() public {
        _enableFree(100 ether);
        vm.prank(manager);
        pm.pauseFreePool();
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0)));
        vm.expectRevert(PM.FreeTierDisabled.selector);
        _run(op, MAX_COST, 3 ether, FEE, false);
        vm.prank(admin);
        pm.setFreeTier(40 ether, 1_000 ether, true);
        _run(_buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0))), MAX_COST, 3 ether, FEE, false);
    }

    function test_FreePool_AnyoneCanFund_NoOneCanWithdraw() public {
        vm.prank(carol);
        pm.fundFreePool{ value: 50 ether }(); // anyone may donate
        assertEq(_bal(bytes32(0)), 50 ether);
        assertEq(pm.totalLiabilities(), 50 ether);
        vm.prank(admin);
        (bool ok,) = address(pm).call(abi.encodeWithSignature("withdrawFreePool(address,uint256)", admin, 1 ether));
        assertFalse(ok, "owner cannot withdraw the free pool");
        assertEq(ep.balanceOf(address(pm)), 50 ether);
    }

    function test_FreePool_CannotBeDrainedThroughProjectFunctions() public {
        vm.startPrank(admin);
        // admin is not the free pool's "owner": owner-gated functions reject it
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setPaused(bytes32(0), true);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setTargets(bytes32(0), _one(TARGET_A), true);
        vm.stopPrank();
        vm.prank(address(pm));
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setPaused(bytes32(0), true); // projectId == FREE_POOL always rejected
    }

    /*//////////////////////////////////////////////////////////////////////////
                    SIGNER CANNOT CHARGE AN UNAUTHORISED SPONSOR
    //////////////////////////////////////////////////////////////////////////*/

    function test_Signer_CannotChargeUnregisteredProject() public {
        bytes32 ghost = keccak256("ghost-app");
        _padSurplus(100 ether);
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_A), ghost));
        vm.expectRevert(abi.encodeWithSelector(PM.UnknownSponsor.selector, ghost));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_Signer_CannotChargeProjectForTargetItDidNotAllow() public {
        _registerA(100 ether);
        _registerB(100 ether);
        // B's contract is not on A's list: a signed op that calls TARGET_B cannot be charged to A
        PackedUserOperation memory op = _buildOp(_spec(sender, _singleCall(TARGET_B), idA));
        vm.expectRevert(abi.encodeWithSelector(PM.TargetNotAllowed.selector, TARGET_B));
        _run(op, MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 100 ether);
        // and the free pool list is separate from every project list
        _enableFree(100 ether);
        PackedUserOperation memory op2 = _buildOp(_spec(sender, _singleCall(TARGET_A), bytes32(0)));
        vm.expectRevert(abi.encodeWithSelector(PM.TargetNotAllowed.selector, TARGET_A));
        _run(op2, MAX_COST, 3 ether, FEE, false);
    }

    function test_Signer_CannotChargePausedProject() public {
        _registerA(100 ether);
        vm.prank(alice);
        pm.setPaused(idA, true);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(abi.encodeWithSelector(PM.SponsorPaused.selector, idA));
        _run(op, MAX_COST, 3 ether, FEE, false);
        vm.prank(alice);
        pm.setPaused(idA, false);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
    }

    function test_SponsorIdSwappedAfterSigning_FailsSignature() public {
        _registerA(100 ether);
        _registerB(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        // attacker (user/bundler) rewrites the sponsor id bytes [65:97] to project B without re-signing
        bytes memory pmd = op.paymasterAndData;
        for (uint256 i = 0; i < 32; i++) {
            pmd[65 + i] = idB[i];
        }
        op.paymasterAndData = pmd;
        vm.prank(ENTRY_POINT, bundler);
        (bytes memory ctx, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        assertEq(ctx.length, 0, "no reservation on a bad signature");
        assertEq(uint160(vd), 1, "SIG_VALIDATION_FAILED");
        assertEq(_bal(idB), 100 ether);
        assertEq(_bal(idA), 100 ether);
    }

    function test_ModeByteAndWindowAreSigned() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        // tamper validUntil (inside the signed prefix) -> signature no longer matches
        bytes memory pmd = op.paymasterAndData;
        pmd[58] = bytes1(uint8(pmd[58]) ^ 0x01);
        op.paymasterAndData = pmd;
        vm.prank(ENTRY_POINT, bundler);
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        assertEq(uint160(vd), 1);
    }

    function test_UnauthorizedSigner_SigFails_NoStateChange() public {
        _registerA(100 ether);
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.signerKey = 0xBEEF;
        PackedUserOperation memory op = _buildOp(s);
        vm.prank(ENTRY_POINT, bundler);
        (bytes memory ctx, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        assertEq(ctx.length, 0);
        assertEq(uint160(vd), 1);
        assertEq(_bal(idA), 100 ether);
        assertEq(_spent(idA), 0);
        // through the EntryPoint the whole bundle is rejected
        vm.expectRevert(bytes("AA34 signature error"));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_RemovedSigner_ApprovalsNoLongerValid() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.prank(manager);
        pm.removeSigner(vm.addr(SIGNER_KEY));
        vm.expectRevert(bytes("AA34 signature error"));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_WrongChainId_SigFails() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.chainId(999);
        vm.prank(ENTRY_POINT, bundler);
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        assertEq(uint160(vd), 1);
    }

    function test_CallDataTampering_SigFails() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        op.callData = _singleCall(address(0xDEAD)); // swap destination after signing
        vm.prank(ENTRY_POINT, bundler);
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        assertEq(uint160(vd), 1);
    }

    function test_Batch_AllTargetsMustBeAllowed() public {
        _registerA(100 ether);
        vm.prank(alice);
        pm.setTargets(idA, _one(address(0xA1A1)), true);
        address[] memory ok = new address[](2);
        ok[0] = TARGET_A;
        ok[1] = address(0xA1A1);
        _run(_buildOp(_spec(sender, _batchCall(ok), idA)), MAX_COST, 3 ether, FEE, false);

        address[] memory bad = new address[](2);
        bad[0] = TARGET_A;
        bad[1] = TARGET_B;
        PackedUserOperation memory op = _buildOp(_spec(sender, _batchCall(bad), idA));
        vm.expectRevert(abi.encodeWithSelector(PM.TargetNotAllowed.selector, TARGET_B));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function _expectUnsupported(bytes memory callData) internal {
        PackedUserOperation memory op = _buildOp(_spec(sender, callData, idA));
        vm.expectRevert(PM.UnsupportedCallData.selector);
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_CallData_UnsupportedShapesAreRejected() public {
        _registerA(100 ether);
        _expectUnsupported(abi.encodeWithSelector(bytes4(0x12345678), bytes32(0), abi.encodePacked(TARGET_A, uint256(0))));
        // delegatecall / static modes are never sponsored
        _expectUnsupported(abi.encodeWithSelector(KERNEL_EXECUTE, bytes32(bytes1(0xff)), abi.encodePacked(TARGET_A, uint256(0))));
        _expectUnsupported(abi.encodeWithSelector(KERNEL_EXECUTE, bytes32(bytes1(0xfe)), abi.encodePacked(TARGET_A, uint256(0))));
        // unknown call type
        _expectUnsupported(abi.encodeWithSelector(KERNEL_EXECUTE, bytes32(bytes1(0x07)), abi.encodePacked(TARGET_A, uint256(0))));
        // single call too short (needs target20 + value32)
        _expectUnsupported(abi.encodeWithSelector(KERNEL_EXECUTE, bytes32(0), abi.encodePacked(TARGET_A)));
        // empty / oversized batch
        _expectUnsupported(_batchCall(new address[](0)));
        address[] memory big = new address[](17);
        for (uint256 i = 0; i < 17; i++) {
            big[i] = TARGET_A;
        }
        _expectUnsupported(_batchCall(big));
        // not a Kernel call at all / too short
        _expectUnsupported(hex"deadbeef");
    }

    function test_EmptyAllowlist_SponsorsNothing() public {
        _register(alice, APP_A, new address[](0), 1_000 ether, SENDER_LIMIT, 100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(abi.encodeWithSelector(PM.TargetNotAllowed.selector, TARGET_A));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    /*//////////////////////////////////////////////////////////////////////////
                         MODE / BUNDLER / WINDOW GATES
    //////////////////////////////////////////////////////////////////////////*/

    function test_BundlerNotAllowed_Reverts() public {
        _registerA(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        address rando = makeAddr("rando");
        vm.prank(ENTRY_POINT, rando);
        vm.expectRevert(abi.encodeWithSelector(PM.BundlerNotAllowed.selector, rando));
        pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
    }

    function test_ValidUntilZero_Rejected() public {
        _registerA(100 ether);
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.validUntil = 0;
        PackedUserOperation memory op = _buildOp(s);
        vm.expectRevert(PM.InvalidValidityWindow.selector);
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_PostOpGasLimitTooLow_Rejected() public {
        _registerA(100 ether);
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.postOpGas = 10_000;
        PackedUserOperation memory op = _buildOp(s);
        vm.expectRevert(PM.PostOpGasLimitTooLow.selector);
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    function test_LegacyModeZero_Rejected() public {
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        bytes memory pmd = op.paymasterAndData;
        pmd[52] = 0x00; // mode 0 (v1 layout)
        op.paymasterAndData = pmd;
        vm.prank(ENTRY_POINT, bundler);
        vm.expectRevert(PM.PaymasterModeInvalid.selector);
        pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        vm.expectRevert(PM.PaymasterModeInvalid.selector);
        pm.getHash(0, op);
    }

    function test_MalformedPaymasterData_Reverts() public {
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        op.paymasterAndData = hex"1234";
        vm.prank(ENTRY_POINT, bundler);
        vm.expectRevert(PM.PaymasterAndDataLengthInvalid.selector);
        pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);

        PackedUserOperation memory op2 = _projectOp(idA, TARGET_A);
        op2.paymasterAndData = abi.encodePacked(address(pm), uint128(1), uint128(1), uint8(0x02), uint48(1));
        vm.prank(ENTRY_POINT, bundler);
        vm.expectRevert(PM.PaymasterConfigLengthInvalid.selector);
        pm.validatePaymasterUserOp(op2, bytes32(uint256(1)), MAX_COST);

        PackedUserOperation memory op3 = _projectOp(idA, TARGET_A);
        op3.paymasterAndData = bytes.concat(
            abi.encodePacked(address(pm), uint128(1), uint128(1), uint8(0x02), uint48(1), uint48(1), bytes32(0)), hex"aabb"
        );
        vm.prank(ENTRY_POINT, bundler);
        vm.expectRevert(PM.PaymasterSignatureLengthInvalid.selector);
        pm.validatePaymasterUserOp(op3, bytes32(uint256(1)), MAX_COST);
    }

    function test_OnlyEntryPointMayCallValidateAndPostOp() public {
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(PM.NotEntryPoint.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 1);
        vm.expectRevert(PM.NotEntryPoint.selector);
        pm.postOp(PostOpMode.opSucceeded, "", 0, 0);
    }

    /*//////////////////////////////////////////////////////////////////////////
                    OWNERSHIP (TWO-STEP + RENOUNCE) / SURPLUS / ADMIN BOUNDARIES
    //////////////////////////////////////////////////////////////////////////*/

    function test_Owner_IsConstructorOwner() public view {
        assertEq(pm.owner(), admin);
        assertEq(pm.pendingOwner(), address(0));
        assertEq(pm.manager(), manager);
    }

    function test_Owner_TwoStepTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(admin);
        pm.transferOwnership(newOwner);
        assertEq(pm.owner(), admin, "not transferred until accepted");
        assertEq(pm.pendingOwner(), newOwner);
        // the old owner is still fully in charge meanwhile
        vm.prank(admin);
        pm.setManager(carol);
        // only the pending owner can accept
        vm.prank(carol);
        vm.expectRevert();
        pm.acceptOwnership();
        vm.prank(newOwner);
        pm.acceptOwnership();
        assertEq(pm.owner(), newOwner);
        assertEq(pm.pendingOwner(), address(0));
        // old owner lost every power, new owner has them
        vm.prank(admin);
        vm.expectRevert();
        pm.setManager(admin);
        vm.prank(admin);
        vm.expectRevert();
        pm.setFreeTier(1 ether, 1 ether, true);
        vm.prank(newOwner);
        pm.setFreeTier(1 ether, 1 ether, true);
    }

    function test_Owner_TransferOnlyByOwner_AndCanBeOverwritten() public {
        vm.prank(carol);
        vm.expectRevert();
        pm.transferOwnership(carol);
        vm.prank(manager);
        vm.expectRevert();
        pm.transferOwnership(manager);

        vm.prank(admin);
        pm.transferOwnership(alice);
        vm.prank(admin);
        pm.transferOwnership(bob); // re-point before acceptance
        vm.prank(alice);
        vm.expectRevert();
        pm.acceptOwnership();
        vm.prank(bob);
        pm.acceptOwnership();
        assertEq(pm.owner(), bob);
    }

    function test_Owner_TransferToZeroDoesNotRenounce() public {
        vm.prank(admin);
        pm.transferOwnership(address(0)); // Ownable2Step: sets pending = 0 (no real account can be address(0))
        assertEq(pm.owner(), admin);
        assertEq(pm.pendingOwner(), address(0));
    }

    function test_Renounce_OnlyOwner_ClearsPendingOwner() public {
        vm.prank(carol);
        vm.expectRevert();
        pm.renounceOwnership();
        vm.prank(manager);
        vm.expectRevert();
        pm.renounceOwnership();

        vm.prank(admin);
        pm.transferOwnership(bob);
        vm.prank(admin);
        pm.renounceOwnership();
        assertEq(pm.owner(), address(0));
        assertEq(pm.pendingOwner(), address(0), "a pending transfer cannot be accepted after renounce");
        vm.prank(bob);
        vm.expectRevert();
        pm.acceptOwnership();
    }

    /// @dev After renounce EVERY owner-only function is permanently impossible.
    function test_PostRenounce_OwnerOnlyFunctionsAreGone() public {
        _enableFree(100 ether);
        vm.prank(admin);
        pm.renounceOwnership();
        vm.startPrank(admin);
        vm.expectRevert();
        pm.setManager(admin);
        vm.expectRevert();
        pm.setFreeTier(1 ether, 1 ether, true);
        vm.expectRevert();
        pm.setPostOpOverheadGas(18_000);
        vm.expectRevert();
        pm.withdrawStake(payable(admin));
        vm.expectRevert();
        pm.transferOwnership(admin);
        vm.expectRevert();
        pm.renounceOwnership();
        // the old owner has no residual manager-level access either (it was never the manager)
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.proposeAdminChange(1, admin);
        vm.stopPrank();
        // free pool funds stay in the ledger: they can now only pay gas
        assertEq(_bal(bytes32(0)), 100 ether);
        assertEq(pm.owner(), address(0));
    }

    /// @dev What survives a renounce: the manager's operational role, every project function, the free tier running.
    function test_PostRenounce_ManagerAndProjectsKeepWorking() public {
        _enableFree(100 ether);
        _registerA(100 ether);
        vm.prank(admin);
        pm.renounceOwnership();

        // a new project can still be claimed (the attesting signer is still live at this point)
        _register(bob, "fresh", _one(TARGET_A), 1 ether, 1 ether, 0);

        // manager (fixed forever, since setManager is owner-only) can still rotate signers, bundlers, free targets
        address newSigner = makeAddr("newSigner");
        vm.startPrank(manager);
        address b2 = makeAddr("b2");
        pm.proposeAdminChange(1, newSigner);
        pm.proposeAdminChange(2, b2);
        vm.warp(block.timestamp + pm.adminChangeDelay());
        pm.executeAdminChange(1, newSigner);
        pm.executeAdminChange(2, b2);
        assertTrue(pm.signers(newSigner));
        assertTrue(pm.isBundlerAllowed(b2));
        pm.removeSigner(vm.addr(SIGNER_KEY));
        pm.setFreeTargets(_one(address(0xFEED)), true);
        pm.pauseFreePool();
        vm.stopPrank();
        assertFalse(pm.freeEnabled());
        // ... but cannot re-enable the free tier (owner only): pause is one-way after renounce
        vm.prank(manager);
        vm.expectRevert();
        pm.setFreeTier(40 ether, 100 ether, true);

        // projects never needed the owner: deposit, settings, pause
        vm.prank(carol);
        pm.depositFor{ value: 1 ether }(idA);
        vm.startPrank(alice);
        pm.setTargets(idA, _one(TARGET_B), true);
        pm.setDailyLimit(idA, 10 ether);
        pm.setSenderDailyLimit(idA, 5 ether);
        pm.setPaused(idA, true);
        vm.stopPrank();
        assertEq(_bal(idA), 101 ether);
    }

    function test_PostRenounce_SponsorshipStillSettlesAndRefunds() public {
        _registerA(100 ether);
        vm.prank(admin);
        pm.renounceOwnership();
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 100 ether - _chargeFor(3 ether));
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    /// @dev Recommended hard-freeze sequence: setManager(0) then renounce => no privileged account remains at all.
    function test_FullFreeze_ManagerClearedThenRenounced() public {
        vm.startPrank(admin);
        pm.setManager(address(0));
        pm.renounceOwnership();
        vm.stopPrank();
        vm.prank(manager);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.proposeAdminChange(1, manager);
        vm.prank(address(0));
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.proposeAdminChange(1, manager); // address(0) is never treated as "the manager"
        vm.prank(admin);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.pauseFreePool();
    }

    function test_ManagerBoundaries() public {
        vm.startPrank(manager);
        vm.expectRevert();
        pm.setManager(manager);
        vm.expectRevert();
        pm.setFreeTier(1 ether, 1 ether, true);
        vm.expectRevert();
        pm.setPostOpOverheadGas(18_000);
        vm.expectRevert();
        pm.withdrawStake(payable(manager));
        vm.stopPrank();
        vm.prank(carol);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.proposeAdminChange(1, carol);
        vm.prank(carol);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.pauseFreePool();
    }

    function test_SetManager_OnlyOwner() public {
        vm.prank(admin);
        pm.setManager(carol);
        assertEq(pm.manager(), carol);
        vm.prank(manager);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.proposeAdminChange(1, manager); // the old manager lost its role
        vm.prank(carol);
        pm.proposeAdminChange(1, carol);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                    SURPLUS
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev There is no function that sends surplus to the owner (or anyone chosen by the caller).
    function test_NoSweepFunctionExists() public {
        (bool ok,) = address(pm).call(abi.encodeWithSignature("sweepSurplus(address,uint256)", admin, 1));
        assertFalse(ok);
        (ok,) = address(pm).call(abi.encodeWithSignature("sweepSurplus(address,uint256)", carol, 0));
        assertFalse(ok);
        (ok,) = address(pm).call(abi.encodeWithSignature("releaseEmptyProject(bytes32)", idA));
        assertFalse(ok);
    }

    function test_CreditSurplus_GoesOnlyToFreePool_NotToOwner() public {
        _registerA(100 ether);
        _enableFree(50 ether);
        assertEq(pm.surplus(), 0);
        vm.expectRevert(PM.NothingToCredit.selector);
        pm.creditSurplusToFreePool();

        // third party sends money straight to the EntryPoint deposit: unattributable surplus
        vm.prank(carol);
        ep.depositTo{ value: 10 ether }(address(pm));
        assertEq(pm.surplus(), 10 ether);

        uint256 ownerBefore = admin.balance;
        uint256 callerBefore = bob.balance;
        vm.expectEmit(false, false, false, true);
        emit PM.SurplusCreditedToFreePool(10 ether - pm.SURPLUS_RESERVE());
        vm.prank(bob); // permissionless
        uint256 credited = pm.creditSurplusToFreePool();
        assertEq(credited, 10 ether - pm.SURPLUS_RESERVE());
        assertEq(_bal(bytes32(0)), 50 ether + credited, "free pool received it");
        assertEq(_bal(idA), 100 ether, "projects untouched");
        assertEq(admin.balance, ownerBefore, "owner received nothing");
        assertEq(bob.balance, callerBefore, "caller received nothing");
        assertEq(pm.surplus(), pm.SURPLUS_RESERVE(), "only the solvency buffer remains");
        assertEq(pm.totalLiabilities(), 150 ether + credited);
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
        vm.expectRevert(PM.NothingToCredit.selector);
        pm.creditSurplusToFreePool();
    }

    /// @dev The postOp overhead residue (charge above the EntryPoint's true cost) is the only organic surplus. It is
    /// credited to the free pool, never to the owner.
    function test_OverheadResidue_AccruesAndRoutesToFreePool() public {
        _registerA(2_000 ether);
        _enableFree(10 ether);
        uint256 ownerBefore = admin.balance;
        uint256 fee = 1_000 gwei; // inflate gas price so the residue is visible
        uint256 residueAccrued;
        for (uint256 i = 0; i < 40; i++) {
            _run(_projectOp(idA, TARGET_A), 12 ether, 3 ether, fee, false);
            residueAccrued = pm.surplus();
        }
        assertGt(residueAccrued, 0, "charge exceeds EntryPoint's true cost: residue exists");
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities(), "never insolvent");
        if (residueAccrued > pm.SURPLUS_RESERVE()) {
            uint256 freeBefore = _bal(bytes32(0));
            uint256 credited = pm.creditSurplusToFreePool();
            assertEq(_bal(bytes32(0)), freeBefore + credited);
        }
        assertEq(admin.balance, ownerBefore, "owner untouched");
    }

    function test_PostOpOverhead_OwnerCanOnlyLower() public {
        uint32 lo = pm.MIN_POSTOP_OVERHEAD_GAS();
        uint32 hi = pm.maxPostOpOverheadGas();
        assertEq(hi, POSTOP_OVERHEAD, "ceiling is the deployed value (immutable)");
        assertEq(pm.postOpOverheadGas(), hi);
        vm.startPrank(admin);
        vm.expectRevert(PM.OverheadOutOfBounds.selector);
        pm.setPostOpOverheadGas(lo - 1);
        vm.expectRevert(PM.OverheadOutOfBounds.selector);
        pm.setPostOpOverheadGas(hi + 1);
        pm.setPostOpOverheadGas(lo);
        assertEq(pm.postOpOverheadGas(), lo);
        pm.setPostOpOverheadGas(hi); // may restore up to the ceiling, never above
        vm.expectRevert(PM.OverheadOutOfBounds.selector);
        pm.setPostOpOverheadGas(hi + 1);
        vm.stopPrank();
        vm.prank(manager);
        vm.expectRevert();
        pm.setPostOpOverheadGas(lo);
    }

    function test_Constructor_Guards() public {
        address[] memory sigs = new address[](0);
        vm.expectRevert(PM.DelayTooShort.selector);
        new PM(ENTRY_POINT, admin, manager, sigs, sigs, 48 hours - 1, 18_000, 10 gwei);
        vm.expectRevert(PM.DelayTooShort.selector);
        new PM(ENTRY_POINT, admin, manager, sigs, sigs, 1 days, 18_000, 10 gwei);
        vm.expectRevert(PM.OverheadOutOfBounds.selector);
        new PM(ENTRY_POINT, admin, manager, sigs, sigs, 2 days, 17_999, 10 gwei);
        vm.expectRevert(PM.OverheadOutOfBounds.selector);
        new PM(ENTRY_POINT, admin, manager, sigs, sigs, 2 days, 30_001, 10 gwei);
        vm.expectRevert(PM.ZeroFeeCap.selector);
        new PM(ENTRY_POINT, admin, manager, sigs, sigs, 2 days, 18_000, 0);
        vm.expectRevert(); // OwnableInvalidOwner(address(0)): the owner can never be zero at deploy
        new PM(ENTRY_POINT, address(0), manager, sigs, sigs, 2 days, 18_000, 10 gwei);
        // the timelock is exactly the constructor value, with a 48h floor
        PM ok = new PM(ENTRY_POINT, admin, manager, sigs, sigs, 3 days, 18_000, 10 gwei);
        assertEq(ok.adminChangeDelay(), 3 days);
        assertEq(ok.MIN_ADMIN_CHANGE_DELAY(), 48 hours);
        assertEq(ok.defaultMaxFeePerGas(), 10 gwei);
    }

    function test_PlainEtherIsRejected() public {
        (bool ok,) = address(pm).call{ value: 1 ether }("");
        assertFalse(ok, "no receive(): stray ETH cannot become untracked");
    }

    /// @dev No owner function can reduce a project's ledger balance.
    function test_OwnerCannotTouchProjectBalance_Fuzz(uint96 deposit, uint96 amount) public {
        deposit = uint96(bound(deposit, 1 ether, 1_000_000 ether));
        _registerA(deposit);
        amount = uint96(bound(amount, 1, type(uint96).max));
        vm.startPrank(admin);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setPaused(bytes32(0), true);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setDailyLimit(idA, uint112(amount));
        vm.stopPrank();
        assertEq(_bal(idA), deposit);
        assertEq(ep.balanceOf(address(pm)), deposit);
    }
    /*//////////////////////////////////////////////////////////////////////////
              PER-SENDER LIMIT (projects may sponsor ANY wallet, but a stranger cannot drain)
    //////////////////////////////////////////////////////////////////////////*/

    function test_ProjectSponsorsAnyWalletWithNoIdentity_WithinLimits() public {
        _registerA(100 ether);
        // an arbitrary, never-seen EOA-backed smart account: no Privy anything on-chain, the project simply pays
        address stranger = makeAddr("never-seen-wallet");
        _run(_buildOp(_spec(stranger, _singleCall(TARGET_A), idA)), MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 100 ether - _chargeFor(3 ether));
    }

    function test_ProjectSenderDailyLimit_StrangerCannotDrainBudget() public {
        _register(alice, APP_A, _one(TARGET_A), 1_000 ether, 20 ether, 500 ether); // 20 PEPU per sender/day
        // per-sender spent ~3.00003 after each op; 3rd op would need 6.0+12 = 18 ok; the 4th needs ~9+12 = 21 > 20
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert();
        _run(op, MAX_COST, 3 ether, FEE, false);
        // a different wallet is not blocked by it (each sender has its own budget) and project budget is intact
        address other = makeAddr("other-wallet");
        _run(_buildOp(_spec(other, _singleCall(TARGET_A), idA)), MAX_COST, 3 ether, FEE, false);
        (uint32 day, uint112 spent) = pm.getSenderSpend(idA, sender);
        assertEq(day, uint32(block.timestamp / 1 days));
        assertApproxEqAbs(spent, 9 ether, 0.01 ether, "refund of unused reservation reduces the sender counter");
        // next day: the per-sender counter resets
        vm.warp(block.timestamp + 1 days);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
    }

    function test_SenderLimit_ErrorIsSpecific() public {
        _register(alice, APP_A, _one(TARGET_A), 1_000 ether, 5 ether, 500 ether);
        _padSurplus(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(abi.encodeWithSelector(PM.SenderDailyLimitExceeded.selector, idA, sender));
        _run(op, MAX_COST, 3 ether, FEE, false);
    }

    /// @dev Review 3, L-1 (audit A2 + C4): a PROJECT whose owner never called setSenderDailyLimit used to have NO
    /// per-wallet bound (0 = off), contradicting spec 7a. It now fails closed, whatever the signer approves.
    function test_L1_Project_WithoutSenderLimit_FailsClosed() public {
        PM.Claim memory c = _claim(alice, APP_A, block.timestamp + 1 hours, SIGNER_KEY);
        pm.claimProject(c);
        vm.startPrank(alice);
        pm.setTargets(idA, _one(TARGET_A), true);
        pm.setDailyLimit(idA, 1_000 ether);
        pm.depositFor{ value: 500 ether }(idA);
        vm.stopPrank();
        (,, uint112 senderLimit,,,,) = pm.getProject(idA);
        assertEq(senderLimit, 0);
        _padSurplus(100 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        vm.expectRevert(PM.ZeroDailyLimit.selector);
        _run(op, MAX_COST, 3 ether, FEE, false);
        assertEq(_bal(idA), 500 ether, "nothing reserved");
        // setting the limit opens the project
        vm.prank(alice);
        pm.setSenderDailyLimit(idA, SENDER_LIMIT);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 3 ether, FEE, false);
        assertLt(_bal(idA), 500 ether);
    }

    /// @dev Review 3, L-6: postOp charges the postOp allowance SNAPSHOTTED at validation. Lowering
    /// `postOpOverheadGas` between validation and postOp does not change what an in-flight op is charged.
    function test_L6_PostOp_UsesTheValidationTimeSnapshotOfTheOverhead() public {
        _registerA(500 ether);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        uint256 snapshotOverhead = pm.postOpOverheadGas(); // 20_000 (the deployed value)
        vm.prank(ENTRY_POINT, bundler);
        (bytes memory ctx,) = pm.validatePaymasterUserOp(op, bytes32(uint256(1)), MAX_COST);
        vm.prank(admin);
        pm.setPostOpOverheadGas(18_000); // owner lowers it while the op is in flight
        uint256 balBefore = _bal(idA);
        vm.recordLogs();
        vm.prank(ENTRY_POINT);
        pm.postOp(PostOpMode.opSucceeded, ctx, 3 ether, FEE);
        uint256 charged = MAX_COST - (_bal(idA) - balBefore);
        assertEq(charged, 3 ether + (snapshotOverhead + PENALTY_BASIS / 10) * FEE, "charged with the snapshot, not the new value");
    }

    /// @dev Review 3, L-6: the sender counter is released based on the validation-time "tracked" marker even for
    /// validAfter == 0 (day index 0), where a plain `senderDay != 0` marker would have skipped the refund.
    function test_L6_PostOp_ReleasesSenderCounter_EvenForDayZero() public {
        _registerA(500 ether);
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.validAfter = 0;
        PackedUserOperation memory op = _buildOp(s);
        _padSurplus(100 ether);
        _run(op, MAX_COST, 3 ether, FEE, false);
        (uint32 day, uint112 spent) = pm.getSenderSpend(idA, sender);
        assertEq(day, 0);
        assertEq(uint256(spent), _chargeFor(3 ether), "the refund was released from the day-0 sender bucket");
    }

    function test_FreePool_SenderLimitZero_MeansNoOnChainSenderLimit() public {
        vm.startPrank(admin);
        pm.setFreeTier(40 ether, 0, true);
        pm.setFreeTargets(_one(TARGET_FREE), true);
        pm.fundFreePool{ value: 1_000 ether }();
        vm.stopPrank();
        for (uint256 i = 0; i < 10; i++) {
            _run(_buildOp(_spec(sender, _singleCall(TARGET_FREE), bytes32(0))), MAX_COST, 3 ether, FEE, false);
        }
        (, uint112 spent) = pm.getSenderSpend(bytes32(0), sender);
        assertEq(spent, 0, "no tracking when the limit is off");
    }

    /*//////////////////////////////////////////////////////////////////////////
                SURPLUS-TO-PAYER: every unused prepay returns to the exact sponsor
    //////////////////////////////////////////////////////////////////////////*/

    function test_Bundle_TwoSponsors_EachRefundedToItself() public {
        _registerA(50 ether);
        _registerB(60 ether);
        _enableFree(70 ether);
        PackedUserOperation[] memory ops = new PackedUserOperation[](3);
        ops[0] = _projectOp(idA, TARGET_A);
        ops[1] = _buildOp(_spec(carol, _singleCall(TARGET_B), idB));
        ops[2] = _buildOp(_spec(bob, _singleCall(TARGET_FREE), bytes32(0)));
        MockEntryPointSim.OpCost[] memory costs = new MockEntryPointSim.OpCost[](3);
        costs[0] = MockEntryPointSim.OpCost(MAX_COST, 2 ether, false);
        costs[1] = MockEntryPointSim.OpCost(MAX_COST, 4 ether, true);
        costs[2] = MockEntryPointSim.OpCost(MAX_COST, 1 ether, false);
        _runBundle(ops, costs, FEE);
        assertEq(_bal(idA), 50 ether - _chargeFor(2 ether), "A refunded to A");
        assertEq(_bal(idB), 60 ether - _chargeFor(4 ether), "B refunded to B (op reverted: still only actual)");
        assertEq(_bal(bytes32(0)), 70 ether - _chargeFor(1 ether), "free pool refunded to the free pool");
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    function test_Refund_HappensInPostOp_ForOpRevertedMode() public {
        _registerA(100 ether);
        _run(_projectOp(idA, TARGET_A), MAX_COST, 1 ether, FEE, true);
        assertGt(_bal(idA), 100 ether - MAX_COST, "unused part of the prepay was refunded in postOp");
        assertEq(_bal(idA), 100 ether - _chargeFor(1 ether));
    }

    /// @dev EntryPoint v0.7 charges 10% of UNUSED execution gas AFTER postOp. The charge includes its worst case, so a
    /// huge unused callGasLimit can never leave the deposit short (this was a solvency hole before the fix).
    function testFuzz_UnusedGasPenalty_NeverMakesDepositShort(uint32 callGasRaw, uint64 actualRaw, uint32 feeRaw) public {
        _registerA(100_000 ether);
        uint256 fee = bound(feeRaw, 1, 20_000 gwei);
        uint256 callGas = bound(callGasRaw, 1, 5_000_000);
        uint256 maxCost = 40 ether;
        uint256 actual = bound(actualRaw, 0, maxCost / 2);
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.callGas = uint128(callGas);
        PackedUserOperation memory op = _buildOp(s);
        uint256 balBefore = _bal(idA);
        _run(op, maxCost, actual, fee, false);
        uint256 charged = balBefore - _bal(idA);
        assertGe(charged, ep.lastFinalCost(), "charge covers EntryPoint final cost incl. unused-gas penalty");
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities(), "solvent");
    }

    function test_UnusedGasPenalty_IsCoveredAndWasUncoveredBefore() public {
        _registerA(1_000 ether);
        uint256 fee = 10_000 gwei;
        OpSpec memory s = _spec(sender, _singleCall(TARGET_A), idA);
        s.callGas = 2_000_000; // wildly over-provisioned call gas
        PackedUserOperation memory op = _buildOp(s);
        uint256 balBefore = _bal(idA);
        _run(op, 40 ether, 5 ether, fee, false);
        uint256 charged = balBefore - _bal(idA);
        uint256 penaltyGas = (2_000_000 + PM_POSTOP_GAS - ep.lastPostOpGasUsed()) / 10;
        // without charging the penalty, charge would be actual + overhead*fee, which is below final cost
        uint256 naive = 5 ether + uint256(pm.postOpOverheadGas()) * fee;
        assertLt(naive, ep.lastFinalCost(), "naive charge would have been short");
        assertGe(charged, ep.lastFinalCost());
        assertGt(penaltyGas * fee, 0);
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    /*//////////////////////////////////////////////////////////////////////////
                                    FUZZ
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev For any actual cost and fee, the ledger charge covers the EntryPoint's final charge (solvency)
    /// and never exceeds the reservation.
    function testFuzz_SettlementIsSolventAndBounded(uint64 actualRaw, uint32 feeRaw, bool reverted) public {
        _registerA(10_000 ether);
        uint256 fee = bound(feeRaw, 1, 20_000 gwei);
        uint256 maxCost = 12 ether;
        uint256 actual = bound(actualRaw, 0, maxCost);
        uint256 balBefore = _bal(idA);
        PackedUserOperation memory op = _projectOp(idA, TARGET_A);
        _run(op, maxCost, actual, fee, reverted);
        uint256 charged = balBefore - _bal(idA);
        assertLe(charged, maxCost, "never charges more than reserved");
        assertGe(charged, actual > maxCost ? maxCost : actual, "at least actual cost");
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities(), "solvent");
        assertGe(charged, ep.lastFinalCost(), "charge covers EntryPoint final cost");
    }

}

contract RejectsEther {
    receive() external payable {
        revert("no");
    }
}
