// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MathUtils
/// @notice Collection of fixed-point math helpers (WAD/RAY) and basis-point utilities.
/// @dev Inspired by the helpers used across Aave style lending markets. The contract
///      is intentionally small and dependency free so it can be linked into multiple
///      OApps without pulling in an external library.
library MathUtils {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;
    uint256 internal constant SECONDS_PER_YEAR = 365 days;

    /// @notice Multiplies two WAD fixed-point numbers (18 decimals).
    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 0;
        return (a * b) / WAD;
    }

    /// @notice Divides two WAD fixed-point numbers (18 decimals).
    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "DIV_BY_ZERO");
        return (a * WAD) / b;
    }

    /// @notice Multiplies two RAY fixed-point numbers (27 decimals).
    function rayMul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 0;
        return (a * b) / RAY;
    }

    /// @notice Divides two RAY fixed-point numbers (27 decimals).
    function rayDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b != 0, "DIV_BY_ZERO");
        return (a * RAY) / b;
    }

    /// @notice Converts an amount with `decimals` into RAY (27 decimals).
    function toRay(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 27) revert("DECIMALS_TOO_HIGH");
        return amount * 10 ** (27 - decimals);
    }

    /// @notice Converts a RAY value back into token units with `decimals`.
    function fromRay(uint256 amountRay, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 27) revert("DECIMALS_TOO_HIGH");
        return amountRay / 10 ** (27 - decimals);
    }

    /// @notice Converts a RAY value back into token units with `decimals`, rounding up.
    function fromRayCeil(uint256 amountRay, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 27) revert("DECIMALS_TOO_HIGH");
        uint256 divisor = 10 ** (27 - decimals);
        if (amountRay % divisor == 0) {
            return amountRay / divisor;
        } else {
            return (amountRay / divisor) + 1;
        }
    }

    /// @notice Converts a per-year rate expressed in basis points into a RAY rate.
    function bpsToRay(uint256 bps) internal pure returns (uint256) {
        // bps => percentage => multiply by 1e23 to convert to RAY (1e27 / 1e4).
        return bps * 1e23;
    }

    /// @notice Applies linear interest accrual on a RAY principal.
    /// @param principalRay Current principal in RAY.
    /// @param rateBps Annual interest rate in basis points.
    /// @param timeDeltaSeconds Time passed since last accrual.
    /// @return updatedPrincipalRay Principal after accrual in RAY.
    /// @return interestRay Interest accrued during the period in RAY.
    function accrueLinearInterest(
        uint256 principalRay,
        uint256 rateBps,
        uint256 timeDeltaSeconds
    ) internal pure returns (uint256 updatedPrincipalRay, uint256 interestRay) {
        if (principalRay == 0 || rateBps == 0 || timeDeltaSeconds == 0) {
            return (principalRay, 0);
        }

        uint256 rateRay = bpsToRay(rateBps);
        uint256 linearInterestRay = RAY + (rateRay * timeDeltaSeconds) / SECONDS_PER_YEAR;
        updatedPrincipalRay = rayMul(principalRay, linearInterestRay);
        interestRay = updatedPrincipalRay - principalRay;
    }

    /// @notice Utility to convert a basis point amount into raw units.
    function applyBps(uint256 amount, uint256 bps) internal pure returns (uint256) {
        if (amount == 0 || bps == 0) {
            return 0;
        }
        return (amount * bps) / 10_000;
    }
}
