// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthCollateralOApp} from "../eth/EthCollateralOApp.sol";
import {
    MessagingFee,
    MessagingReceipt
} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";

/**
 * @dev Exposes limited test-only helpers for EthCollateralOApp in unit tests.
 */
contract TestEthCollateralOApp is EthCollateralOApp {
    MessagingFee private stubQuoteFee;
    bool private hasStubQuote;

    bytes public lastLzPayload;
    bytes public lastLzOptions;
    MessagingFee public lastLzFee;
    uint32 public lastLzDstEid;
    address public lastLzRefundAddress;
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

    function _lzSend(
        uint32 _dstEid,
        bytes memory _message,
        bytes memory _options,
        MessagingFee memory _fee,
        address _refundAddress
    ) internal override returns (MessagingReceipt memory) {
        lastLzSendCalled = true;
        lastLzDstEid = _dstEid;
        lastLzPayload = _message;
        lastLzOptions = _options;
        lastLzFee = _fee;
        lastLzRefundAddress = _refundAddress;
        return MessagingReceipt(bytes32(0), 0, _fee);
    }
}
