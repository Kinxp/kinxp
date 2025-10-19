// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./hedera-hts/IHederaTokenService.sol";

contract UsdHtsController is Ownable {
    address public usdToken;
    uint8 public usdDecimals;
    IHederaTokenService constant HTS_PRECOMPILE = IHederaTokenService(address(0x167));

    event TokenCreated(address indexed token, uint8 decimals);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);

    receive() external payable {}

    constructor() {
        // Owner is set to deployer by Ownable's constructor
    }
    
    // Links the token created off-chain via the SDK to this controller
    function setExistingUsdToken(address tokenAddr, uint8 decimals_) external onlyOwner {
        require(usdToken == address(0), "Token already set");
        usdToken = tokenAddr;
        usdDecimals = decimals_;
        emit TokenCreated(tokenAddr, decimals_);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        (int32 rc, ) = HTS_PRECOMPILE.burnToken(usdToken, int64(amount), new int64[](0));
        require(rc == 22, "burn failed");
        emit Burned(amount);
    }

    function mintTo(address to, uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        
        // Step 1: Mint new tokens to the treasury (this contract)
        (int32 rc, , ) = HTS_PRECOMPILE.mintToken(usdToken, int64(amount), new bytes[](0));
        require(rc == 22, "mint failed");

        // Step 2: Transfer the new tokens from the treasury to the recipient
        IHederaTokenService.AccountAmount[] memory amts = new IHederaTokenService.AccountAmount[](2);
        amts[0] = IHederaTokenService.AccountAmount({ accountID: address(this), amount: -int64(amount), isApproval: false });
        amts[1] = IHederaTokenService.AccountAmount({ accountID: to, amount: int64(amount), isApproval: false });
        
        IHederaTokenService.TokenTransferList[] memory lists = new IHederaTokenService.TokenTransferList[](1);
        
        // FIX: Initialize the struct with all three required fields
        lists[0] = IHederaTokenService.TokenTransferList({
            token: usdToken,
            transfers: amts,
            nftTransfers: new int64[](0) // Must include the empty nftTransfers array
        });

        int32 rcXfer = HTS_PRECOMPILE.cryptoTransfer(IHederaTokenService.TransferList(new IHederaTokenService.AccountAmount[](0)), lists);
        require(rcXfer == 22, "xfer failed");

        emit Minted(to, amount);
    }
}