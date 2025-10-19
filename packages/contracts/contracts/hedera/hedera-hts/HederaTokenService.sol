// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.5.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "./IHederaTokenService.sol";

abstract contract HederaTokenService {
    int32 constant UNKNOWN_CODE = 21;
    int32 constant SUCCESS_CODE = 22;
    address constant precompileAddress = address(0x167);
    int32 constant defaultAutoRenewPeriod = 7776000;

    modifier nonEmptyExpiry(IHederaTokenService.HederaToken memory token) {
        if (token.expiry.second == 0 && token.expiry.autoRenewPeriod == 0) {
            token.expiry.autoRenewPeriod = defaultAutoRenewPeriod;
        }
        _;
    }

    function mintToken(address token, int64 amount, bytes[] memory metadata) internal returns (int32 responseCode, int64 newTotalSupply, int64[] memory serialNumbers) {
        (bool success, bytes memory result) = precompileAddress.call(abi.encodeWithSelector(IHederaTokenService.mintToken.selector, token, amount, metadata));
        (responseCode, newTotalSupply, serialNumbers) = success ? abi.decode(result, (int32, int64, int64[])) : (UNKNOWN_CODE, int64(0), new int64[](0));
    }

    function burnToken(address token, int64 amount, int64[] memory serialNumbers) internal returns (int32 responseCode, int64 newTotalSupply) {
        (bool success, bytes memory result) = precompileAddress.call(abi.encodeWithSelector(IHederaTokenService.burnToken.selector, token, amount, serialNumbers));
        (responseCode, newTotalSupply) = success ? abi.decode(result, (int32, int64)) : (UNKNOWN_CODE, int64(0));
    }

    function createFungibleToken(IHederaTokenService.HederaToken memory token, int64 initialTotalSupply, uint8 decimals) internal nonEmptyExpiry(token) returns (int32 responseCode, address tokenAddress) {
        (bool success, bytes memory result) = precompileAddress.call{value: msg.value}(abi.encodeWithSelector(IHederaTokenService.createFungibleToken.selector, token, initialTotalSupply, decimals));
        (responseCode, tokenAddress) = success ? abi.decode(result, (int32, address)) : (UNKNOWN_CODE, address(0));
    }
}