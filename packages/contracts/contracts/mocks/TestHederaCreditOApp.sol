// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HederaCreditOApp} from "../hedera/HederaCreditOApp.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @dev Adds test helpers around HederaCreditOApp's internal state for unit tests.
 */
contract TestHederaCreditOApp is HederaCreditOApp {
    PythStructs.Price private stubPrice;
    bool private stubActive;
    bool private stubMismatch;

    constructor(
        address endpoint,
        address owner_,
        address controller_,
        address pythContract,
        bytes32 priceId
    ) HederaCreditOApp(endpoint, owner_, controller_, pythContract, priceId) {}

    function setStubPrice(int64 price, int32 expo) external {
        stubPrice = PythStructs.Price({
            price: price,
            conf: 0,
            expo: expo,
            publishTime: uint64(block.timestamp)
        });
        stubActive = true;
        stubMismatch = false;
    }

    function clearStubPrice() external {
        stubActive = false;
    }

    function forcePriceMismatch() external {
        stubMismatch = true;
    }

    function forceOpenOrder(
        bytes32 id,
        address borrower,
        uint256 ethAmountWei
    ) external {
        HOrder storage o = horders[id];
        o.borrower = borrower;
        o.ethAmountWei = ethAmountWei;
        o.open = true;
    }

    function forceSetBorrowed(bytes32 id, uint64 borrowedUsd) external {
        horders[id].borrowedUsd = borrowedUsd;
    }

    function _fetchPrice(uint32)
        internal
        view
        override
        returns (PythStructs.Price memory)
    {
        if (stubMismatch) {
            revert("priceId mismatch");
        }
        require(stubActive, "stub price unset");
        return stubPrice;
    }
}
