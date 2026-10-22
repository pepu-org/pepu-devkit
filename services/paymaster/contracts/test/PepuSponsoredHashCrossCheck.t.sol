// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { PepuSponsoredPaymasterV7 } from "../src/PepuSponsoredPaymasterV7.sol";

/// @notice The v2 counterpart of PaymasterHashCrossCheck.t.sol. Proves the contract's `getHash(1, userOp)` agrees,
/// byte for byte, with the policy service's `buildSponsoredHashPrefix` + `computeUserOpHash` + `computeFinalHash`
/// (policy-service/test/sponsorship/paymasterData.test.ts asserts the SAME frozen constant).
///
/// Derivation: the TypeScript side was computed first from the shipped modules; this Solidity test was written
/// against that constant and passes only if the contract independently produces the same bytes. The signed prefix
/// is 97 bytes: paymaster(20) | pmVerificationGas(16) | pmPostOpGas(16) | modeByte 0x02 | validUntil(6) |
/// validAfter(6) | sponsorId(32). Changing either side's layout breaks its own copy of this vector.
contract PepuSponsoredHashCrossCheckTest is Test {
    bytes32 internal constant EXPECTED_GOLDEN_HASH = 0x894082470c2e9df7c6c444d50734c8360c7d92510512b57a3e1a16bf07562258;

    function test_GetHash_MatchesPolicyServiceGoldenVector() public {
        vm.chainId(31337);
        address[] memory signers = new address[](1);
        signers[0] = address(0xAAAA);
        PepuSponsoredPaymasterV7 pm =
            new PepuSponsoredPaymasterV7(address(0xE0000000), address(0xB1), address(0xB2), signers, signers, 2 days, 18_000, 10 gwei);

        PackedUserOperation memory userOp;
        userOp.sender = 0x1111111111111111111111111111111111111111;
        userOp.nonce = 7;
        userOp.initCode = bytes("");
        userOp.callData = hex"1234567890abcdef1234567890abcdef12345678";
        userOp.accountGasLimits = bytes32((uint256(111_111) << 128) | uint256(222_222));
        userOp.preVerificationGas = 50_000;
        userOp.gasFees = bytes32((uint256(1_000_000_000) << 128) | uint256(2_000_000_000));

        bytes memory prefix = abi.encodePacked(
            address(0x1234),
            uint128(3_000_000),
            uint128(1_000_000),
            uint8(0x02),
            uint48(2_000_000_000),
            uint48(1_000_000_000),
            bytes32(uint256(0xabcd))
        );
        require(prefix.length == 97, "vector bug: prefix must be 97 bytes");
        userOp.paymasterAndData = prefix; // getHash reads only paymasterAndData[0:97]

        assertEq(
            pm.getHash(1, userOp),
            EXPECTED_GOLDEN_HASH,
            "contract getHash() disagrees with the policy service for the frozen vector"
        );
    }

    /// @dev Golden vector for the EIP-712 `ProjectClaim` attestation. The signature was produced by the policy
    /// service's code path (viem `signTypedData`, key = anvil #0) for chainId 97741 and a paymaster at 0x...0a55, and
    /// is frozen in policy-service/test/sponsorship/projectVerify.test.ts too. This proves the contract accepts what
    /// the service signs (domain, type hash and field order agree).
    function test_ClaimAttestation_FromPolicyService_IsAccepted() public {
        vm.chainId(97741);
        address pmAddr = address(0x0a55);
        address[] memory signers = new address[](1);
        signers[0] = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        deployCodeTo(
            "PepuSponsoredPaymasterV7.sol:PepuSponsoredPaymasterV7",
            abi.encode(address(0xE0000000), address(0xB1), address(0xB2), signers, signers, uint32(2 days), uint32(18_000), uint128(10 gwei)),
            pmAddr
        );
        PepuSponsoredPaymasterV7 pm = PepuSponsoredPaymasterV7(pmAddr);
        bytes memory sig =
            hex"764f792a55e35a204ed6c974e7f6bf6c7dea3d9cccb335645e5155dca5b9ed1f482647906ebefae1d0267600b773d3f66af1c2ad5ca9e77ffd417c95779741401b";
        address newOwner = address(0xa1);
        vm.warp(1_800_000_000);
        PepuSponsoredPaymasterV7.Claim memory c =
            PepuSponsoredPaymasterV7.Claim("cm-vector-app", newOwner, 42, 1_800_003_600, sig);
        bytes32 id = pm.claimProject(c);
        assertEq(id, keccak256(bytes("cm-vector-app")));
        (address o,,,,,,) = pm.getProject(id);
        assertEq(o, newOwner);
    }
}
