// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { PostOpMode } from "../../src/interfaces/PostOpMode.sol";

interface IPaymasterLike {
    function validatePaymasterUserOp(PackedUserOperation calldata, bytes32, uint256)
        external
        returns (bytes memory context, uint256 validationData);
    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 feePerGas) external;
}

/// @notice Test-only EntryPoint v0.7 simulator. Faithfully reproduces the parts of `handleOps` the paymaster's
/// accounting depends on, so the solvency invariant (`sum(ledger) <= deposit`) can be tested end to end:
///  - deposit/withdraw/stake, with real ETH held by this contract (so ETH conservation is checkable);
///  - for each op: deduct `requiredPrefund` (= maxCost) from the paymaster's deposit BEFORE calling
///    `validatePaymasterUserOp` (as v0.7 does), revert the whole bundle on validation revert or sigFailed;
///  - ALL validations first, then each op's postOp (v0.7 ordering);
///  - postOp is called with a gas limit; the final charge adds the gas ACTUALLY used by the postOp call times
///    the fee (measured with gasleft() around the call, like v0.7), capped at the prefund; if postOp reverts the
///    call's effects are rolled back, and the same final-charge/refund logic applies (v0.7 `postOpReverted` path);
///  - refund (prefund - finalCost) goes back to the paymaster's deposit; finalCost is paid to the beneficiary.
contract MockEntryPointSim {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public stakeOf;

    /// @dev Gas actually consumed by the last postOp call (for assertions).
    uint256 public lastPostOpGasUsed;
    bool public lastPostOpReverted;
    uint256 public lastFinalCost;
    uint256 internal innerGas;
    /// @dev Test knob: when non-zero, overrides the gas given to postOp (to force an out-of-gas postOp revert).
    uint256 public postOpGasCap;

    function setPostOpGasCap(uint256 cap) external {
        postOpGasCap = cap;
    }
    uint256 internal constant CALL_DISPATCH_ALLOWANCE = 3_000;

    struct OpCost {
        uint256 maxCost; // requiredPrefund
        uint256 actualGasCost; // actual cost before the postOp call
        bool opReverted; // simulate the user's call reverting (PostOpMode.opReverted)
    }

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "MockEP: insufficient deposit");
        balanceOf[msg.sender] -= amount;
        (bool ok,) = to.call{ value: amount }("");
        require(ok, "MockEP: transfer failed");
    }

    function addStake(uint32) external payable {
        stakeOf[msg.sender] += msg.value;
    }

    function unlockStake() external { }

    function withdrawStake(address payable to) external {
        uint256 a = stakeOf[msg.sender];
        stakeOf[msg.sender] = 0;
        (bool ok,) = to.call{ value: a }("");
        require(ok, "MockEP: stake transfer failed");
    }

    /// postOp gas limit comes from each op paymasterAndData.
    function handleOps(
        PackedUserOperation[] calldata ops,
        OpCost[] calldata costs,
        bytes32[] calldata userOpHashes,
        uint256 feePerGas,
        address payable beneficiary
    )
        external
    {
        require(ops.length == costs.length && ops.length == userOpHashes.length, "len");
        bytes[] memory contexts = new bytes[](ops.length);

        // ---- validation loop (all ops first, like v0.7) ----
        for (uint256 i = 0; i < ops.length; i++) {
            contexts[i] = _validateOp(ops[i], userOpHashes[i], costs[i].maxCost);
        }
        // ---- execution loop ----
        for (uint256 i = 0; i < ops.length; i++) {
            _executeOp(ops[i], contexts[i], costs[i], feePerGas, beneficiary);
        }
    }

    function _validateOp(PackedUserOperation calldata op, bytes32 hash, uint256 maxCost) internal returns (bytes memory) {
        address pm = address(bytes20(op.paymasterAndData[:20]));
        uint256 dep = balanceOf[pm];
        require(dep >= maxCost, "AA31 paymaster deposit too low");
        balanceOf[pm] = dep - maxCost; // v0.7 deducts the prefund BEFORE calling the paymaster
        (bytes memory ctx, uint256 vd) = IPaymasterLike(pm).validatePaymasterUserOp(op, hash, maxCost);
        require(uint160(vd) == 0, "AA34 signature error");
        return ctx;
    }

    function _executeOp(
        PackedUserOperation calldata op,
        bytes memory ctx,
        OpCost calldata cost,
        uint256 feePerGas,
        address payable beneficiary
    )
        internal
    {
        address pm = address(bytes20(op.paymasterAndData[:20]));
        uint256 finalCost = cost.actualGasCost;
        if (ctx.length > 0) {
            finalCost += _callPostOp(pm, op, ctx, cost, feePerGas);
        }
        // v0.7 also charges 10% of UNUSED execution gas (callGasLimit + postOpGasLimit - used) AFTER postOp runs.
        // Worst case modelled: the user call used no gas, so only the postOp gas counts as used.
        if (!penaltyDisabled) finalCost += _unusedGasPenaltyGas(op) * feePerGas;
        if (finalCost > cost.maxCost) finalCost = cost.maxCost;
        lastFinalCost = finalCost;
        balanceOf[pm] += cost.maxCost - finalCost; // refund to the paymaster deposit
        (bool paid,) = beneficiary.call{ value: finalCost }("");
        require(paid, "beneficiary transfer failed");
    }

    /// @dev returns the gas-cost component added by the postOp call (used gas x fee).
    function _callPostOp(address pm, PackedUserOperation calldata op, bytes memory ctx, OpCost calldata cost, uint256 feePerGas)
        internal
        returns (uint256)
    {
        uint128 limit = postOpGasCap != 0 ? uint128(postOpGasCap) : uint128(bytes16(op.paymasterAndData[36:52]));
        PostOpMode mode = cost.opReverted ? PostOpMode.opReverted : PostOpMode.opSucceeded;
        uint256 g0 = gasleft();
        bool ok;
        try this.callPostOp{ gas: limit + 5_000 }(pm, mode, ctx, cost.actualGasCost, feePerGas, limit) {
            ok = true;
        } catch {
            ok = false;
        }
        uint256 used = g0 - gasleft();
        // v0.7 calls postOp directly (no wrapper): on success use the gas measured INSIDE the wrapper around the
        // paymaster call plus a fixed dispatch allowance, not the wrapper-inflated figure.
        if (ok) used = innerGas + CALL_DISPATCH_ALLOWANCE;
        lastPostOpGasUsed = used;
        lastPostOpReverted = !ok;
        return used * feePerGas;
    }

    /// @dev Test knob: turn the unused-gas penalty off (to isolate other behaviour).
    bool public penaltyDisabled;

    function setPenaltyDisabled(bool d) external {
        penaltyDisabled = d;
    }

    function _unusedGasPenaltyGas(PackedUserOperation calldata op) internal view returns (uint256) {
        uint256 callGasLimit = uint128(uint256(op.accountGasLimits));
        uint256 postOpLimit = uint128(bytes16(op.paymasterAndData[36:52]));
        uint256 limit = callGasLimit + postOpLimit;
        uint256 used = lastPostOpGasUsed;
        if (limit <= used) return 0;
        return ((limit - used) * 10) / 100;
    }

    function callPostOp(address pm, PostOpMode mode, bytes calldata ctx, uint256 cost, uint256 fee, uint128 gasLimit)
        external
    {
        require(msg.sender == address(this), "self only");
        uint256 g = gasleft();
        IPaymasterLike(pm).postOp{ gas: gasLimit }(mode, ctx, cost, fee);
        innerGas = g - gasleft();
    }

    receive() external payable { }
}
