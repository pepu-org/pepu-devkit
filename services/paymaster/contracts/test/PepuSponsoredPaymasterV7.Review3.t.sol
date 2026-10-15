// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ClaimTestHelper } from "./mocks/ClaimTestHelper.sol";
import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { IStakeManager } from "@account-abstraction-v7/interfaces/IStakeManager.sol";
import { EntryPoint } from "@account-abstraction-v7/core/EntryPoint.sol";
import { Ownable } from "@openzeppelin-v5.0.2/contracts/access/Ownable.sol";
import { PepuSponsoredPaymasterV7 as PM } from "../src/PepuSponsoredPaymasterV7.sol";
import { RealEpAccount, RealEpGasBurner } from "./PepuSponsoredPaymasterV7.RealEntryPoint.t.sol";

/// @notice Regression tests for internal review #3 (services/paymaster/audits/2026-10-review-3.md). The auditors' PoCs
/// (audit B: access control and governance) live here, adapted so that the ATTACK NOW FAILS. Real vendored EntryPoint
/// v0.7. Finding ids: M-1 (funded unclaimed project has no pause defence), M-2 (owner can veto recovery forever),
/// L-2 (manager addStake), L-3 (zero bundler), B5 (expiries, nominee unset), A7 (free tier validation).
contract PepuSponsoredPaymasterV7Review3Test is Test, ClaimTestHelper {
    uint256 internal constant HONEST_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ROGUE_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint128 internal constant PM_VER = 200_000;
    uint128 internal constant PM_POST = 40_000;
    uint128 internal constant VER_GAS = 150_000;
    uint128 internal constant PVG = 50_000;
    uint128 internal constant CALL_GAS = 100_000;
    uint32 internal constant DELAY = 2 days;

    EntryPoint internal ep;
    PM internal pm;
    RealEpAccount internal acct;
    RealEpGasBurner internal app;

    address internal owner = makeAddr("owner");
    address internal manager = makeAddr("manager");
    address internal honestBundler = makeAddr("honestBundler");
    address internal victim = makeAddr("victim");
    address internal teamN = makeAddr("teamN"); // legit team, re-claiming
    address internal attackerE = makeAddr("attackerE"); // current (hostile) owner of a project
    address internal rogueBundler = makeAddr("rogueBundler");
    address payable internal rogueBeneficiary = payable(makeAddr("rogueBeneficiary"));

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.fee(1 gwei);
        ep = new EntryPoint();
        address[] memory sigs = new address[](2);
        sigs[0] = vm.addr(HONEST_KEY);
        sigs[1] = vm.addr(ROGUE_KEY); // models "the signer key leaked at some point" (initial signers are immediate)
        address[] memory bundlers = new address[](1);
        bundlers[0] = honestBundler;
        pm = new PM(address(ep), owner, manager, sigs, bundlers, DELAY, 20_000, 40_000 gwei);
        app = new RealEpGasBurner();
        acct = new RealEpAccount{ value: 10 ether }(address(ep));
        vm.deal(victim, 1_000_000 ether);
        vm.deal(owner, 1_000 ether);
        vm.deal(manager, 1_000 ether);
    }

    function _attest(uint256 key, string memory appId, address newOwner) internal returns (PM.Claim memory) {
        return _claimStruct(pm, key, appId, newOwner, block.timestamp + 1 hours);
    }

    function _ownerOf(bytes32 id) internal view returns (address o) {
        (o,,,,,,) = pm.getProject(id);
    }

    function _bal(bytes32 id) internal view returns (uint128 b) {
        (,,, b,,,) = pm.getProject(id);
    }

    function _pending(bytes32 id) internal view returns (address n) {
        (n,,) = pm.pendingReclaim(id);
    }

    /*//////////////////////////////////////////////////////////////////////////
       M-1  the FIRST claim of a funded project is pending, signer-bound and cancellable
    //////////////////////////////////////////////////////////////////////////*/

    function test_M1_FirstClaim_OfEmptyProject_IsImmediate() public {
        bytes32 id = pm.projectIdOf("empty-app");
        vm.expectEmit(true, true, false, true);
        emit PM.ProjectClaimed(id, teamN, "empty-app");
        pm.claimProject(_attest(HONEST_KEY, "empty-app", teamN));
        assertEq(_ownerOf(id), teamN);
        assertEq(_pending(id), address(0));
    }

    function test_M1_FirstClaim_OfFundedProject_IsPending_ThenExecutes() public {
        bytes32 id = pm.projectIdOf("funded-app");
        vm.prank(victim);
        pm.depositFor{ value: 1 wei }(id); // even dust makes the first claim pending
        uint48 at = uint48(block.timestamp + DELAY);
        vm.expectEmit(true, true, false, true);
        emit PM.ProjectClaimProposed(id, teamN, at, "funded-app");
        pm.claimProject(_attest(HONEST_KEY, "funded-app", teamN));
        assertEq(_ownerOf(id), address(0), "no owner yet");
        (address n, uint48 execAt, address signer) = pm.pendingReclaim(id);
        assertEq(n, teamN);
        assertEq(execAt, at);
        assertEq(signer, vm.addr(HONEST_KEY));

        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimNotReady.selector, at));
        pm.executeReclaim(id);
        vm.warp(at);
        vm.expectEmit(true, true, true, true);
        emit PM.ProjectOwnershipTransferred(id, address(0), teamN);
        pm.executeReclaim(id); // anyone
        assertEq(_ownerOf(id), teamN);
        assertEq(_pending(id), address(0));
    }

    function test_M1_PendingFirstClaim_DiesWhenItsSignerIsRemoved_AndDoesNotRevive() public {
        bytes32 id = pm.projectIdOf("funded-app");
        vm.prank(victim);
        pm.depositFor{ value: 1 ether }(id);
        pm.claimProject(_attest(ROGUE_KEY, "funded-app", attackerE));
        vm.prank(manager);
        pm.removeSigner(vm.addr(ROGUE_KEY)); // the documented instant response
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimSignerRemoved.selector, vm.addr(ROGUE_KEY)));
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), address(0));
    }

    function test_M1_PendingFirstClaim_CancellableByOwnerOrManager_NotByStrangers() public {
        bytes32 id = pm.projectIdOf("funded-app");
        vm.prank(victim);
        pm.depositFor{ value: 1 ether }(id);
        pm.claimProject(_attest(ROGUE_KEY, "funded-app", attackerE));

        vm.prank(attackerE); // not (yet) an owner of anything
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.cancelReclaim(id);
        vm.prank(victim);
        vm.expectRevert(PM.NotOwnerOrManager.selector);
        pm.cancelReclaim(id);

        vm.expectEmit(true, false, false, false);
        emit PM.ProjectReclaimCancelled(id);
        vm.prank(manager);
        pm.cancelReclaim(id);
        assertEq(_pending(id), address(0));
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, id));
        pm.executeReclaim(id);

        // the contract owner can cancel too, and a cancel is not a veto: the same pair may be attested again
        pm.claimProject(_attest(HONEST_KEY, "funded-app", teamN));
        vm.prank(owner);
        pm.cancelReclaim(id);
        assertEq(pm.vetoedReclaimant(id), address(0));
        pm.claimProject(_attest(HONEST_KEY, "funded-app", teamN));
        vm.warp(block.timestamp + DELAY);
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), teamN);
    }

    function test_M1_CancelWithoutPending_Reverts() public {
        bytes32 id = pm.projectIdOf("funded-app");
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, id));
        pm.cancelReclaim(id);
    }

    function test_M1_PendingFirstClaim_ExpiresAfterTheWindow() public {
        bytes32 id = pm.projectIdOf("funded-app");
        vm.prank(victim);
        pm.depositFor{ value: 1 ether }(id);
        pm.claimProject(_attest(HONEST_KEY, "funded-app", teamN));
        vm.warp(block.timestamp + DELAY + pm.PENDING_EXPIRY() + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, id));
        pm.executeReclaim(id);
        // a fresh attestation starts again
        pm.claimProject(_attest(HONEST_KEY, "funded-app", teamN));
        vm.warp(block.timestamp + DELAY);
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), teamN);
    }

    function test_M1_FeeCap_CannotBeRaisedAboveTheDefault() public {
        bytes32 id = pm.projectIdOf("cap-app");
        pm.claimProject(_attest(HONEST_KEY, "cap-app", teamN));
        vm.startPrank(teamN);
        vm.expectRevert(abi.encodeWithSelector(PM.MaxFeePerGasTooHigh.selector, uint256(40_000 gwei) + 1, uint256(40_000 gwei)));
        pm.setMaxFeePerGas(id, uint128(40_000 gwei) + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.MaxFeePerGasTooHigh.selector, type(uint128).max, uint256(40_000 gwei)));
        pm.setMaxFeePerGas(id, type(uint128).max);
        pm.setMaxFeePerGas(id, 40_000 gwei); // the default itself is allowed; tightening always is
        pm.setMaxFeePerGas(id, 1 gwei);
        vm.stopPrank();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PM.MaxFeePerGasTooHigh.selector, type(uint128).max, uint256(40_000 gwei)));
        pm.setFreeMaxFeePerGas(type(uint128).max);
    }

    function _pack(uint128 hi, uint128 lo) internal pure returns (bytes32) {
        return bytes32((uint256(hi) << 128) | uint256(lo));
    }

    function _rogueOp(bytes32 sponsor, uint128 fee) internal returns (PackedUserOperation memory op) {
        op.sender = address(acct);
        op.nonce = ep.getNonce(address(acct), 0);
        op.callData = abi.encodeWithSelector(
            0xe9ae5c53, bytes32(0), abi.encodePacked(address(app), uint256(0), abi.encodeCall(RealEpGasBurner.burn, (1)))
        );
        op.accountGasLimits = _pack(VER_GAS, CALL_GAS);
        op.preVerificationGas = PVG;
        op.gasFees = _pack(fee, fee);
        bytes memory prefix = abi.encodePacked(
            address(pm), PM_VER, PM_POST, uint8(0x02), uint48(block.timestamp + 90), uint48(block.timestamp), sponsor
        );
        op.paymasterAndData = bytes.concat(prefix, new bytes(65));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", pm.getHash(1, op)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ROGUE_KEY, digest);
        op.paymasterAndData = bytes.concat(prefix, abi.encodePacked(r, s, v));
    }

    /// @dev Audit B's PoC test_B3_RogueManager_DrainsFundedUnclaimedProject_NoPauseDefence, adapted: the rogue
    /// signer's claim of the funded project is now pending, the contract owner cancels it inside the window, and the
    /// attacker never becomes the owner, so it can configure nothing and nothing is drained.
    function test_M1_Regression_RogueManagerAndSigner_CannotDrainFundedUnclaimedProject() public {
        vm.prank(owner);
        pm.removeSigner(vm.addr(ROGUE_KEY));
        bytes32 id = pm.projectIdOf("victim-app");
        vm.prank(victim);
        pm.depositFor{ value: 100 ether }(id);

        // hot manager key compromised: rogue signer + rogue bundler proposed, the documented 48h window passes
        vm.startPrank(manager);
        pm.proposeAdminChange(1, vm.addr(ROGUE_KEY));
        pm.proposeAdminChange(2, rogueBundler);
        vm.stopPrank();
        vm.warp(block.timestamp + 2 days);
        vm.startPrank(manager);
        pm.executeAdminChange(1, vm.addr(ROGUE_KEY));
        pm.executeAdminChange(2, rogueBundler);
        vm.stopPrank();

        // the rogue signer attests a claim to the attacker: PENDING, not immediate
        address attacker = makeAddr("attacker");
        pm.claimProject(_attest(ROGUE_KEY, "victim-app", attacker));
        assertEq(_ownerOf(id), address(0), "attacker is not the owner");
        address[] memory t = new address[](1);
        t[0] = address(app);
        vm.startPrank(attacker);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setTargets(id, t, true);
        vm.expectRevert(PM.NotProjectOwner.selector);
        pm.setMaxFeePerGas(id, type(uint128).max);
        vm.stopPrank();

        // it cannot be spent either: the project has no owner, no allowlist, no limits
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _rogueOp(id, 1 gwei);
        vm.prank(rogueBundler, rogueBundler);
        vm.expectRevert();
        ep.handleOps{ gas: 5_000_000 }(ops, rogueBeneficiary);

        // the (non-compromised) contract owner sees ProjectClaimProposed and cancels inside the window
        vm.prank(owner);
        pm.cancelReclaim(id);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, id));
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), address(0));
        assertEq(_bal(id), 100 ether, "the victim's deposit is untouched");
        assertEq(rogueBeneficiary.balance, 0);
    }

    function test_M1_Control_OwnerCanCancelTheProposalInTheWindow() public {
        vm.prank(manager);
        pm.proposeAdminChange(2, rogueBundler);
        vm.prank(owner);
        pm.cancelAdminChange(2, rogueBundler);
        vm.warp(block.timestamp + 3 days);
        vm.prank(manager);
        vm.expectRevert();
        pm.executeAdminChange(2, rogueBundler);
    }

    /*//////////////////////////////////////////////////////////////////////////
       M-2  one veto per (project, newOwner): a hostile owner cannot block recovery forever
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev Audit B's PoC test_B2_OwnerVeto_RecoveryImpossible_AfterSignerCompromiseClaim, adapted. Funds deposited
    /// AFTER the (empty-project) hostile claim so that the claim is immediate, as in the real front-run of an empty app.
    function test_M2_Regression_SecondAttestedReclaim_IsNotCancellable_RecoverySucceeds() public {
        bytes32 id = pm.projectIdOf("victim-app");
        // leaked signer key front-runs the team's first claim
        pm.claimProject(_attest(ROGUE_KEY, "victim-app", attackerE));
        vm.prank(victim);
        pm.depositFor{ value: 50 ether }(id);
        vm.prank(manager);
        pm.removeSigner(vm.addr(ROGUE_KEY)); // ops removes the rogue signer at once

        // round 1: the hostile owner uses its single veto
        pm.reclaimProject(_attest(HONEST_KEY, "victim-app", teamN));
        vm.warp(block.timestamp + 47 hours);
        vm.prank(attackerE);
        pm.cancelReclaim(id);
        assertEq(pm.vetoedReclaimant(id), teamN);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, id));
        pm.executeReclaim(id);

        // round 2: the SAME newOwner attested again cannot be cancelled
        pm.reclaimProject(_attest(HONEST_KEY, "victim-app", teamN));
        vm.warp(block.timestamp + 47 hours);
        vm.prank(attackerE);
        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimNotCancellable.selector, id));
        pm.cancelReclaim(id);
        assertEq(_pending(id), teamN, "still pending");
        vm.warp(block.timestamp + 1 hours);
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), teamN, "recovery succeeded");
        assertEq(pm.vetoedReclaimant(id), address(0), "the veto record is cleared once the pair executed");
    }

    function test_M2_Veto_IsPerNewOwner_ADifferentReclaimantIsStillCancellable() public {
        bytes32 id = pm.projectIdOf("app-v");
        pm.claimProject(_attest(HONEST_KEY, "app-v", attackerE));
        pm.reclaimProject(_attest(HONEST_KEY, "app-v", teamN));
        vm.prank(attackerE);
        pm.cancelReclaim(id); // veto on teamN
        address other = makeAddr("other");
        pm.reclaimProject(_attest(HONEST_KEY, "app-v", other));
        vm.prank(attackerE);
        pm.cancelReclaim(id); // `other` is a different pair: vetoable once
        assertEq(pm.vetoedReclaimant(id), other);
        // the record holds the latest vetoed newOwner: a second attested re-claim of `other` is now uncancellable
        pm.reclaimProject(_attest(HONEST_KEY, "app-v", other));
        vm.prank(attackerE);
        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimNotCancellable.selector, id));
        pm.cancelReclaim(id);
    }

    function test_M2_AcceptProjectOwnership_DoesNotClearAVetoedReclaim() public {
        bytes32 id = pm.projectIdOf("app-w");
        pm.claimProject(_attest(HONEST_KEY, "app-w", attackerE));
        address selfNominee = makeAddr("selfNominee");
        pm.reclaimProject(_attest(HONEST_KEY, "app-w", teamN));
        vm.prank(attackerE);
        pm.cancelReclaim(id); // veto on teamN
        pm.reclaimProject(_attest(HONEST_KEY, "app-w", teamN)); // uncancellable now

        // the hostile owner tries to wipe it by a self-nominated transfer (B's PoC: "accepting also clears pendingReclaim")
        vm.prank(attackerE);
        pm.proposeProjectOwner(id, selfNominee);
        vm.prank(selfNominee);
        pm.acceptProjectOwnership(id);
        assertEq(_ownerOf(id), selfNominee);
        assertEq(_pending(id), teamN, "the vetoed reclaim survived the transfer");
        vm.warp(block.timestamp + DELAY);
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), teamN);
    }

    function test_M2_AcceptProjectOwnership_StillClearsAnUnvetoedReclaim() public {
        bytes32 id = pm.projectIdOf("app-x2");
        pm.claimProject(_attest(HONEST_KEY, "app-x2", attackerE));
        pm.reclaimProject(_attest(HONEST_KEY, "app-x2", teamN));
        address nominee = makeAddr("nominee");
        vm.prank(attackerE);
        pm.proposeProjectOwner(id, nominee);
        vm.prank(nominee);
        pm.acceptProjectOwnership(id);
        assertEq(_pending(id), address(0));
    }

    /*//////////////////////////////////////////////////////////////////////////
       L-2  addStake is owner-only and the unstake delay is capped
    //////////////////////////////////////////////////////////////////////////*/

    function test_L2_Regression_ManagerCannotRelockStake_OrSetHugeDelay() public {
        vm.prank(owner);
        pm.addStake{ value: 100 ether }(1 days);
        vm.prank(owner);
        pm.unlockStake();
        IStakeManager.DepositInfo memory info = ep.getDepositInfo(address(pm));
        assertFalse(info.staked);

        // audit B/A PoC: the hot manager re-locked the owner's unlock and raised the delay to uint32.max
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, manager));
        pm.addStake(type(uint32).max);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, manager));
        pm.addStake(1 days);
        assertFalse(ep.getDepositInfo(address(pm)).staked, "the owner's unlock stands");

        // the owner itself cannot set a delay beyond 30 days
        vm.prank(owner);
        vm.expectRevert(PM.DelayTooLong.selector);
        pm.addStake(uint32(30 days) + 1);
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        pm.withdrawStake(payable(owner));
        assertEq(ep.getDepositInfo(address(pm)).stake, 0);

        vm.prank(owner);
        pm.addStake{ value: 1 ether }(30 days); // the cap itself is allowed
        assertEq(ep.getDepositInfo(address(pm)).unstakeDelaySec, 30 days);
    }

    /*//////////////////////////////////////////////////////////////////////////
       L-3  address(0) as a bundler is reversible
    //////////////////////////////////////////////////////////////////////////*/

    function test_L3_Regression_ZeroBundler_CanBeRemovedAndReAdded() public {
        address[] memory sigs = new address[](1);
        sigs[0] = vm.addr(HONEST_KEY);
        address[] memory b2 = new address[](2);
        b2[0] = honestBundler;
        b2[1] = address(0); // the deploy-script default list contains address(0) for tx.origin == 0 simulation
        PM pm2 = new PM(address(ep), owner, manager, sigs, b2, DELAY, 20_000, 40_000 gwei);
        assertTrue(pm2.isBundlerAllowed(address(0)));
        address[] memory zero = new address[](1);
        vm.prank(manager);
        pm2.removeBundlers(zero);
        assertFalse(pm2.isBundlerAllowed(address(0)));

        // audit B's PoC could never put it back; now it goes through the same timelock as any bundler
        vm.prank(owner);
        pm2.proposeAdminChange(2, address(0));
        vm.warp(block.timestamp + DELAY);
        vm.prank(owner);
        pm2.executeAdminChange(2, address(0));
        assertTrue(pm2.isBundlerAllowed(address(0)));

        // address(0) can still never become a SIGNER (ecrecover returns 0 for a bad signature)
        vm.prank(owner);
        vm.expectRevert(PM.InvalidAdminChange.selector);
        pm2.proposeAdminChange(1, address(0));
    }

    /*//////////////////////////////////////////////////////////////////////////
       B5  nothing lives forever; a nomination can be withdrawn
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev Audit B's PoC test_B6_StaleNominee_SeizesProject_AndKillsPendingReclaim, adapted: the owner can unset the
    /// nomination, and a nominee cannot clear the recovery re-claim of a vetoed pair.
    function test_B5_Regression_NominationCanBeUnset_StaleNomineeCannotAccept() public {
        bytes32 id = pm.projectIdOf("app-y");
        address oldOwner = makeAddr("oldOwner");
        address staleNominee = makeAddr("staleNominee");
        pm.claimProject(_attest(HONEST_KEY, "app-y", oldOwner));
        vm.startPrank(oldOwner);
        pm.proposeProjectOwner(id, staleNominee);
        assertEq(pm.pendingProjectOwner(id), staleNominee);
        pm.proposeProjectOwner(id, address(0)); // unset
        vm.stopPrank();
        assertEq(pm.pendingProjectOwner(id), address(0));
        vm.prank(staleNominee);
        vm.expectRevert(PM.NotPendingProjectOwner.selector);
        pm.acceptProjectOwnership(id);
        // nobody (not even address(0)) can accept an unset nomination
        vm.prank(address(0));
        vm.expectRevert(PM.NotPendingProjectOwner.selector);
        pm.acceptProjectOwnership(id);
    }

    function test_B5_PendingReclaim_ExpiresAfterTheWindow() public {
        pm.claimProject(_attest(HONEST_KEY, "app-x", attackerE));
        bytes32 id = pm.projectIdOf("app-x");
        pm.reclaimProject(_attest(HONEST_KEY, "app-x", teamN));
        vm.warp(block.timestamp + DELAY + pm.PENDING_EXPIRY()); // the last valid second
        uint256 snap = vm.snapshot();
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), teamN);
        vm.revertTo(snap);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, id)); // 3 years later in B's PoC
        pm.executeReclaim(id);
        assertEq(_ownerOf(id), attackerE);
    }

    function test_B5_AdminChange_ExpiresAfterTheWindow_AndCanBeReProposed() public {
        address someSigner = makeAddr("someSigner");
        vm.prank(manager);
        pm.proposeAdminChange(1, someSigner);
        vm.prank(manager);
        vm.expectRevert(PM.AdminChangeAlreadyProposed.selector);
        pm.proposeAdminChange(1, someSigner);
        vm.warp(block.timestamp + DELAY + pm.PENDING_EXPIRY() + 1);
        vm.prank(manager);
        vm.expectRevert(PM.AdminChangeNotProposed.selector); // audit B: "executable 3 years later"
        pm.executeAdminChange(1, someSigner);
        assertFalse(pm.signers(someSigner));
        // an expired proposal does not block a new one
        vm.prank(manager);
        pm.proposeAdminChange(1, someSigner);
        vm.warp(block.timestamp + DELAY);
        vm.prank(manager);
        pm.executeAdminChange(1, someSigner);
        assertTrue(pm.signers(someSigner));
    }

    /*//////////////////////////////////////////////////////////////////////////
       A7  setFreeTier rejects a per-sender limit below the per-op cap
    //////////////////////////////////////////////////////////////////////////*/

    function test_A7_SetFreeTier_RejectsSenderLimitBelowOpCost() public {
        vm.startPrank(owner);
        vm.expectRevert(PM.InvalidFreeTierConfig.selector);
        pm.setFreeTier(40 ether, 39 ether, true);
        pm.setFreeTier(40 ether, 40 ether, true);
        pm.setFreeTier(40 ether, 0, true); // 0 = no per-sender limit on the free pool
        pm.setFreeTier(0, 0, false);
        vm.stopPrank();
    }
}
