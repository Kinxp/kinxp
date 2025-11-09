// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../libraries/MathUtils.sol";

/// @notice Simple harness contract that exposes MathUtils library helpers for testing.
contract MathUtilsHarness {
    using MathUtils for uint256;

    function wadMul(uint256 a, uint256 b) external pure returns (uint256) {
        return MathUtils.wadMul(a, b);
    }

    function wadDiv(uint256 a, uint256 b) external pure returns (uint256) {
        return MathUtils.wadDiv(a, b);
    }

    function rayMul(uint256 a, uint256 b) external pure returns (uint256) {
        return MathUtils.rayMul(a, b);
    }

    function rayDiv(uint256 a, uint256 b) external pure returns (uint256) {
        return MathUtils.rayDiv(a, b);
    }

    function toRay(uint256 amount, uint8 decimals) external pure returns (uint256) {
        return MathUtils.toRay(amount, decimals);
    }

    function fromRay(uint256 amountRay, uint8 decimals) external pure returns (uint256) {
        return MathUtils.fromRay(amountRay, decimals);
    }

    function bpsToRay(uint256 bps) external pure returns (uint256) {
        return MathUtils.bpsToRay(bps);
    }

    function accrueLinearInterest(uint256 principalRay, uint256 rateBps, uint256 timeDeltaSeconds)
        external
        pure
        returns (uint256 updatedPrincipalRay, uint256 interestRay)
    {
        return MathUtils.accrueLinearInterest(principalRay, rateBps, timeDeltaSeconds);
    }

    function applyBps(uint256 amount, uint256 bps) external pure returns (uint256) {
        return MathUtils.applyBps(amount, bps);
    }
}
