// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

import "../hedera/hedera-hts/IHederaTokenService.sol";

contract MockHtsPrecompile is IHederaTokenService {
    int32 private _createResp = 22;
    address private _createTokenAddr;
    int32 private _mintResp = 22;
    int32 private _burnResp = 22;
    int32 private _xferResp = 22;
    int32 private _associateResp = 22;
    address public lastMintToken;
    int64 public lastMintAmount;
    address public lastBurnToken;
    int64 public lastBurnAmount;
    address public lastTransferToken;
    address public lastAssociateAccount;
    address public lastAssociateToken;
    AccountAmount[] private _lastTransferAdjustments;
    uint256 private _tokenCounter;
    
    function setCreateResponse(int32 code, address tokenAddr) external { _createResp = code; _createTokenAddr = tokenAddr; }
    function setMintResponse(int32 code) external { _mintResp = code; }
    function setBurnResponse(int32 code) external { _burnResp = code; }
    function setTransferResponse(int32 code) external { _xferResp = code; }
    function setAssociateResponse(int32 code) external { _associateResp = code; }
    function clearLastTransfers() external { delete _lastTransferAdjustments; lastTransferToken = address(0); }
    function lastTransferAdjustments() external view returns (AccountAmount[] memory) { return _lastTransferAdjustments; }

    function createFungibleToken(HederaToken memory, int64, uint8) external payable override returns (int32 responseCode, address tokenAddress) {
        responseCode = _createResp;
        if (_createTokenAddr != address(0)) { tokenAddress = _createTokenAddr; } else { _tokenCounter++; tokenAddress = address(uint160(uint256(keccak256(abi.encodePacked(_tokenCounter, block.timestamp))))); }
    }

    function mintToken(address token, int64 amount, bytes[] memory) external override returns (int32 responseCode, int64 newTotalSupply, int64[] memory serialNumbers) {
        lastMintToken = token; lastMintAmount = amount; responseCode = _mintResp; newTotalSupply = 0; serialNumbers = new int64[](0);
    }

    function burnToken(address token, int64 amount, int64[] memory) external override returns (int32 responseCode, int64 newTotalSupply) {
        lastBurnToken = token; lastBurnAmount = amount; responseCode = _burnResp; newTotalSupply = 0;
    }

    function associateToken(address account, address token) external override returns (int32 responseCode) {
        lastAssociateAccount = account;
        lastAssociateToken = token;
        responseCode = _associateResp;
    }

    function cryptoTransfer(TransferList memory, TokenTransferList[] memory tokenTransfers) external override returns (int32 responseCode) {
        if (tokenTransfers.length > 0) {
            lastTransferToken = tokenTransfers[0].token;
            delete _lastTransferAdjustments;
            for (uint i = 0; i < tokenTransfers[0].transfers.length; i++) {
                _lastTransferAdjustments.push(tokenTransfers[0].transfers[i]);
            }
        }
        responseCode = _xferResp;
    }
    
    function updateTokenKeys(address, TokenKey[] memory) external override returns (int32 responseCode) {
        responseCode = 22; // SUCCESS
    }
}
