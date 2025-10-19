// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

/**
 * Minimal, correct HTS precompile interface for fungible tokens.
 * Matches Hedera on-chain ABI (int256 response codes, int64 amounts).
 */
interface IHederaTokenService {
    struct KeyValue {
        bytes ed25519;
        bytes ecdsaSecp256k1;
        address contractId;
        address delegatableContractId;
        bool inheritAccountKey;
    }

    struct TokenKey {
        uint256 keyType; // HIP-540 bitmask (16 = SUPPLY)
        KeyValue key;
    }

    struct Expiry {
        address autoRenewAccount;
        uint32 autoRenewPeriod;
        uint64 second;
    }

    struct HederaToken {
        string name;
        string symbol;
        address treasury;
        string memo;
        bool supplyType;   // false => INFINITE
        uint256 maxSupply; // used when supplyType=true
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    // Create fungible - returns int256 for response code
    function createFungibleToken(
        HederaToken memory token,
        uint256 initialTotalSupply,
        uint32 decimals
    ) external returns (int256 responseCode, address tokenAddress);

    // Mint / Burn (int64 amounts, int256 response codes)
    function mintToken(
        address token,
        int64 amount,
        bytes[] calldata metadata
    ) external returns (int256 responseCode, int64 newTotalSupply, int64[] memory serialNumbers);

    function burnToken(
        address token,
        int64 amount,
        int64[] calldata serials
    ) external returns (int256 responseCode, int64 newTotalSupply);

    // Transfers
    struct AccountAmount {
        address accountID;
        int64 amount;
        bool isApproval;
    }

    struct TransferList {
        AccountAmount[] transfers;
    }

    struct TokenTransferList {
        address token;
        AccountAmount[] transfers;
    }

    function cryptoTransfer(
        TransferList memory transfers,
        TokenTransferList[] memory tokenTransfers
    ) external returns (int256 responseCode);
}