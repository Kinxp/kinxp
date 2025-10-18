// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Simplified stand-in for the UsdHtsController contract, used in unit tests.
 */
contract MockUsdController {
    address public owner;
    uint8 public usdDecimals;

    address public lastMintTo;
    uint64 public lastMintAmount;
    uint64 public lastBurnAmount;

    event TokenCreated(address indexed token, uint8 decimals);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);

    constructor(uint8 decimals_) {
        owner = msg.sender;
        usdDecimals = decimals_;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function mintTo(address to, uint64 amount) external onlyOwner {
        lastMintTo = to;
        lastMintAmount = amount;
        emit Minted(to, amount);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        lastBurnAmount = amount;
        emit Burned(amount);
    }
}
