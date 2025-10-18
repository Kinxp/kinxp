// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

/**
 * @dev Minimal subset of the Hedera Token Service interface used by this project.
 * Docs: https://docs.hedera.com/hedera/Tokens/hts-system-contracts
 */
interface IHederaTokenService {
    struct TokenKey {
        uint256 keyType; // bitmask per HIP-514
        address key;
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
        bool supplyType;
        uint256 maxSupply;
        bool freezeDefault;
        TokenKey[] tokenKeys;
        Expiry expiry;
    }

    function createFungibleToken(
        HederaToken memory token,
        uint256 initialTotalSupply,
        uint32 decimals
    ) external returns (int256 responseCode, address tokenAddress);

    function mintToken(
        address token,
        uint64 amount,
        bytes[] calldata metadata
    )
        external
        returns (
            int256 responseCode,
            uint64 newTotalSupply,
            uint64[] memory serialNumbers
        );

    function burnToken(
        address token,
        uint64 amount,
        uint64[] calldata serials
    ) external returns (int256 responseCode, uint64 newTotalSupply);

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

