// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Simplified HTS controller used purely for unit tests.
contract MockUsdController is Ownable {
    uint8 public immutable usdDecimals;
    address public treasury;

    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);
    event TreasuryUpdated(address indexed treasury);

    constructor(uint8 decimals_) {
        usdDecimals = decimals_;
        treasury = msg.sender;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function mintTo(address to, uint64 amount) external onlyOwner {
        emit Minted(to, amount);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        emit Burned(amount);
    }
}
