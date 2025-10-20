// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;
pragma experimental ABIEncoderV2;

interface IHederaTokenService {
    /**********************
    *      STRUCTS        *
    **********************/

    struct Expiry { int64 second; address autoRenewAccount; int64 autoRenewPeriod; }
    struct KeyValue { bool inheritAccountKey; address contractId; bytes ed25519; bytes ecdsaSecp256k1; address delegatableContractId; }
    struct TokenKey { uint256 keyType; KeyValue key; }
    struct HederaToken { string name; string symbol; address treasury; string memo; bool supplyType; int64 maxSupply; bool freezeDefault; TokenKey[] tokenKeys; Expiry expiry; }
    struct AccountAmount { address accountID; int64 amount; bool isApproval; }
    struct TransferList { AccountAmount[] transfers; }
    struct TokenTransferList { address token; AccountAmount[] transfers; int64[] nftTransfers; }

    /**********************
    *      FUNCTIONS      *
    **********************/

    function createFungibleToken(HederaToken memory token, int64 initialTotalSupply, uint8 decimals) external payable returns (int32 responseCode, address tokenAddress);
    function mintToken(address token, int64 amount, bytes[] memory metadata) external returns (int32 responseCode, int64 newTotalSupply, int64[] memory serialNumbers);
    function burnToken(address token, int64 amount, int64[] memory serialNumbers) external returns (int32 responseCode, int64 newTotalSupply);
    function associateToken(address account, address token) external returns (int32 responseCode);
    function cryptoTransfer(TransferList memory transferList, TokenTransferList[] memory tokenTransfers) external returns (int32 responseCode);
    function updateTokenKeys(address token, TokenKey[] memory keys) external returns (int32 responseCode);
}
