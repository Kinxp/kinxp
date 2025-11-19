// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {HederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/HederaTokenService.sol";
import {IHederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/IHederaTokenService.sol";
import {HederaResponseCodes} from "@hashgraph/smart-contracts/contracts/system-contracts/HederaResponseCodes.sol";
import {KeyHelper} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/KeyHelper.sol";

/// @title SimpleHtsToken
/// @notice A simple ERC20-compatible token using Hedera Token Service (HTS)
contract SimpleHtsToken is HederaTokenService, KeyHelper {
    address public token;

    event CreatedToken(address tokenAddress);

    /// @notice Creates a fungible token with hardcoded values
    function createToken() public payable {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        keys[1] = getSingleKey(KeyType.ADMIN, KeyValueType.CONTRACT_ID, address(this));

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry(
            0, address(this), 8000000
        );

        IHederaTokenService.HederaToken memory hederaToken = IHederaTokenService.HederaToken(
            "Hedera USD Token",           // name
            "hUSD",               // symbol
            address(this),       // treasury
            "Test Token",  // memo
            true,                // finiteTotalSupplyType
            int64(1000000000000000), // maxSupply (1 billion with 6 decimals)
            false,               // freezeDefaultStatus
            keys,
            expiry
        );

        (int responseCode, address tokenAddress) =
            HederaTokenService.createFungibleToken(hederaToken, int64(0), int32(6));

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        token = tokenAddress;
        emit CreatedToken(tokenAddress);
    }

    /// @notice Mints tokens to the contract treasury
    function mint(int64 amount) public {
        bytes[] memory metadata = new bytes[](0);
        (int responseCode, , ) = HederaTokenService.mintToken(token, amount, metadata);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    /// @notice Mints tokens and transfers to a specific address
    function mintTo(address to, int64 amount) public {
        bytes[] memory metadata = new bytes[](0);
        (int responseCode, , ) = HederaTokenService.mintToken(token, amount, metadata);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        if (to != address(this)) {
            int rcXfer = HederaTokenService.transferToken(token, address(this), to, amount);
            if (rcXfer != HederaResponseCodes.SUCCESS) {
                revert();
            }
        }
    }

    /// @notice Burns tokens
    function burn(int64 amount) public {
        int64[] memory serials = new int64[](0);
        (int responseCode, ) = HederaTokenService.burnToken(token, amount, serials);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    receive() external payable {}
}
