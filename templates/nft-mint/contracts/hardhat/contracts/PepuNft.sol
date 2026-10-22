// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PepuNft
/// @notice Minimal ERC-721 with a public mint, for the PEPU nft-mint starter
/// template. Uses OpenZeppelin's ERC721 + ERC721Enumerable + Ownable rather
/// than hand-rolled transfer/approval logic — those are the
/// security-sensitive parts of an NFT contract and this template inherits
/// them from an audited, industry-standard implementation instead of
/// reinventing them.
/// @dev Token ids start at 1. `mintPrice` is mutable by the owner (e.g. to
/// switch a launch from paid to free) but starts at whatever the deployer
/// passes into the constructor — 0 for a free mint.
contract PepuNft is ERC721, ERC721Enumerable, Ownable {
    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public mintPrice;
    string private _baseTokenURI;
    uint256 private _nextTokenId = 1;

    constructor(string memory baseURI_, uint256 mintPrice_)
        ERC721("Pepu Starter NFT", "PEPUNFT")
        Ownable(msg.sender)
    {
        _baseTokenURI = baseURI_;
        mintPrice = mintPrice_;
    }

    /// @notice Mint one token to the caller. Reverts once MAX_SUPPLY is
    /// reached or if not enough PEPU was sent.
    function mint() external payable returns (uint256 tokenId) {
        require(totalSupply() < MAX_SUPPLY, "PepuNft: sold out");
        require(msg.value >= mintPrice, "PepuNft: insufficient payment");
        tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
    }

    /// @notice Owner-only: sweep collected mint proceeds.
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    /// @notice Owner-only: change the mint price (e.g. free -> paid or back).
    function setMintPrice(uint256 newPrice) external onlyOwner {
        mintPrice = newPrice;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // --- Required overrides for multiple inheritance (OZ v5 pattern) ---

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 amount)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, amount);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
