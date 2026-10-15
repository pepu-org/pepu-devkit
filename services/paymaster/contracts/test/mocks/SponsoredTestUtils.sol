// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { PepuSponsoredPaymasterV7 } from "../../src/PepuSponsoredPaymasterV7.sol";
import { MockEntryPointSim } from "./MockEntryPointSim.sol";
import { ClaimTestHelper } from "./ClaimTestHelper.sol";

/// @dev Shared helpers: UserOp/paymasterAndData builders, Kernel callData encoders, bundle runner.
abstract contract SponsoredTestUtils is Test, ClaimTestHelper {
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint256 internal constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    bytes4 internal constant KERNEL_EXECUTE = 0xe9ae5c53;

    uint128 internal constant PM_VERIFICATION_GAS = 200_000;
    uint128 internal constant PM_POSTOP_GAS = 80_000;
    uint32 internal constant POSTOP_OVERHEAD = 20_000;
    uint128 internal constant DEFAULT_MAX_FEE = 10 gwei;

    PepuSponsoredPaymasterV7 internal pm;
    MockEntryPointSim internal ep;
    address internal bundler = makeAddr("bundler");
    address payable internal beneficiary = payable(makeAddr("beneficiary"));
    uint256 internal nonceCounter;

    struct OpSpec {
        address sender;
        bytes callData;
        bytes32 sponsorId;
        uint48 validUntil;
        uint48 validAfter;
        uint256 signerKey;
        uint128 postOpGas;
        uint128 callGas;
        uint128 maxFee;
    }

    function _deployPaymaster(address owner_, address manager_, uint32 delay) internal {
        address[] memory sigs = new address[](1);
        sigs[0] = vm.addr(SIGNER_KEY);
        address[] memory b = new address[](2);
        b[0] = bundler;
        b[1] = address(0);
        pm = new PepuSponsoredPaymasterV7(ENTRY_POINT, owner_, manager_, sigs, b, delay, POSTOP_OVERHEAD, DEFAULT_MAX_FEE);
        MockEntryPointSim mock = new MockEntryPointSim();
        vm.etch(ENTRY_POINT, address(mock).code);
        ep = MockEntryPointSim(payable(ENTRY_POINT));
    }

    /// @dev Signer-attested first claim by `owner_` plus an optional deposit from `owner_`.
    function _register(
        address owner_,
        string memory appId,
        address[] memory targets,
        uint112 dailyLimit,
        uint112 senderLimit,
        uint256 deposit
    )
        internal
        returns (bytes32)
    {
        return _claimAs(pm, SIGNER_KEY, owner_, appId, targets, dailyLimit, senderLimit, deposit);
    }

    function _pack128(uint128 hi, uint128 lo) internal pure returns (bytes32) {
        return bytes32((uint256(hi) << 128) | uint256(lo));
    }

    function _singleCall(address target) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(KERNEL_EXECUTE, bytes32(0), abi.encodePacked(target, uint256(0), hex"deadbeef"));
    }

    function _batchCall(address[] memory targets) internal pure returns (bytes memory) {
        PepuSponsoredPaymasterV7.Execution[] memory ex = new PepuSponsoredPaymasterV7.Execution[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            ex[i] = PepuSponsoredPaymasterV7.Execution({ target: targets[i], value: 0, callData: hex"01" });
        }
        return abi.encodeWithSelector(KERNEL_EXECUTE, bytes32(bytes1(0x01)), abi.encode(ex));
    }

    function _spec(address sender, bytes memory callData, bytes32 sponsorId) internal view returns (OpSpec memory s) {
        s.sender = sender;
        s.callData = callData;
        s.sponsorId = sponsorId;
        s.validUntil = uint48(block.timestamp + 90);
        s.validAfter = uint48(block.timestamp);
        s.signerKey = SIGNER_KEY;
        s.postOpGas = PM_POSTOP_GAS;
        s.callGas = 100_000;
        s.maxFee = 2 gwei;
    }

    function _buildOp(OpSpec memory s) internal returns (PackedUserOperation memory op) {
        op.sender = s.sender;
        op.nonce = ++nonceCounter;
        op.callData = s.callData;
        op.accountGasLimits = _pack128(100_000, s.callGas);
        op.preVerificationGas = 50_000;
        op.gasFees = _pack128(1 gwei, s.maxFee);
        bytes memory prefix = abi.encodePacked(
            address(pm), PM_VERIFICATION_GAS, s.postOpGas, uint8(0x02), s.validUntil, s.validAfter, s.sponsorId
        );
        op.paymasterAndData = bytes.concat(prefix, new bytes(65));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", pm.getHash(1, op)));
        (uint8 v, bytes32 r, bytes32 sv) = vm.sign(s.signerKey, digest);
        op.paymasterAndData = bytes.concat(prefix, abi.encodePacked(r, sv, v));
    }

    function _hashOf(PackedUserOperation memory op) internal pure returns (bytes32) {
        return keccak256(abi.encode(op.sender, op.nonce));
    }

    /// @dev Runs one op through the EntryPoint simulator as the allowlisted bundler.
    function _run(PackedUserOperation memory op, uint256 maxCost, uint256 actualCost, uint256 fee, bool reverted)
        internal
    {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        MockEntryPointSim.OpCost[] memory costs = new MockEntryPointSim.OpCost[](1);
        costs[0] = MockEntryPointSim.OpCost(maxCost, actualCost, reverted);
        bytes32[] memory hs = new bytes32[](1);
        hs[0] = _hashOf(op);
        vm.prank(bundler, bundler);
        ep.handleOps(ops, costs, hs, fee, beneficiary);
    }

    function _runBundle(
        PackedUserOperation[] memory ops,
        MockEntryPointSim.OpCost[] memory costs,
        uint256 fee
    )
        internal
    {
        bytes32[] memory hs = new bytes32[](ops.length);
        for (uint256 i = 0; i < ops.length; i++) {
            hs[i] = _hashOf(ops[i]);
        }
        vm.prank(bundler, bundler);
        ep.handleOps(ops, costs, hs, fee, beneficiary);
    }

    function _bal(bytes32 id) internal view returns (uint128 b) {
        (,,, b,,,) = pm.getProject(id);
    }

    function _spent(bytes32 id) internal view returns (uint112 s) {
        (,,,,, s,) = pm.getProject(id);
    }

    function _owner(bytes32 id) internal view returns (address o) {
        (o,,,,,,) = pm.getProject(id);
    }
}
