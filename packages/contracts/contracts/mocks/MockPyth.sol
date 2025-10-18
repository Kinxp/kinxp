// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @dev Lightweight mock of the Pyth price feed contract used in unit tests.
 * Only the functions exercised by HederaCreditOApp are implemented.
 */
contract MockPyth {
    uint256 public updateFee;
    bytes[] private _lastUpdateData;
    uint256 public totalMsgValue;

    bytes32 public storedPriceId;
    PythStructs.Price private _storedPrice;

    function setUpdateFee(uint256 feeWei) external {
        updateFee = feeWei;
    }

    function setPrice(
        bytes32 priceId,
        int64 price,
        uint64 conf,
        int32 expo,
        uint64 publishTime
    ) external {
        storedPriceId = priceId;
        _storedPrice = PythStructs.Price({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: publishTime
        });
    }

    function getLastUpdateData()
        external
        view
        returns (bytes[] memory storedData)
    {
        storedData = _lastUpdateData;
    }

    function getUpdateFee(bytes[] calldata)
        external
        view
        returns (uint256)
    {
        return updateFee;
    }

    function updatePriceFeeds(bytes[] calldata data) external payable {
        _lastUpdateData = data;
        totalMsgValue += msg.value;
    }

    function getPriceNoOlderThan(bytes32 priceId, uint32)
        external
        view
        returns (PythStructs.Price memory)
    {
        require(priceId == storedPriceId, "priceId mismatch");
        return _storedPrice;
    }
}
