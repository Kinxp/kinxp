// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

import "../hedera/hedera-hts/IHederaTokenService.sol";

/**
 * Mock implementation of HTS precompile for testing
 */
contract MockHtsPrecompile is IHederaTokenService {
    uint256 private _tokenCounter;
    mapping(address => int64) public totalSupply;
    
    function createFungibleToken(
        HederaToken memory token,
        uint256 initialTotalSupply,
        uint32 decimals
    ) external override returns (int256 responseCode, address tokenAddress) {
        // Generate a mock token address
        _tokenCounter++;
        tokenAddress = address(uint160(uint256(keccak256(abi.encodePacked(_tokenCounter)))));
        
        // Store initial supply
        totalSupply[tokenAddress] = int64(uint64(initialTotalSupply));
        
        // Return success code (22 = SUCCESS)
        responseCode = 22;
    }

    function mintToken(
        address token,
        int64 amount,
        bytes[] calldata metadata
    ) external override returns (int256 responseCode, int64 newTotalSupply, int64[] memory serialNumbers) {
        // Update total supply
        totalSupply[token] += amount;
        newTotalSupply = totalSupply[token];
        
        // Return empty serials array for fungible tokens
        serialNumbers = new int64[](0);
        
        // Return success code
        responseCode = 22;
    }

    function burnToken(
        address token,
        int64 amount,
        int64[] calldata serials
    ) external override returns (int256 responseCode, int64 newTotalSupply) {
        // Update total supply
        totalSupply[token] -= amount;
        newTotalSupply = totalSupply[token];
        
        // Return success code
        responseCode = 22;
    }

    function cryptoTransfer(
        TransferList memory transfers,
        TokenTransferList[] memory tokenTransfers
    ) external override returns (int256 responseCode) {
        // Mock implementation - just return success
        // In a real implementation, you would validate and execute transfers
        responseCode = 22;
    }
}