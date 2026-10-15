// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";

import { PepuSponsoredPaymasterV7 as PM } from "../src/PepuSponsoredPaymasterV7.sol";
import { SponsoredTestUtils } from "./mocks/SponsoredTestUtils.sol";
import { MockEntryPointSim } from "./mocks/MockEntryPointSim.sol";

/// @dev Drives random sequences of every state-changing operation (registration, deposits, free-pool funding,
/// surplus credits, direct EntryPoint donations, pausing, limit changes, overhead lowering, stake management, ownership
/// transfers, time warps, and single/bundled sponsored ops with random max/actual cost, fee and success/revert)
/// against the paymaster wired to the faithful EntryPoint simulator. Deposits are one-way: there is no withdrawal
/// action to drive, and the invariants check that PEPU only ever leaves the deposit as gas paid to the beneficiary.
contract SponsorHandler is SponsoredTestUtils {
    address public admin = makeAddr("inv-admin");
    address public manager = makeAddr("inv-manager");
    address internal constant TARGET = address(0xA0A0);

    address[3] public owners;
    bytes32[] public ids;
    uint256 public opsRun;
    uint256 public bundlesRun;
    uint256 public ghostDonated;
    uint256 public ghostStakeReturned;
    /// @dev every wei ever put into the paymaster's EntryPoint deposit through any path (registration, deposits, free
    /// pool, direct donations).
    uint256 public ghostIn;
    uint256 public ownerStartBalance;

    constructor() {
        vm.warp(1_700_000_000);
        _deployPaymaster(admin, manager, 2 days);
        for (uint256 i = 0; i < 4; i++) {
            // the four projects exist as ledgers from the start (anyone can deposit before a claim)
            ids.push(pm.projectIdOf(string.concat("inv-app-", vm.toString(i))));
        }
        owners[0] = makeAddr("inv-owner-0");
        owners[1] = makeAddr("inv-owner-1");
        owners[2] = makeAddr("inv-owner-2");
        for (uint256 i = 0; i < 3; i++) {
            vm.deal(owners[i], type(uint96).max);
        }
        vm.deal(admin, type(uint96).max);
        ownerStartBalance = admin.balance;
        vm.deal(address(this), type(uint96).max);
        vm.startPrank(admin);
        pm.setFreeTier(40 ether, 500 ether, true);
        address[] memory t = new address[](1);
        t[0] = TARGET;
        pm.setFreeTargets(t, true);
        vm.stopPrank();
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _pickId(uint256 seed) internal view returns (bytes32) {
        if (seed % (ids.length + 1) == ids.length) return bytes32(0); // free pool
        return ids[seed % ids.length];
    }

    function _pickOwnerOf(bytes32 id) internal view returns (address) {
        (address o,,,,,,) = pm.getProject(id);
        return o;
    }

    /*------------------------------ actions ------------------------------*/

    function register(uint256 ownerSeed, uint256 idSeed, uint256 dep, uint256 limit) external {
        address owner = owners[ownerSeed % 3];
        string memory appId = string.concat("inv-app-", vm.toString(idSeed % 4));
        address[] memory t = new address[](1);
        t[0] = TARGET;
        PM.Claim memory c = _claimStruct(pm, SIGNER_KEY, appId, owner, block.timestamp + 1 hours);
        uint112 lim = uint112(bound(limit, 1 ether, 600 ether));
        try pm.claimProject(c) returns (bytes32 id) {
            vm.startPrank(owner);
            pm.setTargets(id, t, true);
            pm.setDailyLimit(id, lim);
            pm.setSenderDailyLimit(id, lim);
            vm.stopPrank();
            uint256 v = bound(dep, 0, 400 ether);
            if (v > 0) {
                vm.prank(owner);
                pm.depositFor{ value: v }(id);
                ghostIn += v;
            }
        } catch { }
    }

    /// @dev Attested re-claim, then (after the timelock) execution: ownership moves, the ledger never does.
    function reclaim(uint256 idSeed, uint256 toSeed, bool execute) external {
        bytes32 id = ids[idSeed % ids.length];
        string memory appId = string.concat("inv-app-", vm.toString(idSeed % ids.length));
        PM.Claim memory c = _claimStruct(pm, SIGNER_KEY, appId, owners[toSeed % 3], block.timestamp + 1 hours);
        try pm.reclaimProject(c) {
            if (execute) {
                vm.warp(block.timestamp + pm.adminChangeDelay());
                try pm.executeReclaim(id) { } catch { }
            }
        } catch { }
    }

    function deposit(uint256 idSeed, uint256 amount) external {
        bytes32 id = _pickId(idSeed);
        if (id == bytes32(0)) return;
        uint256 v = bound(amount, 1, 300 ether); // may hit a not-yet-claimed project: fine, it is still a ledger
        vm.prank(owners[idSeed % 3]); // any depositor, not necessarily the project's owner
        try pm.depositFor{ value: v }(id) {
            ghostIn += v;
        } catch { }
    }

    function transferProject(uint256 idSeed, uint256 toSeed) external {
        bytes32 id = _pickId(idSeed);
        address from = _pickOwnerOf(id);
        address to = owners[toSeed % 3];
        vm.prank(from);
        try pm.proposeProjectOwner(id, to) {
            vm.prank(to);
            try pm.acceptProjectOwnership(id) { } catch { }
        } catch { }
    }

    function stake(uint256 amount, bool unlockAndWithdraw) external {
        vm.prank(manager);
        try pm.addStake{ value: bound(amount, 1, 10 ether) }(1) { } catch { }
        if (unlockAndWithdraw) {
            uint256 before = admin.balance;
            vm.startPrank(admin);
            pm.unlockStake();
            pm.withdrawStake(payable(admin)); // stake only: never the deposit
            vm.stopPrank();
            ghostStakeReturned += admin.balance - before;
        }
    }

    function fundFree(uint256 amount) external {
        uint256 v = bound(amount, 1, 300 ether);
        vm.prank(owners[0]);
        pm.fundFreePool{ value: v }();
        ghostIn += v;
    }

    function creditSurplus() external {
        try pm.creditSurplusToFreePool() { } catch { }
    }

    function donateToEntryPoint(uint256 amount) external {
        uint256 a = bound(amount, 1, 100 ether);
        ghostDonated += a;
        ghostIn += a;
        ep.depositTo{ value: a }(address(pm));
    }

    function setPaused(uint256 idSeed, bool paused) external {
        bytes32 id = _pickId(idSeed);
        vm.prank(_pickOwnerOf(id));
        try pm.setPaused(id, paused) { } catch { }
    }

    function setDailyLimit(uint256 idSeed, uint256 limit) external {
        bytes32 id = _pickId(idSeed);
        vm.prank(_pickOwnerOf(id));
        try pm.setDailyLimit(id, uint112(bound(limit, 1 ether, 600 ether))) { } catch { }
    }

    function lowerOverhead(uint256 gas) external {
        vm.prank(admin);
        try pm.setPostOpOverheadGas(uint32(bound(gas, pm.MIN_POSTOP_OVERHEAD_GAS(), pm.maxPostOpOverheadGas()))) { } catch { }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function runOp(uint256 idSeed, uint256 maxSeed, uint256 actualSeed, uint256 feeSeed, bool reverted, bool postOpOOG)
        external
    {
        bytes32 id = _pickId(idSeed);
        uint256 maxCost = bound(maxSeed, 0.5 ether, 20 ether);
        uint256 actual = bound(actualSeed, 0, maxCost);
        uint256 fee = bound(feeSeed, 1, 15_000 gwei);
        ep.setPostOpGasCap(postOpOOG ? 3_000 : 0);
        try this.execOne(id, maxCost, actual, fee, reverted) {
            opsRun++;
        } catch { }
        ep.setPostOpGasCap(0);
    }

    function runBundle(uint256 idSeed, uint256 max1, uint256 act1, uint256 max2, uint256 act2) external {
        bytes32 id = _pickId(idSeed);
        try this.execTwo(id, max1, act1, max2, act2) {
            bundlesRun++;
        } catch { }
    }

    function execOne(bytes32 id, uint256 maxCost, uint256 actual, uint256 fee, bool reverted) external {
        PackedUserOperation memory op = _buildOp(_spec(address(0x5E5E), _singleCall(TARGET), id));
        _run(op, maxCost, actual, fee, reverted);
    }

    function execTwo(bytes32 id, uint256 max1, uint256 act1, uint256 max2, uint256 act2) external {
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _buildOp(_spec(address(0x5E5E), _singleCall(TARGET), id));
        ops[1] = _buildOp(_spec(address(0x5E5F), _singleCall(TARGET), id));
        MockEntryPointSim.OpCost[] memory costs = new MockEntryPointSim.OpCost[](2);
        uint256 m1 = bound(max1, 0.5 ether, 15 ether);
        uint256 m2 = bound(max2, 0.5 ether, 15 ether);
        costs[0] = MockEntryPointSim.OpCost(m1, bound(act1, 0, m1), false);
        costs[1] = MockEntryPointSim.OpCost(m2, bound(act2, 0, m2), false);
        _runBundle(ops, costs, 1 gwei);
    }

    /*------------------------------ views ------------------------------*/

    function sumOfBalances() public view returns (uint256 sum) {
        sum = _bal(bytes32(0));
        for (uint256 i = 0; i < ids.length; i++) {
            sum += _bal(ids[i]);
        }
    }

    function beneficiaryAddr() external view returns (address) {
        return beneficiary;
    }

    function paymaster() external view returns (PM) {
        return pm;
    }

    function entrypoint() external view returns (MockEntryPointSim) {
        return ep;
    }
}

contract PepuSponsoredPaymasterV7InvariantTest is Test {
    SponsorHandler internal h;

    function setUp() public {
        h = new SponsorHandler();
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](15);
        sels[0] = h.register.selector;
        sels[1] = h.deposit.selector;
        sels[2] = h.reclaim.selector;
        sels[3] = h.transferProject.selector;
        sels[4] = h.stake.selector;
        sels[5] = h.fundFree.selector;
        sels[6] = h.creditSurplus.selector;
        sels[7] = h.donateToEntryPoint.selector;
        sels[8] = h.setPaused.selector;
        sels[9] = h.setDailyLimit.selector;
        sels[10] = h.lowerOverhead.selector;
        sels[11] = h.warp.selector;
        sels[12] = h.runOp.selector;
        sels[13] = h.runBundle.selector;
        sels[14] = h.runOp.selector;
        targetSelector(FuzzSelector({ addr: address(h), selectors: sels }));
    }

    /// @dev Guards against a vacuous invariant campaign: the handler paths must actually succeed, not just revert.
    function test_Handler_ExercisesRealSponsoredOpsAndDeposits() public {
        h.register(0, 0, 200 ether, 500 ether);
        assertEq(h.paymaster().totalLiabilities(), 200 ether);
        assertEq(h.idsLength(), 4);
        h.fundFree(100 ether);
        h.runOp(0, 12 ether, 3 ether, 1 gwei, false, false); // project op
        h.runOp(4, 12 ether, 3 ether, 1 gwei, true, false); // idSeed=4 -> free pool
        h.runOp(0, 12 ether, 3 ether, 1 gwei, false, true); // postOp out-of-gas path
        h.runBundle(0, 5 ether, 2 ether, 6 ether, 1 ether);
        assertEq(h.opsRun(), 3, "all three single ops succeeded");
        assertEq(h.bundlesRun(), 1);
        h.deposit(0, 5 ether);
        h.reclaim(0, 2, true);
        h.stake(1 ether, true);
        h.transferProject(0, 1);
        h.donateToEntryPoint(7 ether);
        h.creditSurplus();
        assertEq(h.sumOfBalances(), h.paymaster().totalLiabilities());
        assertLe(h.sumOfBalances(), h.entrypoint().balanceOf(address(h.paymaster())));
    }

    /// I1: the contract's running total equals the sum of every sponsor's ledger balance.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 80
    function invariant_TotalLiabilitiesEqualsSumOfBalances() public view {
        assertEq(h.paymaster().totalLiabilities(), h.sumOfBalances());
    }

    /// I2: the headline invariant: sum of balances <= funds held (the paymaster's EntryPoint deposit).
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 80
    function invariant_SumOfBalancesNeverExceedsHeldFunds() public view {
        assertLe(h.sumOfBalances(), h.entrypoint().balanceOf(address(h.paymaster())));
    }

    /// I5: ETH conservation in the EntryPoint (deposits + stake never exceed what it actually holds).
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 80
    function invariant_EntryPointHoldsAllDeposits() public view {
        address ep = address(h.entrypoint());
        assertGe(ep.balance, h.entrypoint().balanceOf(address(h.paymaster())));
    }

    /// I-OUT (deposits are one-way): the deposit plus the gas already paid out to the bundler beneficiary equals
    /// everything ever put in. Equivalently, `sum of ledgers + surplus` (== the deposit, I1+surplus identity) only ever
    /// DECREASES through gas settlement: no withdrawal, owner, manager, project or stake path moves it anywhere else.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 80
    function invariant_DepositOnlyLeavesAsGasPaidToBeneficiary() public view {
        PM pm = h.paymaster();
        uint256 deposit = h.entrypoint().balanceOf(address(pm));
        // (the former "ledgers + surplus == deposit" assert was tautological given surplus(); removed, delta review I-5)
        assertEq(deposit + h.beneficiaryAddr().balance, h.ghostIn(), "deposit + gas paid == everything deposited");
    }

    /// The owner (admin) never receives anything: it can neither withdraw the free pool nor reach any ledger,
    /// surplus or donation. (Stake withdrawals go to it, so they are netted out: stake is the owner's own money.)
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 80
    function invariant_OwnerReceivesOnlyItsOwnStake() public view {
        assertEq(h.admin().balance, h.ownerStartBalance() + h.ghostStakeReturned());
    }

    // (invariant_SurplusIsUnownedRemainder was tautological given surplus(), so it was removed in the delta review, I-5.
    // The meaningful solvency checks are I1, I2 and the deposit-conservation invariant above.)
}
