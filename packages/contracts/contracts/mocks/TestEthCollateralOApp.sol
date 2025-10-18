// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthCollateralOApp} from "../eth/EthCollateralOApp.sol";

/**
 * @dev Exposes limited test-only helpers for EthCollateralOApp in unit tests.
 */
contract TestEthCollateralOApp is EthCollateralOApp {
    constructor(address endpoint) EthCollateralOApp(endpoint) {}

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
}
