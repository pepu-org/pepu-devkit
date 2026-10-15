# Example ERC-20 and ERC-721 contracts

Minimal, complete starting points built on OpenZeppelin Contracts v5.x — adapt freely, but don't
strip the access control (`Ownable`) without replacing it with something equally deliberate; an
unrestricted `mint()` on a "real" token is a common, expensive mistake.

## ERC-20: `src/MyToken.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyToken is ERC20, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Owner-only mint for cases where supply isn't fixed at deploy.
    /// Remove this function entirely if you want a fixed-supply token —
    /// don't leave it in "just in case" without a real reason.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

`initialSupply` is denominated in the token's smallest unit — for the default 18 decimals, `1`
whole token is `1000000000000000000`. Use `cast --to-wei 1000000 ether` (or the token's actual
decimals if not 18) to compute a human-scale supply correctly rather than counting zeros by hand.

## ERC-721: `src/MyNft.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MyNft is ERC721, Ownable {
    uint256 private _nextTokenId;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {}

    /// @notice Owner-only mint. Open this up (remove onlyOwner, add payment
    /// logic) only once you've deliberately designed the mint mechanics —
    /// don't ship a public free-mint by accident.
    function safeMint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        // Replace with real metadata hosting (IPFS, Arweave, or your own
        // server) before minting anything real — this placeholder is not
        // production metadata.
        return string.concat("https://example.com/metadata/", _toString(tokenId));
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
```

`_requireOwned` and the constructor's `Ownable(msg.sender)` argument are OpenZeppelin Contracts v5
APIs — v4's `Ownable` took no constructor argument and used `_exists`/`ownerOf` directly instead of
`_requireOwned`. Check your installed OpenZeppelin version (`forge install` pins a specific tag;
confirm which one landed in `lib/openzeppelin-contracts`) before assuming this exact code compiles
against it unmodified.

## Constructor args for verification

Both contracts take constructor arguments, so `forge verify-contract` needs
`--constructor-args`, ABI-encoded:

```bash
# ERC-20
cast abi-encode "constructor(string,string,uint256)" "My Token" "MTK" 1000000000000000000000000

# ERC-721
cast abi-encode "constructor(string,string)" "My NFT" "MNFT"
```

Pass the output directly as the `--constructor-args` value in the verify command from SKILL.md.
Getting this wrong (wrong types, wrong order, wrong values) is the most common reason verification
fails even though the deploy itself succeeded — the verifier recompiles and needs to reproduce
byte-identical deployed bytecode, which includes the constructor arguments baked into the
deployment transaction.
