// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal stub LayerZero endpoint used exclusively in unit tests.
/// @dev The production contracts override all interactions with the endpoint,
/// so the mock only needs to expose the getters invoked by the helpers.
contract MockLzEndpoint {
    address public delegate;

    function nativeToken() external pure returns (address) {
        return address(0);
    }

    function lzToken() external pure returns (address) {
        return address(0);
    }

    function setDelegate(address _delegate) external {
        delegate = _delegate;
    }
}
