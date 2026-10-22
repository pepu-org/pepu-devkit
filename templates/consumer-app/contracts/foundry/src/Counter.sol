// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The smallest possible example contract for deploying and
/// verifying something real on Pepe Unchained V2. Replace this with your
/// own contract once you've confirmed the deploy/verify loop works.
contract Counter {
    uint256 public count;

    function increment() external {
        count += 1;
    }
}
