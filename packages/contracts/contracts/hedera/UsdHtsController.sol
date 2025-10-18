// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./hedera-hts/IHederaTokenService.sol";

address constant HTS = address(uint160(0x167));

/**
 * @title UsdHtsController
 * @notice Owns the USD HTS token supply key and manages mint/burn flows for credit issuance.
 */
contract UsdHtsController is Ownable {
    IHederaTokenService private constant HTS_PRECOMPILE =
        IHederaTokenService(HTS);

    address public usdToken;
    uint8 public usdDecimals;

    event TokenCreated(address indexed token, uint8 decimals);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);
    event TreasuryPaid(address indexed to, uint64 amount);

    constructor(address owner_) {
        if (owner_ != address(0)) {
            _transferOwnership(owner_);
        }
    }

    /**
     * @notice Creates an HTS fungible token with this contract as treasury and supply key.
     */
    function createUsdToken(
        string calldata name,
        string calldata symbol,
        uint8 decimals_,
        uint64 initialSupply,
        uint256 maxSupply
    ) external onlyOwner {
        require(usdToken == address(0), "already created");

        IHederaTokenService.TokenKey[]
            memory keys = new IHederaTokenService.TokenKey[](1);
        // keyType 16 (SUPPLY) per HIP-514 bitmask definitions
        keys[0] = IHederaTokenService.TokenKey({
            keyType: 16,
            key: address(this)
        });

        IHederaTokenService.HederaToken memory token = IHederaTokenService
            .HederaToken({
                name: name,
                symbol: symbol,
                treasury: address(this),
                memo: "USD token for cross-ledger loan",
                supplyType: maxSupply > 0, // false => infinite supply
                maxSupply: maxSupply,
                freezeDefault: false,
                tokenKeys: keys,
                expiry: IHederaTokenService.Expiry({
                    autoRenewAccount: address(this),
                    autoRenewPeriod: 60 * 60 * 24 * 30,
                    second: 0
                })
            });

        (int256 rc, address tokenAddr) = HTS_PRECOMPILE.createFungibleToken(
            token,
            initialSupply,
            uint32(decimals_)
        );
        require(rc == 22, "create failed"); // 22 = SUCCESS

        usdToken = tokenAddr;
        usdDecimals = decimals_;
        emit TokenCreated(tokenAddr, decimals_);
    }

    /**
     * @notice Registers an already-created HTS token as the USD instrument.
     */
    function setExistingUsdToken(address token, uint8 decimals_)
        external
        onlyOwner
    {
        require(usdToken == address(0), "already set");
        usdToken = token;
        usdDecimals = decimals_;
        emit TokenCreated(token, decimals_);
    }

    /**
     * @dev Mints USD to a borrower. Controller keeps treasury balance synced via HTS transfer.
     */
    function mintTo(address to, uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");

        bytes[] memory metadata = new bytes[](0);
        (int256 rc, , ) = HTS_PRECOMPILE.mintToken(usdToken, amount, metadata);
        require(rc == 22, "mint fail");

        IHederaTokenService.AccountAmount[]
            memory adjustments = new IHederaTokenService.AccountAmount[](2);
        int64 signedAmount = _toInt64(amount);
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
            transfers: adjustments
        });

        IHederaTokenService.AccountAmount[]
            memory emptyTransfers = new IHederaTokenService.AccountAmount[](0);
        IHederaTokenService.TransferList memory transferList = IHederaTokenService
            .TransferList({transfers: emptyTransfers});

        int256 xferRc = HTS_PRECOMPILE.cryptoTransfer(
            transferList,
            tokenTransfers
        );
        require(xferRc == 22, "xfer fail");

        emit Minted(to, amount);
    }

    /**
     * @dev Burns USD held in treasury after borrower repayment (tokens already transferred in).
     */
    function burnFromTreasury(uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");

        uint64[] memory emptySerials = new uint64[](0);
        (int256 rc, ) = HTS_PRECOMPILE.burnToken(
            usdToken,
            amount,
            emptySerials
        );
        require(rc == 22, "burn fail");

        emit Burned(amount);
    }

    /**
     * @notice Operational helper to pay HTS treasury balances out to an address.
     */
    function payFromTreasury(address to, uint64 amount) external onlyOwner {
        require(usdToken != address(0), "no token");

        IHederaTokenService.AccountAmount[]
            memory adjustments = new IHederaTokenService.AccountAmount[](2);
        int64 signedAmount = _toInt64(amount);
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
            transfers: adjustments
        });

        IHederaTokenService.AccountAmount[]
            memory emptyTransfers = new IHederaTokenService.AccountAmount[](0);
        IHederaTokenService.TransferList memory transferList = IHederaTokenService
            .TransferList({transfers: emptyTransfers});

        int256 rc = HTS_PRECOMPILE.cryptoTransfer(
            transferList,
            tokenTransfers
        );
        require(rc == 22, "xfer fail");

        emit TreasuryPaid(to, amount);
    }

    function _toInt64(uint64 amount) private pure returns (int64) {
        return SafeCast.toInt64(SafeCast.toInt256(uint256(amount)));
    }
}
