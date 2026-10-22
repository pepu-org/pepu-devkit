// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title MockEntryPoint
/// @notice Test-only stub. Not vendored from upstream, not part of the deployed system.
/// @dev We only vendor `IEntryPoint`'s interface (from account-abstraction-v7) for compilation of
/// `PepuVerifyingPaymasterV7`, not the real `EntryPoint.sol` implementation. `_requireFromEntryPoint` tests use the
/// real EntryPoint address (0x0000000071727De22E5E9d8BAf0edAc6f37da032) directly via `vm.prank`, which does not
/// require any code to exist at that address. But `BasePaymaster`'s deposit-management functions (`deposit`,
/// `withdrawTo`, `getDeposit`, `addStake`, `unlockStake`, `withdrawStake`) actually call out to the EntryPoint
/// contract, so to test those for real (rather than skip them) this minimal stub is `vm.etch`'d onto that address,
/// implementing just enough of IEntryPoint's surface for BasePaymaster's calls to behave predictably.
contract MockEntryPoint {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public stakeOf;

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "MockEntryPoint: insufficient deposit");
        balanceOf[msg.sender] -= amount;
        (bool ok,) = withdrawAddress.call{ value: amount }("");
        require(ok, "MockEntryPoint: withdraw transfer failed");
    }

    function addStake(uint32 /* unstakeDelaySec */ ) external payable {
        stakeOf[msg.sender] += msg.value;
    }

    function unlockStake() external { }

    function withdrawStake(address payable withdrawAddress) external {
        uint256 amount = stakeOf[msg.sender];
        stakeOf[msg.sender] = 0;
        (bool ok,) = withdrawAddress.call{ value: amount }("");
        require(ok, "MockEntryPoint: stake withdraw transfer failed");
    }

    receive() external payable { }
}
