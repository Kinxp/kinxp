// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./hedera-hts/HederaTokenService.sol";

contract UsdHtsController is Ownable, HederaTokenService {
    address public usdToken;
    uint8 public usdDecimals;

    event TokenCreated(address indexed token, uint8 decimals);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);

    receive() external payable {}

    constructor() {
        // Ownable constructor is called automatically
        // In older versions, ownership is set to msg.sender by default
    }

    // CRITICAL FIX: Add payable modifier
    function createToken(
        string calldata name, 
        string calldata symbol, 
        uint8 decimals
    ) external payable onlyOwner {
        require(usdToken == address(0), "token exists");
        require(msg.value > 0, "HBAR required for token creation");
        
        // Set up supply key
        IHederaTokenService.KeyValue memory supplyKey;
        supplyKey.contractId = address(this);
        
        // Create token keys array
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({ 
            keyType: 16, // SUPPLY_KEY_TYPE
            key: supplyKey 
        });
        
        // Configure token
        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.treasury = address(this);
        token.memo = "Hedera Credit USD";
        token.tokenKeys = keys;
        token.supplyType = false; // INFINITE supply type
        token.maxSupply = 0;
        token.freezeDefault = false;
        
        // Set expiry with auto-renew
        token.expiry.autoRenewAccount = owner();
        token.expiry.autoRenewPeriod = 7890000; // ~3 months
        token.expiry.second = 0;
        
        // Create the token (msg.value is automatically forwarded)
        (int32 responseCode, address tokenAddress) = createFungibleToken(
            token, 
            0, // initial supply
            decimals
        );
        
        require(responseCode == SUCCESS_CODE, "Token creation failed");
        
        usdToken = tokenAddress;
        usdDecimals = decimals;
        
        emit TokenCreated(tokenAddress, decimals);
    }
    
    function setExistingUsdToken(address tokenAddr, uint8 decimals_) external onlyOwner {
        require(usdToken == address(0), "already set");
        usdToken = tokenAddr;
        usdDecimals = decimals_;
        emit TokenCreated(tokenAddr, decimals_);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        
        (int32 responseCode, ) = burnToken(
            usdToken, 
            int64(uint64(amount)), 
            new int64[](0)
        );
        
        require(responseCode == SUCCESS_CODE, "burn failed");
        emit Burned(amount);
    }

    function mintTo(address to, uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        
        // Mint tokens to treasury (this contract)
        (int32 responseCode, , ) = mintToken(
            usdToken, 
            int64(uint64(amount)), 
            new bytes[](0)
        );
        require(responseCode == SUCCESS_CODE, "mint failed");

        // Transfer from treasury to recipient
        IHederaTokenService.AccountAmount[] memory accountAmounts = 
            new IHederaTokenService.AccountAmount[](2);
        
        accountAmounts[0] = IHederaTokenService.AccountAmount({ 
            accountID: address(this), 
            amount: -int64(uint64(amount)), 
            isApproval: false 
        });
        
        accountAmounts[1] = IHederaTokenService.AccountAmount({ 
            accountID: to, 
            amount: int64(uint64(amount)), 
            isApproval: false 
        });
        
        IHederaTokenService.TokenTransferList[] memory tokenTransferLists = 
            new IHederaTokenService.TokenTransferList[](1);
        
        tokenTransferLists[0] = IHederaTokenService.TokenTransferList({ 
            token: usdToken, 
            transfers: accountAmounts, 
            nftTransfers: new int64[](0) 
        });
        
        // Execute crypto transfer
        (bool success, bytes memory result) = precompileAddress.call(
            abi.encodeWithSelector(
                IHederaTokenService.cryptoTransfer.selector, 
                IHederaTokenService.TransferList(
                    new IHederaTokenService.AccountAmount[](0)
                ), 
                tokenTransferLists
            )
        );
        
        int32 rcXfer = success ? abi.decode(result, (int32)) : UNKNOWN_CODE;
        require(rcXfer == SUCCESS_CODE, "cryptoTransfer failed");

        emit Minted(to, amount);
    }
}