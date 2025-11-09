// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Lightweight Pyth mock suitable for local testing.
contract MockPyth {
    uint256 public updateFeeWei;
    bool public forceMismatch;

    int64 private currentPrice;
    int32 private currentExpo;
    uint64 private currentConf;
    uint64 private currentPublishTime;

    bytes[] private lastUpdateData;

    function setUpdateFee(uint256 fee) external {
        updateFeeWei = fee;
    }

    function setPrice(int64 price, int32 expo) external {
        currentPrice = price;
        currentExpo = expo;
        currentPublishTime = uint64(block.timestamp);
        forceMismatch = false;
    }

    function setConfidence(uint64 conf) external {
        currentConf = conf;
    }

    function setForceMismatch(bool enabled) external {
        forceMismatch = enabled;
    }

    function getUpdateFee(bytes[] calldata) external view returns (uint256) {
        return updateFeeWei;
    }

    function updatePriceFeeds(bytes[] calldata data) external payable {
        delete lastUpdateData;
        for (uint256 i = 0; i < data.length; i++) {
            lastUpdateData.push(data[i]);
        }
    }

    function getPriceNoOlderThan(bytes32, uint256) external view returns (PythStructs.Price memory price) {
        require(!forceMismatch, "priceId mismatch");
        return _currentPrice();
    }

    function getPrice(bytes32) external view returns (PythStructs.Price memory price) {
        return _currentPrice();
    }

    function getPriceUnsafe(bytes32) external view returns (PythStructs.Price memory price) {
        return _currentPrice();
    }

    function getEmaPrice(bytes32) external view returns (PythStructs.Price memory price) {
        return _currentPrice();
    }

    function getEmaPriceUnsafe(bytes32) external view returns (PythStructs.Price memory price) {
        return _currentPrice();
    }

    function getLastUpdateData() external view returns (bytes[] memory) {
        bytes[] memory copy = new bytes[](lastUpdateData.length);
        for (uint256 i = 0; i < lastUpdateData.length; i++) {
            copy[i] = lastUpdateData[i];
        }
        return copy;
    }

    function _currentPrice() private view returns (PythStructs.Price memory price) {
        return PythStructs.Price({
            price: currentPrice,
            conf: currentConf,
            expo: currentExpo,
            publishTime: currentPublishTime
        });
    }
}
