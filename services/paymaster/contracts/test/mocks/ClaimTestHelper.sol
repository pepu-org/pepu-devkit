// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PepuSponsoredPaymasterV7 as PM } from "../../src/PepuSponsoredPaymasterV7.sol";

/// @dev Builds and submits EIP-712 `ProjectClaim` attestations signed by a (test) policy signer.
abstract contract ClaimTestHelper is Test {
    uint256 internal claimNonceCounter;

    function _claimStruct(PM pm_, uint256 key, string memory appId, address newOwner, uint256 deadline)
        internal
        returns (PM.Claim memory c)
    {
        c.appId = appId;
        c.newOwner = newOwner;
        c.nonce = ++claimNonceCounter;
        c.deadline = deadline;
        bytes32 digest = pm_.claimDigest(appId, newOwner, c.nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        c.signature = abi.encodePacked(r, s, v);
    }

    /// @dev A first claim of a FUNDED project is pending (review 3, M-1): wait out the delay and execute it.
    function _finishClaim(PM pm_, bytes32 id) internal {
        (address o,,,,,,) = pm_.getProject(id);
        if (o != address(0)) return;
        (, uint48 executableAt,) = pm_.pendingReclaim(id);
        vm.warp(executableAt);
        pm_.executeReclaim(id);
    }

    /// @dev First claim for `owner_` (attested by `key`) with initial settings, then an optional deposit by `owner_`.
    function _claimAs(
        PM pm_,
        uint256 key,
        address owner_,
        string memory appId,
        address[] memory targets,
        uint112 dailyLimit,
        uint112 senderLimit,
        uint256 deposit
    )
        internal
        returns (bytes32 id)
    {
        PM.Claim memory c = _claimStruct(pm_, key, appId, owner_, block.timestamp + 1 hours);
        id = pm_.claimProject(c);
        _finishClaim(pm_, id);
        // the claim sets NO configuration (delta review L2): the owner configures the project afterwards
        vm.startPrank(owner_);
        pm_.setTargets(id, targets, true);
        pm_.setDailyLimit(id, dailyLimit);
        pm_.setSenderDailyLimit(id, senderLimit);
        if (deposit > 0) pm_.depositFor{ value: deposit }(id);
        vm.stopPrank();
    }
}
