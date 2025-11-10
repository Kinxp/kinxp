// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IHederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/IHederaTokenService.sol";

/// @notice In-memory HTS precompile mock exposed via `hardhat_setCode`.
contract MockHtsPrecompile {
    int64 private mintResponseCode;
    int64 private burnResponseCode;
    int64 private transferResponseCode;
    int64 private associateResponseCode;
    int64 private createFungibleResponseCode;
    address private createFungibleTokenAddress;
    bool private initialized;

    address public lastAssociateAccount;
    address public lastAssociateToken;

    address public lastMintToken;
    int64 public lastMintAmount;

    address public lastBurnToken;
    int64 public lastBurnAmount;

    address public lastTransferToken;
    IHederaTokenService.AccountAmount[] private _lastAdjustments;
    address public lastTransferFromToken;
    address public lastTransferFromSender;
    address public lastTransferFromRecipient;
    uint256 public lastTransferFromAmount;
    address public lastTransferTokenSimple;
    address public lastTransferTokenSender;
    address public lastTransferTokenRecipient;
    int64 public lastTransferTokenAmount;

    string public lastCreateTokenName;
    string public lastCreateTokenSymbol;
    string public lastCreateTokenMemo;
    address public lastCreateTokenTreasury;
    int64 public lastCreateInitialSupply;
    int32 public lastCreateTokenDecimals;

    function setMintResponse(int64 code) external {
        mintResponseCode = code;
    }

    function setBurnResponse(int64 code) external {
        burnResponseCode = code;
    }

    function setTransferResponse(int64 code) external {
        transferResponseCode = code;
    }

    function setAssociateResponse(int64 code) external {
        associateResponseCode = code;
    }

    function setCreateFungibleResponse(int64 code, address tokenAddr) external {
        createFungibleResponseCode = code;
        createFungibleTokenAddress = tokenAddr;
    }

    function associateToken(address account, address token) external returns (int64 responseCode) {
        lastAssociateAccount = account;
        lastAssociateToken = token;
        return associateResponseCode;
    }

    function mintToken(address token, int64 amount, bytes[] memory)
        external
        returns (int64 responseCode, int64, int64[] memory)
    {
        lastMintToken = token;
        lastMintAmount = amount;
        return (mintResponseCode, 0, new int64[](0));
    }

    function burnToken(address token, int64 amount, int64[] memory)
        external
        returns (int64 responseCode, int64)
    {
        lastBurnToken = token;
        lastBurnAmount = amount;
        return (burnResponseCode, 0);
    }

    function createFungibleToken(
        IHederaTokenService.HederaToken memory token,
        int64 initialTotalSupply,
        int32 decimals
    ) external payable returns (int64 responseCode, address tokenAddress) {
        lastCreateTokenName = token.name;
        lastCreateTokenSymbol = token.symbol;
        lastCreateTokenMemo = token.memo;
        lastCreateTokenTreasury = token.treasury;
        lastCreateInitialSupply = initialTotalSupply;
        lastCreateTokenDecimals = decimals;
        return (createFungibleResponseCode, createFungibleTokenAddress);
    }

    function cryptoTransfer(
        IHederaTokenService.TransferList memory,
        IHederaTokenService.TokenTransferList[] memory tokenTransfers
    )
        external
        returns (int64 responseCode)
    {
        delete _lastAdjustments;
        if (tokenTransfers.length > 0) {
            lastTransferToken = tokenTransfers[0].token;
            for (uint256 i = 0; i < tokenTransfers[0].transfers.length; i++) {
                _lastAdjustments.push(tokenTransfers[0].transfers[i]);
            }
        }
        return transferResponseCode;
    }

    function transferFrom(address token, address from, address to, uint256 amount)
        external
        returns (int64 responseCode)
    {
        lastTransferFromToken = token;
        lastTransferFromSender = from;
        lastTransferFromRecipient = to;
        lastTransferFromAmount = amount;
        return transferResponseCode;
    }

    function transferToken(address token, address sender, address recipient, int64 amount)
        external
        returns (int64 responseCode)
    {
        lastTransferTokenSimple = token;
        lastTransferTokenSender = sender;
        lastTransferTokenRecipient = recipient;
        lastTransferTokenAmount = amount;
        return transferResponseCode;
    }

    function lastTransferAdjustments() external view returns (IHederaTokenService.AccountAmount[] memory) {
        IHederaTokenService.AccountAmount[] memory copy = new IHederaTokenService.AccountAmount[](
            _lastAdjustments.length
        );
        for (uint256 i = 0; i < _lastAdjustments.length; i++) {
            copy[i] = _lastAdjustments[i];
        }
        return copy;
    }

    function initialize() external {
        if (initialized) return;
        mintResponseCode = 22;
        burnResponseCode = 22;
        transferResponseCode = 22;
        associateResponseCode = 22;
        createFungibleResponseCode = 22;
        initialized = true;
    }
}
