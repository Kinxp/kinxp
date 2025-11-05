// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./hedera-hts/IHederaTokenService.sol";

/// @title UsdHtsController
/// @notice Governance controlled helper around the Hedera Token Service for a fungible token.
contract UsdHtsController is Ownable {
    IHederaTokenService public constant HTS_PRECOMPILE =
        IHederaTokenService(address(uint160(0x167)));

    address public usdToken;
    uint8 public usdDecimals;
    address public treasuryAccount;

    uint256 public mintCap; // 0 = unlimited
    uint256 public totalMinted;
    uint256 public totalBurned;
    bool public paused;

    event TokenCreated(address indexed token, uint8 decimals);
    event MintCapUpdated(uint256 newCap);
    event TreasurySet(address indexed treasury);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error AssociateFailed(int64 rc);
    error MintFailed(int64 rc);
    error TransferFailed(int64 rc);
    error BurnFailed(int64 rc);
    error MintCapExceeded();
    error ControllerPaused();

    receive() external payable {}

    constructor(address owner_) {
        if (owner_ != address(0)) {
            _transferOwnership(owner_);
        }
    }

    function setTreasury(address treasury) external onlyOwner {
        require(treasury != address(0), "treasury=0");
        treasuryAccount = treasury;
        emit TreasurySet(treasury);
    }

    function setMintCap(uint256 newCap) external onlyOwner {
        mintCap = newCap;
        emit MintCapUpdated(newCap);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function associateToken(address tokenAddr) external onlyOwner {
        require(tokenAddr != address(0), "token=0");
        int64 rc = HTS_PRECOMPILE.associateToken(address(this), tokenAddr);
        if (rc != 22) revert AssociateFailed(rc);
    }

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
        if (paused) revert ControllerPaused();
        require(usdToken != address(0), "no token");
        require(to != address(0), "to=0");
        require(treasuryAccount != address(0), "no treasury");
        require(amount != 0, "amount=0");
        require(amount <= uint64(type(int64).max), "amount>int64");

        if (mintCap != 0 && totalMinted + amount > mintCap) {
            revert MintCapExceeded();
        }

        int64 signedAmount = int64(amount);
        bytes[] memory emptyMetadata = new bytes[](0);

        (int64 rcMint, , ) = HTS_PRECOMPILE.mintToken(
            usdToken,
            signedAmount,
            emptyMetadata
        );
        if (rcMint != 22) revert MintFailed(rcMint);

        if (to == treasuryAccount) {
            totalMinted += amount;
            emit Minted(to, amount);
            return;
        }

        IHederaTokenService.AccountAmount[]
            memory adjustments = new IHederaTokenService.AccountAmount[](2);
        adjustments[0] = IHederaTokenService.AccountAmount({
            accountID: treasuryAccount,
            amount: -signedAmount,
            isApproval: true
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
            nftTransfers: new IHederaTokenService.NftTransfer[](0)
        });

        IHederaTokenService.TransferList memory emptyList = IHederaTokenService
            .TransferList({transfers: new IHederaTokenService.AccountAmount[](0)});

        int64 rcXfer = HTS_PRECOMPILE.cryptoTransfer(emptyList, tokenTransfers);
        if (rcXfer != 22) revert TransferFailed(rcXfer);

        totalMinted += amount;
        emit Minted(to, amount);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        require(amount <= uint64(type(int64).max), "amount>int64");

        int64 signedAmount = int64(amount);
        int64[] memory serials = new int64[](0);

        (int64 rcBurn, ) = HTS_PRECOMPILE.burnToken(
            usdToken,
            signedAmount,
            serials
        );
        if (rcBurn != 22) revert BurnFailed(rcBurn);

        totalBurned += amount;
        emit Burned(amount);
    }
}
