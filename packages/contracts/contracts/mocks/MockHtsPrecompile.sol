// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHederaTokenService} from "../hedera/hedera-hts/IHederaTokenService.sol";

/**
 * @dev Stateful mock that simulates the Hedera Token Service precompile for unit testing.
 * It stores the most recent call arguments so that tests can assert on the controller logic.
 */
contract MockHtsPrecompile is IHederaTokenService {
    int256 public createResponseCode;
    address public createTokenAddress;
    uint256 public lastInitialSupply;
    uint32 public lastDecimals;

    int256 public mintResponseCode;
    uint64 public mintNewTotalSupply;
    address public lastMintToken;
    uint64 public lastMintAmount;
    uint256 public lastMintMetadataLength;

    int256 public burnResponseCode;
    address public lastBurnToken;
    uint64 public lastBurnAmount;

    int256 public transferResponseCode;
    address public lastTransferToken;
    AccountAmount[] private _lastTransferAdjustments;

    constructor() {
        createResponseCode = 22;
        createTokenAddress = address(0x1000);
        mintResponseCode = 22;
        burnResponseCode = 22;
        transferResponseCode = 22;
    }

    function setCreateResponse(int256 code, address tokenAddr) external {
        createResponseCode = code;
        createTokenAddress = tokenAddr;
    }

    function setMintResponse(int256 code, uint64 newSupply) external {
        mintResponseCode = code;
        mintNewTotalSupply = newSupply;
    }

    function setBurnResponse(int256 code) external {
        burnResponseCode = code;
    }

    function setTransferResponse(int256 code) external {
        transferResponseCode = code;
    }

    function clearLastTransfers() external {
        delete _lastTransferAdjustments;
        lastTransferToken = address(0);
    }

    function lastTransferAdjustments()
        external
        view
        returns (AccountAmount[] memory)
    {
        return _lastTransferAdjustments;
    }

    function createFungibleToken(
        HederaToken memory,
        uint256 initialTotalSupply,
        uint32 decimals
    ) external override returns (int256 responseCode, address tokenAddress) {
        lastInitialSupply = initialTotalSupply;
        lastDecimals = decimals;
        return (createResponseCode, createTokenAddress);
    }

    function mintToken(
        address token,
        uint64 amount,
        bytes[] calldata metadata
    )
        external
        override
        returns (
            int256 responseCode,
            uint64 newTotalSupply,
            uint64[] memory serialNumbers
        )
    {
        lastMintToken = token;
        lastMintAmount = amount;
        lastMintMetadataLength = metadata.length;
        serialNumbers = new uint64[](0);
        return (mintResponseCode, mintNewTotalSupply, serialNumbers);
    }

    function burnToken(
        address token,
        uint64 amount,
        uint64[] calldata
    ) external override returns (int256 responseCode, uint64 newTotalSupply) {
        lastBurnToken = token;
        lastBurnAmount = amount;
        return (burnResponseCode, mintNewTotalSupply);
    }

    function cryptoTransfer(
        TransferList memory,
        TokenTransferList[] memory tokenTransfers
    ) external override returns (int256 responseCode) {
        require(tokenTransfers.length == 1, "expected single token transfer");
        lastTransferToken = tokenTransfers[0].token;

        delete _lastTransferAdjustments;
        for (uint256 i = 0; i < tokenTransfers[0].transfers.length; i++) {
            _lastTransferAdjustments.push(tokenTransfers[0].transfers[i]);
        }

        return transferResponseCode;
    }
}
