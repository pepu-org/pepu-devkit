// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PepuSponsoredPaymasterV7 as PM } from "../src/PepuSponsoredPaymasterV7.sol";
import { SponsoredTestUtils } from "./mocks/SponsoredTestUtils.sol";

/// @dev The contract owner is a contract that re-enters the paymaster from `receive()` while EntryPoint.withdrawStake
/// is paying out the STAKE. Deposits are one-way, so stake is the only ETH this paymaster can ever send anywhere
/// (besides EntryPoint paying bundlers for gas); this test pins down that such a payout cannot disturb any ledger.
contract ReentrantOwner {
    enum Attack {
        None,
        FundFreePool,
        DepositFor,
        CreditSurplus,
        ClaimProject
    }

    PM public pm;
    bytes32 public projectId;
    Attack public attack;
    uint256 public receives;
    bool public reentrantCallSucceeded;

    constructor(PM _pm) {
        pm = _pm;
    }

    function configure(Attack a, bytes32 id) external {
        attack = a;
        projectId = id;
        receives = 0;
        reentrantCallSucceeded = false;
    }

    function stakeAndWithdraw() external payable {
        pm.addStake{ value: msg.value }(1);
        pm.unlockStake();
        pm.withdrawStake(payable(address(this)));
    }

    receive() external payable {
        receives++;
        if (attack == Attack.None || receives > 1) return;
        try this.doAttack() {
            reentrantCallSucceeded = true;
        } catch { }
    }

    function doAttack() external {
        require(msg.sender == address(this), "self");
        if (attack == Attack.FundFreePool) {
            pm.fundFreePool{ value: 1 }();
        } else if (attack == Attack.DepositFor) {
            pm.depositFor{ value: 1 }(projectId);
        } else if (attack == Attack.CreditSurplus) {
            pm.creditSurplusToFreePool();
        } else if (attack == Attack.ClaimProject) {
            // no valid attestation: must revert
            pm.claimProject(PM.Claim("reentrant-app", address(this), 1, type(uint256).max, new bytes(65)));
        }
    }
}

contract PepuSponsoredPaymasterV7ReentrancyTest is SponsoredTestUtils {
    address internal manager = makeAddr("manager");
    address internal outsider = makeAddr("outsider");
    uint32 internal constant DELAY = 2 days;
    bytes32 internal id;
    ReentrantOwner internal actor;

    function setUp() public {
        vm.warp(1_700_000_000);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 2);
        _deployPaymaster(predicted, manager, DELAY);
        actor = new ReentrantOwner(pm);
        require(address(actor) == predicted, "address prediction");
        id = pm.projectIdOf("reentrant-project");
        vm.deal(address(actor), 1_000 ether);
        vm.deal(outsider, 1_000 ether);
        address[] memory t = new address[](1);
        t[0] = address(0xA0A0);
        _register(outsider, "reentrant-project", t, 1_000 ether, 1_000 ether, 100 ether);
        vm.prank(outsider);
        pm.fundFreePool{ value: 50 ether }();
        vm.prank(outsider);
        ep.depositTo{ value: 10 ether }(address(pm)); // surplus
    }

    function _assertConsistent() internal view {
        assertEq(pm.totalLiabilities(), _bal(id) + _bal(bytes32(0)));
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    function test_StakePayout_NeverTouchesTheDeposit() public {
        uint256 depositBefore = ep.balanceOf(address(pm));
        uint256 before = address(actor).balance;
        actor.stakeAndWithdraw{ value: 5 ether }(); // 5 ether comes from this test, goes to stake, comes back
        assertEq(address(actor).balance, before + 5 ether, "the owner got exactly its own stake back");
        assertEq(ep.balanceOf(address(pm)), depositBefore);
        assertEq(_bal(id), 100 ether);
        _assertConsistent();
    }

    function test_Reenter_DuringStakePayout_DepositPaths_KeepAccountingConsistent() public {
        uint256 startBalance = address(actor).balance;
        ReentrantOwner.Attack[3] memory attacks = [
            ReentrantOwner.Attack.FundFreePool, ReentrantOwner.Attack.DepositFor, ReentrantOwner.Attack.CreditSurplus
        ];
        for (uint256 i = 0; i < attacks.length; i++) {
            actor.configure(attacks[i], id);
            actor.stakeAndWithdraw{ value: 5 ether }();
            // these re-entrant calls are legitimate public functions, so they may succeed: they only ever add money
            // to a ledger. The point is that nothing can take money OUT, and the books stay balanced.
            _assertConsistent();
        }
        // the owner ends with its start balance + the 15 ether this test sent it for staking - 2 wei it re-deposited
        assertEq(address(actor).balance, startBalance + 15 ether - 2, "no ETH extracted beyond what it put in");
    }

    function test_Reenter_ClaimProject_NeedsAttestation() public {
        actor.configure(ReentrantOwner.Attack.ClaimProject, id);
        actor.stakeAndWithdraw{ value: 1 ether }();
        assertFalse(actor.reentrantCallSucceeded(), "a re-entrant claim without an attestation reverts");
        assertEq(_owner(pm.projectIdOf("reentrant-app")), address(0));
        _assertConsistent();
    }
}
