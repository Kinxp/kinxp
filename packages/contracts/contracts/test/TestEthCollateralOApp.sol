// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../eth/EthCollateralOApp.sol";

/// @notice Test harness exposing internal helpers from EthCollateralOApp.
contract TestEthCollateralOApp is EthCollateralOApp {
    uint256 private stubNativeFee;
    uint256 private lastNativeFee;
    bool private _lzCalled;
    bytes private _lastPayload;
    uint32 private _lastDstEid;
    address private _lastRefund;

    constructor(address endpoint) EthCollateralOApp(endpoint, keccak256("ETH-hUSD")) {}

    function setStubFee(uint256 fee) external {
        stubNativeFee = fee;
    }

    function forceSetHederaEid(uint32 eid) external {
        hederaEid = eid;
    }

    function forceMarkRepaid(bytes32 orderId) external {
        Order storage o = orders[orderId];
        o.repaid = true;
    }

    function lastLzSendCalled() external view returns (bool) {
        return _lzCalled;
    }

    function lastLzPayload() external view returns (bytes memory) {
        return _lastPayload;
    }

    function lastLzDstEid() external view returns (uint32) {
        return _lastDstEid;
    }

    function lastLzRefundAddress() external view returns (address) {
        return _lastRefund;
    }

    function lastLzNativeFee() external view returns (uint256) {
        return lastNativeFee;
    }

    function _quote(
        uint32,
        bytes memory,
        bytes memory,
        bool
    ) internal view override returns (MessagingFee memory fee) {
        return MessagingFee({nativeFee: stubNativeFee, lzTokenFee: 0});
    }

    function _sendLzMessage(
        uint32 dstEid,
        bytes memory payload,
        bytes memory,
        uint256 nativeFeePaid,
        address refundAddress
    ) internal override {
        _lzCalled = true;
        _lastDstEid = dstEid;
        _lastPayload = payload;
        _lastRefund = refundAddress;
        lastNativeFee = nativeFeePaid;
    }
}
