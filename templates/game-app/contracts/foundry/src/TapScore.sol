// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TapScore
/// @notice Minimal gameplay contract for the PEPU session-signer template.
/// @dev Deliberately tiny. The interesting part of this template is not the
///      game — it is that `tap()` is called repeatedly by a scoped session
///      signer with no wallet popup per call.
///
///      Two properties matter for the session policy in
///      `lib/session-policy.ts` and must not change casually:
///
///        1. `tap()` takes no arguments, so the policy can match on the
///           function selector alone with nothing left unconstrained.
///        2. `tap()` is NOT payable, so the policy's "value must be 0x0"
///           condition can never be satisfied by a value-bearing call.
///           Making this payable would widen what a granted signer can do.
contract TapScore {
    /// @notice Total taps recorded per player address.
    mapping(address => uint256) public scores;

    /// @notice Emitted on every successful tap.
    /// @param player The address whose score increased.
    /// @param newScore The player's score after this tap.
    event Tapped(address indexed player, uint256 newScore);

    /// @notice Record one tap for `msg.sender`.
    /// @dev Non-payable and argument-free by design — see the contract-level
    ///      note. Unchecked increment is safe: reaching 2^256-1 taps is not
    ///      reachable, and the saving keeps per-move gas low, which matters
    ///      when a player makes many moves in a session.
    function tap() external {
        unchecked {
            uint256 newScore = scores[msg.sender] + 1;
            scores[msg.sender] = newScore;
            emit Tapped(msg.sender, newScore);
        }
    }
}
