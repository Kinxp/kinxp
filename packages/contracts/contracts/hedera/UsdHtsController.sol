// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.9;

import "./hedera-hts/IHederaTokenService.sol";

contract UsdHtsController {
    address public owner;
    address public usdToken;
    uint8 public usdDecimals;
    IHederaTokenService public HTS_PRECOMPILE;

    event TokenCreated(address indexed token);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address htsPrecompile) {
        owner = msg.sender;
        HTS_PRECOMPILE = IHederaTokenService(htsPrecompile);
    }

    function createToken(
        string calldata name,
        string calldata symbol,
        uint32 decimals
    ) external onlyOwner {
        require(usdToken == address(0), "token exists");

        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: address(this),
            memo: "",
            supplyType: false, // INFINITE
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: new IHederaTokenService.TokenKey[](0),
            expiry: IHederaTokenService.Expiry({
                autoRenewAccount: address(this),
                autoRenewPeriod: 7890000,
                second: 0
            })
        });

        (int256 rc, address tokenAddr) = HTS_PRECOMPILE.createFungibleToken(
            token,
            0, // initial supply
            decimals
        );
        require(rc == 22, "create failed");

        usdToken = tokenAddr;
        usdDecimals = uint8(decimals);
        emit TokenCreated(tokenAddr);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        require(amount <= uint64(type(int64).max), "amount>int64");

        // For fungible tokens, serials must be an EMPTY ARRAY
        int64[] memory serials;

        // burnToken returns int256 for response code
        (int256 rcBurn, ) = HTS_PRECOMPILE.burnToken(usdToken, int64(amount), serials);
        require(rcBurn == 22, "burn failed");

        emit Burned(amount);
    }

    function mintTo(address to, uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");
        require(to != address(0), "to=0");
        require(amount <= uint64(type(int64).max), "amount>int64");

        // For fungible tokens, metadata must be an EMPTY ARRAY
        bytes[] memory metadata;

        // mintToken returns int256 for response code
        (int256 rcMint, , ) = HTS_PRECOMPILE.mintToken(usdToken, int64(amount), metadata);
        require(rcMint == 22, "mint failed"); // 22 == SUCCESS

        // Move from treasury (this contract) to the receiver
        int64 signedAmt = int64(amount);

        IHederaTokenService.AccountAmount[] memory amts =
            new IHederaTokenService.AccountAmount[](2);
        amts[0] = IHederaTokenService.AccountAmount({
            accountID: address(this),
            amount: -signedAmt,
            isApproval: false
        });
        amts[1] = IHederaTokenService.AccountAmount({
            accountID: to,
            amount: signedAmt,
            isApproval: false
        });

        IHederaTokenService.TokenTransferList[] memory lists =
            new IHederaTokenService.TokenTransferList[](1);
        lists[0] = IHederaTokenService.TokenTransferList({
            token: usdToken,
            transfers: amts
        });

        IHederaTokenService.TransferList memory empty; // no HBAR transfer
        int256 rcXfer = HTS_PRECOMPILE.cryptoTransfer(empty, lists);
        require(rcXfer == 22, "xfer failed");

        emit Minted(to, amount);
    }
}