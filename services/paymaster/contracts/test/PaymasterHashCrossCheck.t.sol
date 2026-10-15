// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { PepuVerifyingPaymasterV7 } from "../src/PepuVerifyingPaymasterV7.sol";

/// @title PaymasterHashCrossCheckTest
/// @notice This is THE test that proves the on-chain contract and the off-chain policy service agree, byte for
/// byte, on what gets hashed and signed. See `policy-service/test/paymasterHashCrossCheck.test.ts` for the other
/// half of this pair — same fixed input vector, computed independently in TypeScript using the real, shipped
/// `paymasterData.ts` / `userOpHash.ts` modules (not a reimplementation), asserted against the exact same
/// `EXPECTED_GOLDEN_HASH` constant below.
///
/// @dev HOW THIS GOLDEN VECTOR WAS DERIVED (so it can be re-derived if intentionally changed):
///   1. This test's fixed `PackedUserOperation` + paymaster-config values were chosen once (arbitrary but fully
///      specified, so both languages can reproduce them exactly).
///   2. `paymaster.getHash(0, userOp)` was called against this vector on the Solidity side.
///   3. `computeUserOpHash` + `computeFinalHash` from `userOpHash.ts` (fed the identical vector via
///      `buildPaymasterHashPrefix` from `paymasterData.ts`) were called on the TypeScript side.
///   4. Both independently produced `0x1ed67e1dbe62fb3e76e1fb19b74cc649cdac16c7782ed62714643c9beb88b393`.
///   5. That value was then frozen as `EXPECTED_GOLDEN_HASH` in both test files. If either implementation's byte
///      layout, field order, or packing ever drifts, its own test fails against this frozen constant — the two
///      files never need to talk to each other or share a build step to catch drift.
///
/// @dev The "paymaster" field embedded in `paymasterAndData[0:20]` is NOT read from `address(this)` anywhere in
/// `_getHash` — it is just bytes the caller supplies. This test therefore uses an arbitrary fixed placeholder
/// address (`0x1234`) instead of the real deployed contract's address (which would depend on deployer nonce and
/// therefore not be reproducible as a hardcoded constant across environments/forge versions). This is intentional
/// and does not weaken the cross-check: `_getHash` hashes exactly the bytes it's given, regardless of whether they
/// happen to equal `address(this)`.
contract PaymasterHashCrossCheckTest is Test {
    bytes32 internal constant EXPECTED_GOLDEN_HASH =
        0x1ed67e1dbe62fb3e76e1fb19b74cc649cdac16c7782ed62714643c9beb88b393;

    function test_GetHash_MatchesPolicyServiceGoldenVector() public {
        // Fixed chain id -- must match the `chainId` argument passed to `computeFinalHash` in the TS test.
        vm.chainId(31337);

        address[] memory signers = new address[](1);
        signers[0] = address(0xAAAA);
        // entryPoint/owner/manager values are irrelevant to getHash's output (getHash never reads them) — fixed
        // placeholders only so the constructor call is valid.
        PepuVerifyingPaymasterV7 paymaster =
            new PepuVerifyingPaymasterV7(address(0xE0000000), address(0xB1), address(0xB2), signers);

        PackedUserOperation memory userOp;
        userOp.sender = 0x1111111111111111111111111111111111111111;
        userOp.nonce = 7;
        userOp.initCode = bytes(""); // keccak256("") is part of the hash
        userOp.callData = hex"1234567890abcdef1234567890abcdef12345678"; // arbitrary fixed bytes, opaque to getHash
        // accountGasLimits = verificationGasLimit(hi 16 bytes) || callGasLimit(lo 16 bytes) -- matches viem's
        // toPackedUserOperation packing, confirmed in userOpHash.ts's module doc comment.
        userOp.accountGasLimits = bytes32((uint256(111_111) << 128) | uint256(222_222));
        userOp.preVerificationGas = 50_000;
        // gasFees = maxPriorityFeePerGas(hi) || maxFeePerGas(lo), same packing convention.
        userOp.gasFees = bytes32((uint256(1_000_000_000) << 128) | uint256(2_000_000_000));

        address placeholderPaymaster = address(0x1234);
        uint128 pmVerificationGasLimit = 3_000_000;
        uint128 pmPostOpGasLimit = 1_000_000;
        uint8 modeByte = 0x00; // verifying mode (0) + allowAllBundlers=false (bit 0) -> always 0x00, per MODE_BYTE
            // in paymasterData.ts
        uint48 validUntil = 2_000_000_000;
        uint48 validAfter = 1_000_000_000;

        bytes memory prefix = abi.encodePacked(
            placeholderPaymaster, pmVerificationGasLimit, pmPostOpGasLimit, modeByte, validUntil, validAfter
        );
        require(prefix.length == 65, "test vector bug: prefix must be exactly 65 bytes");
        // getHash only ever reads paymasterAndData[0:65] (see _getHash) — no signature bytes needed to call it.
        userOp.paymasterAndData = prefix;

        bytes32 hash = paymaster.getHash(0, userOp);

        assertEq(
            hash,
            EXPECTED_GOLDEN_HASH,
            "contract's getHash() no longer agrees with the policy service's TS hash implementation for this fixed "
            "vector -- see this file's NatSpec and policy-service/test/paymasterHashCrossCheck.test.ts before "
            "changing either side"
        );
    }
}
