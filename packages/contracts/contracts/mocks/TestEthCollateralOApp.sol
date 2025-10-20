// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthCollateralOApp} from "../eth/EthCollateralOApp.sol";
import { MessagingFee } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";

/**
 * @dev Exposes limited test-only helpers for EthCollateralOApp in unit tests.
 */
contract TestEthCollateralOApp is EthCollateralOApp {
    MessagingFee private stubQuoteFee;
    bool private hasStubQuote;

    bytes public lastLzPayload;
    bytes public lastLzOptions;
    uint32 public lastLzDstEid;
    address public lastLzRefundAddress;
    uint256 public lastLzNativeFee;
    bool public lastLzSendCalled;

    constructor(address endpoint) EthCollateralOApp(endpoint) {}

    function setStubFee(uint256 nativeFee) external {
        stubQuoteFee = MessagingFee(nativeFee, 0);
        hasStubQuote = true;
    }

    function clearStubFee() external {
        hasStubQuote = false;
    }

    function forceSetHederaEid(uint32 eid) external {
        hederaEid = eid;
    }

    function forceMarkRepaid(bytes32 orderId) external {
        orders[orderId].repaid = true;
    }

    function forceSeedOrder(
        bytes32 orderId,
        address owner_,
        uint256 amountWei,
        bool funded
    ) external {
        orders[orderId] = Order({
            owner: owner_,
            amountWei: amountWei,
            funded: funded,
            repaid: false,
            liquidated: false
        });
    }

    function _quote(
        uint32,
        bytes memory,
        bytes memory,
        bool
    ) internal view override returns (MessagingFee memory) {
        require(hasStubQuote, "stub fee unset");
        return stubQuoteFee;
    }

    function _sendLzMessage(
        uint32 dstEid,
        bytes memory payload,
        bytes memory opts,
        uint256 nativeFee,
        address refundAddr
    ) internal override {
        lastLzSendCalled = true;
        lastLzDstEid = dstEid;
        lastLzPayload = payload;
        lastLzOptions = opts;
        lastLzNativeFee = nativeFee;
        lastLzRefundAddress = refundAddr;
    }
}
