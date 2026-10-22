// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ClaimTestHelper } from "./mocks/ClaimTestHelper.sol";
import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { EntryPoint } from "@account-abstraction-v7/core/EntryPoint.sol";
import { PepuSponsoredPaymasterV7 as PM } from "../src/PepuSponsoredPaymasterV7.sol";

/// @dev Minimal Kernel-shaped account: accepts any signature, implements execute(bytes32,bytes) (single + batch).
contract RealEpAccount {
    address public immutable ep;

    constructor(address _ep) payable {
        ep = _ep;
    }

    function validateUserOp(PackedUserOperation calldata, bytes32, uint256 missing) external returns (uint256) {
        require(msg.sender == ep, "ep");
        if (missing > 0) {
            (bool ok,) = payable(msg.sender).call{ value: missing }("");
            require(ok);
        }
        return 0;
    }

    // selector 0xe9ae5c53
    function execute(bytes32 mode, bytes calldata exec) external payable {
        require(msg.sender == ep || msg.sender == address(this), "auth");
        if (bytes1(mode) == 0x00) {
            address target = address(bytes20(exec[0:20]));
            uint256 value = uint256(bytes32(exec[20:52]));
            (bool ok, bytes memory r) = target.call{ value: value }(exec[52:]);
            if (!ok) {
                assembly {
                    revert(add(r, 32), mload(r))
                }
            }
        } else {
            PM.Execution[] memory b = abi.decode(exec, (PM.Execution[]));
            for (uint256 i = 0; i < b.length; i++) {
                (bool ok, bytes memory r) = b[i].target.call{ value: b[i].value }(b[i].callData);
                if (!ok) {
                    assembly {
                        revert(add(r, 32), mload(r))
                    }
                }
            }
        }
    }

    receive() external payable { }
}

/// @dev Same selector and semantics but different runtime code: an "impostor" account (L-2).
contract RealEpImpostorAccount is RealEpAccount {
    uint256 public marker = 0xBAD;

    constructor(address _ep) payable RealEpAccount(_ep) { }
}

/// @dev Burns a configurable amount of gas (an allowlisted "app" target).
contract RealEpGasBurner {
    uint256 public x;

    function burn(uint256 n) external {
        for (uint256 i = 0; i < n; i++) {
            x += 1;
        }
    }
}

/// @notice Runs the paymaster against the REAL vendored EntryPoint v0.7 (not MockEntryPointSim), so the
/// solvency claims (ledger charge >= EntryPoint's true debit), the postOp gas floor and the day-bucket refund are
/// tested against the real prefund, penalty and refund code. Born from the internal review in
/// services/paymaster/audits/2026-10-internal-review.md.
contract PepuSponsoredPaymasterV7RealEntryPointTest is Test, ClaimTestHelper {
    uint256 internal constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint128 internal constant PM_VER = 200_000;
    uint128 internal constant PM_POST = 40_000;
    uint128 internal constant VER_GAS = 150_000;
    uint128 internal constant PVG = 50_000;
    uint128 internal constant DEFAULT_FEE_CAP = 10 gwei;

    EntryPoint internal ep;
    PM internal pm;
    RealEpAccount internal acct;
    RealEpGasBurner internal app;
    address internal bundler = makeAddr("bundler");
    address payable internal beneficiary = payable(makeAddr("beneficiary"));
    address internal alice = makeAddr("alice");
    address internal victim = makeAddr("victim");
    bytes32 internal idA;
    bytes32 internal idV;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        vm.fee(1 gwei);
        ep = new EntryPoint();
        address[] memory sigs = new address[](1);
        sigs[0] = vm.addr(SIGNER_KEY);
        address[] memory bundlers = new address[](1);
        bundlers[0] = bundler;
        pm = new PM(address(ep), address(this), address(this), sigs, bundlers, 2 days, 20_000, DEFAULT_FEE_CAP);
        // The postOp overhead is lowered to its FLOOR here, in setUp (a separate transaction in Foundry), so the test
        // transaction starts with a COLD, un-warmed `postOpOverheadGas` slot, like state written in an earlier block
        // (review 3, L-6: doing this inside a test warmed the slot and hid 2,000 gas of postOp cost).
        pm.setPostOpOverheadGas(pm.MIN_POSTOP_OVERHEAD_GAS());
        app = new RealEpGasBurner();
        acct = new RealEpAccount{ value: 100 ether }(address(ep));
        vm.deal(alice, 1_000_000 ether);
        vm.deal(victim, 1_000_000 ether);
        // alice's project: allowlists the app AND the paymaster itself (a project may allowlist any address)
        address[] memory t = new address[](2);
        t[0] = address(app);
        t[1] = address(pm);
        idA = _claimAs(pm, SIGNER_KEY, alice, "alice-app", t, 1_000 ether, 1_000 ether, 100 ether);
        // victim project: unrelated third party funds
        address[] memory vt = new address[](1);
        vt[0] = address(app);
        idV = _claimAs(pm, SIGNER_KEY, victim, "victim-app", vt, 10_000 ether, 10_000 ether, 1_000 ether);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                     HELPERS
    //////////////////////////////////////////////////////////////////////////*/

    function _pack(uint128 hi, uint128 lo) internal pure returns (bytes32) {
        return bytes32((uint256(hi) << 128) | uint256(lo));
    }

    function _maxCost(uint128 callGas, uint128 maxFee) internal pure returns (uint256) {
        return (uint256(VER_GAS) + callGas + PM_VER + PM_POST + PVG) * maxFee;
    }

    function _op(bytes memory callData, bytes32 sponsor, uint128 callGas)
        internal
        returns (PackedUserOperation memory)
    {
        return _opFull(address(acct), callData, sponsor, callGas, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90));
    }

    function _opFull(
        address sender,
        bytes memory callData,
        bytes32 sponsor,
        uint128 callGas,
        uint128 maxFee,
        uint48 validAfter,
        uint48 validUntil
    )
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        op.nonce = ep.getNonce(sender, 0);
        op.callData = callData;
        op.accountGasLimits = _pack(VER_GAS, callGas);
        op.preVerificationGas = PVG;
        op.gasFees = _pack(maxFee, maxFee); // maxPriority, maxFee
        bytes memory prefix =
            abi.encodePacked(address(pm), PM_VER, PM_POST, uint8(0x02), validUntil, validAfter, sponsor);
        op.paymasterAndData = bytes.concat(prefix, new bytes(65));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", pm.getHash(1, op)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        op.paymasterAndData = bytes.concat(prefix, abi.encodePacked(r, s, v));
    }

    function _single(address target, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(0xe9ae5c53, bytes32(0), abi.encodePacked(target, value, data));
    }

    function _burnCall() internal view returns (bytes memory) {
        return _single(address(app), 0, abi.encodeCall(RealEpGasBurner.burn, (1)));
    }

    function _run(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        ep.handleOps{ gas: 5_000_000 }(ops, beneficiary);
    }

    /// @dev op whose own execution re-credits the project's ledger with exactly `mc`, restoring the `balance` slot
    /// and `totalLiabilities` to their pre-validation values (the worst case for postOp's own gas), then burns gas.
    function _restoreAttackCall(uint256 mc, uint8 burnN) internal view returns (bytes memory) {
        PM.Execution[] memory ex = new PM.Execution[](2);
        ex[0] = PM.Execution({ target: address(pm), value: mc, callData: abi.encodeCall(PM.depositFor, (idA)) });
        ex[1] = PM.Execution({
            target: address(app), value: 0, callData: abi.encodeCall(RealEpGasBurner.burn, (uint256(burnN)))
        });
        return abi.encodeWithSelector(0xe9ae5c53, bytes32(bytes1(0x01)), abi.encode(ex));
    }

    /// @dev returns (EntryPoint's true debit, ledger charge), both normalised for the attack's re-deposit `mc`.
    function _runAndDiff(PackedUserOperation memory op, uint256 mc) internal returns (uint256 epDebit, uint256 ledgerDebit) {
        uint256 depBefore = ep.balanceOf(address(pm));
        uint256 liabBefore = pm.totalLiabilities();
        _run(op);
        epDebit = depBefore + mc - ep.balanceOf(address(pm));
        ledgerDebit = liabBefore + mc - pm.totalLiabilities();
    }

    /*//////////////////////////////////////////////////////////////////////////
                         SOLVENCY AND POSTOP GAS (L-5)
    //////////////////////////////////////////////////////////////////////////*/

    function test_RealEP_Baseline_Solvent() public {
        uint256 surplusBefore = pm.surplus();
        PackedUserOperation memory op = _op(_single(address(app), 0, abi.encodeCall(RealEpGasBurner.burn, (3))), idA, 100_000);
        (uint256 epDebit, uint256 ledgerDebit) = _runAndDiff(op, 0);
        assertGe(ledgerDebit, epDebit, "baseline insolvent");
        assertGe(pm.surplus(), surplusBefore);
        assertGe(ep.balanceOf(address(pm)), pm.totalLiabilities());
    }

    /// @dev Worst postOp gas the attacker can force (slots restored) at the owner-lowerable FLOOR: still solvent.
    function test_RealEP_RestoredSlots_AtFloor_Solvent() public {
        uint128 callGas = 150_000;
        uint256 mc = _maxCost(callGas, 2 gwei);
        PackedUserOperation memory op = _op(_restoreAttackCall(mc, 0), idA, callGas);
        (uint256 epDebit, uint256 ledgerDebit) = _runAndDiff(op, mc);
        assertGe(ledgerDebit, epDebit, "INSOLVENT at the postOp overhead floor");
    }

    /// @dev Lowest charge margin: small callGas shrinks the penalty term so the postOp-overhead term carries the margin.
    function test_RealEP_RestoredSlots_SmallCallGas_AtFloor_Solvent() public {
        uint128 callGas = 60_000;
        uint256 mc = _maxCost(callGas, 2 gwei);
        PackedUserOperation memory op = _op(_restoreAttackCall(mc, 0), idA, callGas);
        (uint256 epDebit, uint256 ledgerDebit) = _runAndDiff(op, mc);
        assertGe(ledgerDebit, epDebit, "INSOLVENT at the postOp overhead floor");
    }

    function testFuzz_RealEP_RestoreAttack_AtFloor_Solvent(uint128 callGas, uint8 burnN) public {
        callGas = uint128(bound(callGas, 70_000, 600_000));
        uint256 mc = _maxCost(callGas, 2 gwei);
        PackedUserOperation memory op = _op(_restoreAttackCall(mc, burnN), idA, callGas);
        (uint256 epDebit, uint256 ledgerDebit) = _runAndDiff(op, mc);
        assertGe(ledgerDebit, epDebit, "INSOLVENT: ledger charge < EntryPoint debit");
    }

    /// @dev The same attack against a project, fuzzing fee levels too: a DIFFERENT sponsor's balance is never spent.
    function testFuzz_RealEP_OtherSponsorUntouched(uint128 callGas, uint8 burnN, uint64 feeSeed) public {
        callGas = uint128(bound(callGas, 70_000, 600_000));
        uint128 fee = uint128(bound(feeSeed, 1 gwei, DEFAULT_FEE_CAP));
        vm.fee(bound(feeSeed, 1, fee));
        (,,, uint128 victimBefore,,,) = pm.getProject(idV);
        PackedUserOperation memory op = _opFull(
            address(acct), _burnN(burnN), idA, callGas, fee, uint48(block.timestamp), uint48(block.timestamp + 90)
        );
        uint256 liabBefore = pm.totalLiabilities();
        uint256 depBefore = ep.balanceOf(address(pm));
        _run(op);
        (,,, uint128 victimAfter,,,) = pm.getProject(idV);
        assertEq(victimAfter, victimBefore, "another sponsor's ledger moved");
        assertGe(liabBefore - pm.totalLiabilities(), depBefore - ep.balanceOf(address(pm)), "insolvent");
    }

    function _burnN(uint8 n) internal view returns (bytes memory) {
        return _single(address(app), 0, abi.encodeCall(RealEpGasBurner.burn, (uint256(n))));
    }

    /*//////////////////////////////////////////////////////////////////////////
                          DAY BUCKET REFUND (L-1 REGRESSION)
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev An op signed just before midnight (validAfter in the OLD day) and executed after it must still have
    /// its unused reservation released from the counter the reservation actually landed in.
    function test_RealEP_DayBoundary_RefundIsReleased() public {
        uint256 dayStart = (block.timestamp / 1 days + 1) * 1 days;
        vm.warp(dayStart + 10);
        PackedUserOperation memory opB = _opFull(
            address(acct), _burnCall(), idA, 100_000, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)
        );
        _run(opB); // moves spentDay forward
        (,,,,, uint112 spentAfterB,) = pm.getProject(idA);
        PackedUserOperation memory opA =
            _opFull(address(acct), _burnCall(), idA, 100_000, 2 gwei, uint48(dayStart - 5), uint48(dayStart + 80));
        (,,, uint128 balBefore,,,) = pm.getProject(idA);
        (, uint112 senderBefore) = pm.getSenderSpend(idA, address(acct));
        _run(opA);
        (,,, uint128 balAfter,, uint112 spentAfterA,) = pm.getProject(idA);
        (, uint112 senderAfter) = pm.getSenderSpend(idA, address(acct));
        uint256 charged = balBefore - balAfter;
        assertEq(uint256(spentAfterA) - uint256(spentAfterB), charged, "project counter must track real spend");
        assertEq(uint256(senderAfter) - uint256(senderBefore), charged, "sender counter must track real spend");
    }

    /*//////////////////////////////////////////////////////////////////////////
                    SIGNATURE FORMAT (I-1) AND FEE CAP (M-2b / L-4)
    //////////////////////////////////////////////////////////////////////////*/

    function test_RealEP_64ByteSignature_IsRejected() public {
        PackedUserOperation memory op65 = _op(_burnCall(), idA, 100_000);
        bytes memory pd = op65.paymasterAndData;
        bytes memory prefix = new bytes(97);
        for (uint256 i = 0; i < 97; i++) {
            prefix[i] = pd[i];
        }
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(pd, add(32, 97)))
            s := mload(add(pd, add(32, 129)))
            v := byte(0, mload(add(pd, add(32, 161))))
        }
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        op65.paymasterAndData = bytes.concat(prefix, abi.encodePacked(r, vs));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op65;
        vm.prank(bundler, bundler);
        vm.expectRevert(); // AA33 wrapping PaymasterSignatureLengthInvalid
        ep.handleOps{ gas: 5_000_000 }(ops, beneficiary);
    }

    function test_RealEP_FeeAboveCap_FailsValidation_BelowCap_Passes() public {
        // signer-approved, but maxFeePerGas > the on-chain cap: the EntryPoint rejects the op (AA33)
        PackedUserOperation memory bad = _opFull(
            address(acct), _burnCall(), idA, 100_000, DEFAULT_FEE_CAP + 1, uint48(block.timestamp), uint48(block.timestamp + 90)
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = bad;
        vm.prank(bundler, bundler);
        vm.expectRevert();
        ep.handleOps{ gas: 5_000_000 }(ops, beneficiary);

        PackedUserOperation memory good = _opFull(
            address(acct), _burnCall(), idA, 100_000, DEFAULT_FEE_CAP, uint48(block.timestamp), uint48(block.timestamp + 90)
        );
        _run(good);
    }

    function test_RealEP_ProjectCanSetOwnFeeCap() public {
        vm.prank(alice);
        pm.setMaxFeePerGas(idA, 3 gwei);
        assertEq(pm.effectiveMaxFeePerGas(idA), 3 gwei);
        assertEq(pm.effectiveMaxFeePerGas(idV), DEFAULT_FEE_CAP);
        PackedUserOperation memory bad = _opFull(
            address(acct), _burnCall(), idA, 100_000, 4 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = bad;
        vm.prank(bundler, bundler);
        vm.expectRevert();
        ep.handleOps{ gas: 5_000_000 }(ops, beneficiary);
        _run(_opFull(address(acct), _burnCall(), idA, 100_000, 3 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)));
    }

    /*//////////////////////////////////////////////////////////////////////////
                       ACCOUNT CODEHASH RESTRICTION (L-2)
    //////////////////////////////////////////////////////////////////////////*/

    function test_RealEP_ImpostorKernelAccount_PassesAllowlistByDefault_ResidualRisk() public {
        RealEpImpostorAccount fake = new RealEpImpostorAccount{ value: 100 ether }(address(ep));
        // No codehash restriction: a contract faking the Kernel execute selector is sponsored (documented residual risk).
        _run(_opFull(address(fake), _burnCall(), idA, 100_000, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)));
    }

    function test_RealEP_CodehashRestriction_BlocksImpostor_AllowsListedAccount() public {
        RealEpImpostorAccount fake = new RealEpImpostorAccount{ value: 100 ether }(address(ep));
        vm.prank(alice);
        pm.setRequiredAccountCodehash(idA, address(acct).codehash);
        assertEq(pm.requiredAccountCodehash(idA), address(acct).codehash);

        PackedUserOperation memory bad = _opFull(
            address(fake), _burnCall(), idA, 100_000, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)
        );
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = bad;
        vm.prank(bundler, bundler);
        vm.expectRevert();
        ep.handleOps{ gas: 5_000_000 }(ops, beneficiary);

        _run(_op(_burnCall(), idA, 100_000)); // the real account (listed codehash) still works
        // the restriction is per sponsor: the victim project is unaffected
        _run(_opFull(address(fake), _burnCall(), idV, 100_000, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)));

        // clearing the pin turns the restriction off again
        vm.prank(alice);
        pm.setRequiredAccountCodehash(idA, bytes32(0));
        _run(_opFull(address(fake), _burnCall(), idA, 100_000, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)));
    }

    /*//////////////////////////////////////////////////////////////////////////
        REVIEW 3 (2026-10) REGRESSIONS: L-1 (sender limit fails closed), L-6 (postOp snapshot)
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev Audit C's PoC test_C_PoC_ProjectWithoutSenderLimit_NoPerWalletBound, adapted so the attack fails: a
    /// project with no per-sender limit is no longer sponsorable (spec 7a: "required > 0"). Real EntryPoint.
    function test_RealEP_Review3_L1_ProjectWithoutSenderLimit_FailsClosed() public {
        address carol = makeAddr("carol");
        PM.Claim memory c = _claimStruct(pm, SIGNER_KEY, "carol-app", carol, block.timestamp + 1 hours);
        bytes32 id = pm.claimProject(c);
        address[] memory t = new address[](1);
        t[0] = address(app);
        vm.deal(carol, 10 ether);
        vm.startPrank(carol);
        pm.setTargets(id, t, true);
        pm.setDailyLimit(id, uint112(_maxCost(3_000_000, 10 gwei) * 2));
        pm.depositFor{ value: 5 ether }(id);
        vm.stopPrank();
        (,, uint112 sdl,,,,) = pm.getProject(id);
        assertEq(sdl, 0, "senderDailyLimit starts at 0");

        PackedUserOperation memory op = _opFull(address(acct), _burnCall(), id, 3_000_000, 10 gwei, uint48(block.timestamp), uint48(block.timestamp + 90));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        vm.expectRevert(); // AA33 wrapping ZeroDailyLimit
        ep.handleOps{ gas: 5_000_000 }(ops, beneficiary);
        vm.prank(address(ep), bundler);
        vm.expectRevert(PM.ZeroDailyLimit.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), _maxCost(3_000_000, 10 gwei));
        (,,, uint128 bal,,,) = pm.getProject(id);
        assertEq(bal, 5 ether, "nothing was spent");

        // with a per-wallet limit the same wallet is bounded to one worst-case op per day
        vm.prank(carol);
        pm.setSenderDailyLimit(id, uint112(_maxCost(3_000_000, 10 gwei)));
        _run(_opFull(address(acct), _burnCall(), id, 3_000_000, 10 gwei, uint48(block.timestamp), uint48(block.timestamp + 90)));
        (, uint112 spent) = pm.getSenderSpend(id, address(acct));
        assertGt(spent, 0, "the per-wallet counter is used");
    }

    function _mkSelfOwned(string memory appId) internal returns (bytes32 id) {
        PM.Claim memory c = _claimStruct(pm, SIGNER_KEY, appId, address(acct), block.timestamp + 1 hours);
        id = pm.claimProject(c);
        address[] memory t = new address[](2);
        t[0] = address(app);
        t[1] = address(pm);
        vm.startPrank(address(acct));
        pm.setTargets(id, t, true);
        pm.setDailyLimit(id, 10_000 ether);
        pm.setSenderDailyLimit(id, 500 ether);
        vm.stopPrank();
        pm.depositFor{ value: 500 ether }(id);
    }

    /// @dev Audit A's restore + flip attack (F1), adapted. The op's own execution (1) changes the project's
    /// senderDailyLimit and (2) re-credits its reservation (restoring `balance` and `totalLiabilities`), which is
    /// the worst case for postOp's own gas. With the L-6 snapshot postOp reads neither `postOpOverheadGas` nor
    /// `senderDailyLimit`, and the charge must still cover EntryPoint's true debit at the overhead FLOOR (set cold in
    /// setUp).
    function testFuzz_RealEP_Review3_L6_RestoreAndChangeSenderLimit_AtFloor_Solvent(uint128 callGas) public {
        callGas = uint128(bound(callGas, 60_000, 800_000));
        bytes32 id = _mkSelfOwned("self-app");
        uint256 mc = _maxCost(callGas, 2 gwei);
        PM.Execution[] memory ex = new PM.Execution[](2);
        ex[0] = PM.Execution({
            target: address(pm), value: 0, callData: abi.encodeCall(PM.setSenderDailyLimit, (id, uint112(1_000 ether)))
        });
        ex[1] = PM.Execution({ target: address(pm), value: mc, callData: abi.encodeCall(PM.depositFor, (id)) });
        bytes memory callData = abi.encodeWithSelector(0xe9ae5c53, bytes32(bytes1(0x01)), abi.encode(ex));
        PackedUserOperation memory op =
            _opFull(address(acct), callData, id, callGas, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90));
        (uint256 epDebit, uint256 ledgerDebit) = _runAndDiff(op, mc);
        assertGe(ledgerDebit, epDebit, "INSOLVENT: ledger charge < EntryPoint debit");
        (,, uint112 sl,,,,) = pm.getProject(id);
        assertEq(sl, 1_000 ether, "the limit change inside the op took effect");
    }

    /*//////////////////////////////////////////////////////////////////////////
        DELTA REVIEW (2026-10-02) REGRESSIONS: M1, L2, L3 and the cheap leads
    //////////////////////////////////////////////////////////////////////////*/

    address internal attacker = makeAddr("attacker");

    /// @dev like _opFull but with a caller-chosen modeByte (validity window = now .. now+90).
    function _opMode(bytes memory callData, bytes32 sponsor, uint8 modeByte)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op.sender = address(acct);
        op.nonce = ep.getNonce(address(acct), 0);
        op.callData = callData;
        op.accountGasLimits = _pack(VER_GAS, 3_000_000);
        op.preVerificationGas = PVG;
        op.gasFees = _pack(10 gwei, 10 gwei);
        bytes memory prefix = abi.encodePacked(
            address(pm), PM_VER, PM_POST, modeByte, uint48(block.timestamp + 90), uint48(block.timestamp), sponsor
        );
        op.paymasterAndData = bytes.concat(prefix, new bytes(65));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", pm.getHash(1, op)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        op.paymasterAndData = bytes.concat(prefix, abi.encodePacked(r, s, v));
    }

    /// @dev M1 regression (was the PoC test_PoC_SignerModeBit_BypassesBundlerGate_AndPaysAttacker): a signer-chosen
    /// modeByte can no longer switch the tx.origin bundler gate off, so a self-bundling attacker is never paid.
    function test_Delta_M1_ModeBitCannotDisableBundlerGate_AttackerNotPaid() public {
        bytes32 ghost = pm.projectIdOf("ghost-app");
        vm.deal(address(this), 1_000 ether);
        pm.depositFor{ value: 500 ether }(ghost); // unclaimed project funded by a depositor
        // the (rogue) signer attests for the attacker, who claims and configures the project
        PM.Claim memory c = _claimStruct(pm, SIGNER_KEY, "ghost-app", attacker, block.timestamp + 1 hours);
        pm.claimProject(c); // funded: pending for the admin delay (review 3, M-1)
        _finishClaim(pm, ghost);
        vm.startPrank(attacker);
        address[] memory t = new address[](1);
        t[0] = address(app);
        pm.setTargets(ghost, t, true);
        pm.setDailyLimit(ghost, 1_000 ether);
        pm.setSenderDailyLimit(ghost, 1_000 ether);
        pm.setMaxFeePerGas(ghost, 10 gwei);
        vm.stopPrank();
        assertFalse(pm.isBundlerAllowed(attacker));

        bytes memory burn = _single(address(app), 0, abi.encodeCall(RealEpGasBurner.burn, (60)));
        uint256 attackerBefore = attacker.balance;
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        // the gate is on for 0x02 and every other mode byte is rejected outright
        uint8[5] memory bytesToTry = [0x02, 0x03, 0x00, 0x01, 0x04];
        for (uint256 i = 0; i < bytesToTry.length; i++) {
            ops[0] = _opMode(burn, ghost, bytesToTry[i]);
            vm.prank(attacker, attacker);
            vm.expectRevert();
            ep.handleOps{ gas: 8_000_000 }(ops, payable(attacker));
        }
        assertEq(attacker.balance, attackerBefore, "the attacker was never paid");

        // the exact reverts, called as the EntryPoint would
        PackedUserOperation memory op3 = _opMode(burn, ghost, 0x03);
        vm.prank(address(ep), attacker);
        vm.expectRevert(PM.PaymasterModeInvalid.selector);
        pm.validatePaymasterUserOp(op3, bytes32(0), 1 ether);
        PackedUserOperation memory op2 = _opMode(burn, ghost, 0x02);
        vm.prank(address(ep), attacker);
        vm.expectRevert(abi.encodeWithSelector(PM.BundlerNotAllowed.selector, attacker));
        pm.validatePaymasterUserOp(op2, bytes32(0), 1 ether);
    }

    function testFuzz_Delta_M1_OnlyModeByte02IsAccepted(uint8 modeByte) public {
        vm.assume(modeByte != 0x02);
        PackedUserOperation memory op = _opMode(_burnCall(), idA, modeByte);
        vm.prank(address(ep), bundler); // even an allowlisted bundler cannot use another mode byte
        vm.expectRevert(PM.PaymasterModeInvalid.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 1 ether);
    }

    /// @dev L2 regression: the claim sets NO configuration, so a relayer cannot choose targets or limits; the project is
    /// unspendable until the attested owner configures it.
    function test_Delta_L2_ClaimSetsNoConfig_RelayerChoosesNothing() public {
        address realOwner = makeAddr("realOwner");
        PM.Claim memory c = _claimStruct(pm, SIGNER_KEY, "relay-app", realOwner, block.timestamp + 1 hours);
        vm.prank(attacker); // a relayer submits the owner's attestation
        bytes32 id = pm.claimProject(c);
        (address o,, uint112 sl,, uint112 dl,,) = pm.getProject(id);
        assertEq(o, realOwner);
        assertEq(dl, 0, "no daily limit chosen by the relayer");
        assertEq(sl, 0);
        assertFalse(pm.isTargetAllowed(id, address(app)));
        // nothing is spendable until the owner configures it (even with funds and a valid signer approval)
        pm.depositFor{ value: 100 ether }(id);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _opFull(address(acct), _burnCall(), id, 100_000, 2 gwei, uint48(block.timestamp), uint48(block.timestamp + 90));
        vm.prank(bundler, bundler);
        vm.expectRevert();
        ep.handleOps{ gas: 5_000_000 }(ops, beneficiary);
    }

    function test_Delta_ClaimDeadlineCappedAtOneHour() public {
        PM.Claim memory far = _claimStruct(pm, SIGNER_KEY, "far-app", attacker, block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.ClaimDeadlineTooFar.selector, far.deadline));
        pm.claimProject(far);
        PM.Claim memory ok = _claimStruct(pm, SIGNER_KEY, "far-app", attacker, block.timestamp + 1 hours);
        pm.claimProject(ok);
        PM.Claim memory far2 = _claimStruct(pm, SIGNER_KEY, "alice-app", attacker, block.timestamp + 365 days);
        vm.expectRevert(abi.encodeWithSelector(PM.ClaimDeadlineTooFar.selector, far2.deadline));
        pm.reclaimProject(far2);
    }

    function test_Delta_AdminChangeDelay_UpperBound() public {
        address[] memory sigs = new address[](1);
        sigs[0] = vm.addr(SIGNER_KEY);
        new PM(address(ep), address(this), address(this), sigs, sigs, 30 days, 20_000, DEFAULT_FEE_CAP);
        vm.expectRevert(PM.DelayTooLong.selector);
        new PM(address(ep), address(this), address(this), sigs, sigs, 30 days + 1, 20_000, DEFAULT_FEE_CAP);
        vm.expectRevert(PM.DelayTooLong.selector);
        new PM(address(ep), address(this), address(this), sigs, sigs, type(uint32).max, 20_000, DEFAULT_FEE_CAP);
    }

    /// @dev L3 regression: a voluntary transfer clears a pending re-claim (it can never execute afterwards).
    function test_Delta_L3_VoluntaryTransferClearsPendingReclaim() public {
        address carol = makeAddr("carol");
        address bob = makeAddr("bob");
        pm.reclaimProject(_claimStruct(pm, SIGNER_KEY, "alice-app", carol, block.timestamp + 1 hours));
        vm.prank(alice);
        pm.proposeProjectOwner(idA, bob);
        vm.prank(bob);
        pm.acceptProjectOwnership(idA);
        (address pending,,) = pm.pendingReclaim(idA);
        assertEq(pending, address(0), "pending re-claim cleared by the transfer");
        vm.warp(block.timestamp + 2 days + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.NoPendingReclaim.selector, idA));
        pm.executeReclaim(idA);
        (address o,,,,,,) = pm.getProject(idA);
        assertEq(o, bob);
    }

    /// @dev L3 regression: a re-claim proposed before its signer was removed stays dead when that signer is re-added.
    function test_Delta_L3_PendingReclaim_DoesNotReviveWhenSignerReAdded() public {
        address signerAddr = vm.addr(SIGNER_KEY);
        address carol = makeAddr("carol");
        pm.reclaimProject(_claimStruct(pm, SIGNER_KEY, "alice-app", carol, block.timestamp + 1 hours));
        pm.removeSigner(signerAddr);
        assertEq(pm.signerRemovedAt(signerAddr), block.timestamp);
        vm.warp(block.timestamp + 2 days + 1);
        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimSignerRemoved.selector, signerAddr));
        pm.executeReclaim(idA);
        // re-add through the timelock
        pm.proposeAdminChange(1, signerAddr);
        vm.warp(block.timestamp + 2 days + 1);
        pm.executeAdminChange(1, signerAddr);
        assertTrue(pm.signers(signerAddr));
        vm.expectRevert(abi.encodeWithSelector(PM.ReclaimSignerRemoved.selector, signerAddr));
        pm.executeReclaim(idA);
        (address o,,,,,,) = pm.getProject(idA);
        assertEq(o, alice, "the stale re-claim never executed");
        // a FRESH re-claim attested after the re-add works normally
        pm.reclaimProject(_claimStruct(pm, SIGNER_KEY, "alice-app", carol, block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 days);
        pm.executeReclaim(idA);
        (o,,,,,,) = pm.getProject(idA);
        assertEq(o, carol);
    }
}
