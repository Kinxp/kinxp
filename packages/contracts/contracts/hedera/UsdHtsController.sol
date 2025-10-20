// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./hedera-hts/IHederaTokenService.sol";

/**
 * @title UsdHtsController
 * @notice On-chain manager for a pre-created HTS fungible token.
 */
contract UsdHtsController is Ownable {
    IHederaTokenService public constant HTS_PRECOMPILE =
        IHederaTokenService(address(uint160(0x167)));

    address public usdToken;
    uint8 public usdDecimals;

    event TokenCreated(address indexed token, uint8 decimals);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);

    receive() external payable {}

    constructor() {}

    /**
     * @notice Associate this contract with the HTS token before linking.
     */
    function associateToken(address tokenAddr) external onlyOwner {
        require(tokenAddr != address(0), "token=0");
        int32 rc = HTS_PRECOMPILE.associateToken(address(this), tokenAddr);
        require(rc == 22, "associate failed");
    }

    /**
     * @notice One-time link between controller and token metadata.
     */
    function setExistingUsdToken(address tokenAddr, uint8 decimals_)
        external
        onlyOwner
    {
        require(usdToken == address(0), "token already set");
        require(tokenAddr != address(0), "token=0");
        usdToken = tokenAddr;
        usdDecimals = decimals_;
        emit TokenCreated(tokenAddr, decimals_);
    }

    function mintTo(address to, uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        require(to != address(0), "to=0");
        require(amount <= uint64(type(int64).max), "amount>int64");

        int64 signedAmount = int64(amount);
        bytes[] memory emptyMetadata = new bytes[](0);

        (int32 rcMint, , ) = HTS_PRECOMPILE.mintToken(
            usdToken,
            signedAmount,
            emptyMetadata
        );
        require(rcMint == 22, "mint failed");

        IHederaTokenService.AccountAmount[]
            memory adjustments = new IHederaTokenService.AccountAmount[](2);
        adjustments[0] = IHederaTokenService.AccountAmount({
            accountID: address(this),
            amount: -signedAmount,
            isApproval: false
        });
        adjustments[1] = IHederaTokenService.AccountAmount({
            accountID: to,
            amount: signedAmount,
            isApproval: false
        });

        IHederaTokenService.TokenTransferList[]
            memory tokenTransfers = new IHederaTokenService.TokenTransferList[](
                1
            );
        tokenTransfers[0] = IHederaTokenService.TokenTransferList({
            token: usdToken,
            transfers: adjustments,
            nftTransfers: new int64[](0)
        });

        IHederaTokenService.TransferList memory emptyList = IHederaTokenService
            .TransferList({transfers: new IHederaTokenService.AccountAmount[](0)});

        int32 rcXfer = HTS_PRECOMPILE.cryptoTransfer(emptyList, tokenTransfers);
        require(rcXfer == 22, "xfer failed");

        emit Minted(to, amount);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        require(amount <= uint64(type(int64).max), "amount>int64");

        int64 signedAmount = int64(amount);
        int64[] memory serials = new int64[](0);

        (int32 rcBurn, ) = HTS_PRECOMPILE.burnToken(
            usdToken,
            signedAmount,
            serials
        );
        require(rcBurn == 22, "burn failed");

        emit Burned(amount);
    }
}
