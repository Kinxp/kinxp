// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {HederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/HederaTokenService.sol";
import {IHederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/IHederaTokenService.sol";
import {HederaResponseCodes} from "@hashgraph/smart-contracts/contracts/system-contracts/HederaResponseCodes.sol";
import {KeyHelper} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/KeyHelper.sol";


/// @title UsdHtsController
/// @notice Governance controlled helper around the Hedera Token Service for a fungible HTS token.
contract UsdHtsController is HederaTokenService, KeyHelper,  Ownable {
    uint64 private constant MAX_INT64 = uint64(type(int64).max);
    int64 private constant DEFAULT_AUTO_RENEW = 7_776_000; // 90 days

    address public immutable treasuryAccount;

    address public usdToken;
    uint8 public usdDecimals;
    string public usdTokenName;
    string public usdTokenSymbol;

    uint256 public mintCap; // 0 = unlimited
    uint256 public totalMinted;
    uint256 public totalBurned;
    bool public paused;

    event TokenCreated(
        address indexed token,
        uint8 decimals,
        string name,
        string symbol
    );
    event MintCapUpdated(uint256 newCap);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event MintAttempt(
        address indexed caller,
        address indexed to,
        uint64 amount,
        int64 rcMint,
        int64 rcTransfer,
        uint256 totalMintedBefore,
        uint256 totalMintedAfter
    );

    struct MintDebugData {
        address owner;
        address treasury;
        address usdToken;
        uint8 usdTokenDecimals;
        bool paused;
        uint256 mintCap;
        uint256 totalMinted;
        uint256 totalBurned;
        bool tokenInitialized;
    }

    error TokenAlreadyInitialized();
    error TokenNotInitialized();
    error MintCapExceeded();
    error ControllerPaused();
    error InvalidRecipient();
    error InvalidAmount();
    error AmountExceedsInt64();
    error MintFailed(int64 rc);
    error TransferFailed(int64 rc);
    error BurnFailed(int64 rc);
    error AssociateFailed(int64 rc);
    error TokenCreateFailed(int64 rc);

    constructor(address owner_) {
        treasuryAccount = address(this);
        if (owner_ != address(0)) {
            _transferOwnership(owner_);
        }
    }

    /// @notice Deploys a new fungible HTS token where this contract is the treasury and supply/admin key.
    function createUsdToken(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        string memory memo_
    ) external payable onlyOwner returns (address tokenAddr) {
        if (usdToken != address(0)) revert TokenAlreadyInitialized();
        require(bytes(name_).length != 0, "name empty");
        require(bytes(symbol_).length != 0, "symbol empty");

    


        IHederaTokenService.HederaToken memory token;
        token.name = "USD Token";
        token.symbol = "USDT";
        token.treasury = address(this);
        token.memo = "USD stablecoin";
        token.tokenSupplyType = true; // true = FINITE, false = INFINITE
        token.maxSupply = int64(1000000000000000000);

        // // Set keys (admin and supply) to contract address
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        keys[1] = getSingleKey(KeyType.ADMIN, KeyValueType.CONTRACT_ID, address(this));
        token.tokenKeys = keys;

        (int responseCode, address tokenAddress) = createFungibleToken(
            token,
            int64(0),      // initial supplys
            int32(6)       // decimals
        );
        require(responseCode == 22, "Token failed to create"); // 22 = SUCCESS

        // emit MintAttempt(
        //     msg.sender,
        //     msg.sender,
        //     uint64(0),
        //     int64(rc),
        //     int64(rc),
        //     0,
        //     0
        // );
        usdToken = tokenAddress;
        usdDecimals = decimals_;
        usdTokenName = name_;
        usdTokenSymbol = symbol_;

        emit TokenCreated(tokenAddress, decimals_, name_, symbol_);
        return tokenAddress;
    }

    /// @notice Links an already created HTS token (must have transferred the supply key here beforehand).
    function setExistingUsdToken(address tokenAddr, uint8 decimals_)
        external
        onlyOwner
    {
        if (usdToken != address(0)) revert TokenAlreadyInitialized();
        require(tokenAddr != address(0), "token=0");

        usdToken = tokenAddr;
        usdDecimals = _resolveDecimals(tokenAddr, decimals_);
        usdTokenName = _readName(tokenAddr);
        usdTokenSymbol = _readSymbol(tokenAddr);

        emit TokenCreated(tokenAddr, usdDecimals, usdTokenName, usdTokenSymbol);
    }

    function associateToken(address tokenAddr) external onlyOwner {
        require(tokenAddr != address(0), "token=0");
        int rc = HederaTokenService.associateToken(address(this), tokenAddr);
        if (rc != HederaResponseCodes.SUCCESS) revert AssociateFailed(int64(rc));
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

    function mintTo(address to, uint64 amount) external onlyOwner {
        // if (paused) revert ControllerPaused();
        // if (usdToken == address(0)) revert TokenNotInitialized();
        // if (to == address(0)) revert InvalidRecipient();
        // if (amount == 0) revert InvalidAmount();
        // if (amount > MAX_INT64) revert AmountExceedsInt64();
        // if (mintCap != 0 && totalMinted + amount > mintCap) {
        //     revert MintCapExceeded();
        // }

        int64 signedAmount = int64(uint64(amount));

        // Fungible mint uses amount; metadata array can be empty
        bytes[] memory metadata = new bytes[](0);
        (int rcMint, , ) = HederaTokenService.mintToken(
            usdToken,
            signedAmount,
            metadata
        );
        // if (rcMint != HederaResponseCodes.SUCCESS) revert MintFailed(int64(rcMint));

        int64 rcTransfer = int64(HederaResponseCodes.SUCCESS);
        if (to != treasuryAccount) {
            int rcXfer = HederaTokenService.transferToken(
                usdToken,
                treasuryAccount,
                to,
                signedAmount
            );
            rcTransfer = int64(rcXfer);
            // if (rcXfer != HederaResponseCodes.SUCCESS) revert TransferFailed(int64(rcXfer));
        }

        uint256 beforeMint = totalMinted;
        totalMinted = beforeMint + amount;

        emit MintAttempt(
            msg.sender,
            to,
            amount,
            int64(rcMint),
            rcTransfer,
            beforeMint,
            totalMinted
        );
        emit Minted(to, amount);
    }

    function burnFromTreasury(uint64 amount) external onlyOwner {
        if (usdToken == address(0)) revert TokenNotInitialized();
        if (amount == 0) revert InvalidAmount();
        if (amount > MAX_INT64) revert AmountExceedsInt64();

        int64 signedAmount = int64(uint64(amount));

        // For fungible tokens, pass an empty int64[] for serials
        int64[] memory serials = new int64[](0);
        (int rcBurn, ) = HederaTokenService.burnToken(
            usdToken,
            signedAmount,
            serials
        );
        // if (rcBurn != HederaResponseCodes.SUCCESS) revert BurnFailed(int64(rcBurn));

        totalBurned += amount;
        emit Burned(amount);
    }


    function debugMintStatus(address)
        external
        view
        returns (MintDebugData memory data)
    {
        data.owner = owner();
        data.treasury = treasuryAccount;
        data.usdToken = usdToken;
        data.usdTokenDecimals = usdDecimals;
        data.paused = paused;
        data.mintCap = mintCap;
        data.totalMinted = totalMinted;
        data.totalBurned = totalBurned;
        data.tokenInitialized = usdToken != address(0);
    }

    function _contractKeys()
        internal
        view
        returns (IHederaTokenService.TokenKey[] memory keys)
    {
        keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = _contractKey(1 << 0); // ADMIN
        keys[1] = _contractKey(1 << 4); // SUPPLY
    }

    function _contractKey(uint keyType)
        internal
        view
        returns (IHederaTokenService.TokenKey memory tokenKey)
    {
        tokenKey.keyType = keyType;
        tokenKey.key = IHederaTokenService.KeyValue({
            inheritAccountKey: false,
            contractId: address(this),
            ed25519: "",
            ECDSA_secp256k1: "",
            delegatableContractId: address(0)
        });
    }

    function _readName(address tokenAddr) private view returns (string memory) {
        if (tokenAddr.code.length == 0) {
            return "";
        }
        try IERC20Metadata(tokenAddr).name() returns (string memory name_) {
            return name_;
        } catch {
            return "";
        }
    }

    function _readSymbol(address tokenAddr) private view returns (string memory) {
        if (tokenAddr.code.length == 0) {
            return "";
        }
        try IERC20Metadata(tokenAddr).symbol() returns (string memory symbol_) {
            return symbol_;
        } catch {
            return "";
        }
    }

    function _resolveDecimals(address tokenAddr, uint8 fallbackDecimals)
        private
        view
        returns (uint8)
    {
        if (tokenAddr.code.length == 0) {
            return fallbackDecimals;
        }
        try IERC20Metadata(tokenAddr).decimals() returns (uint8 resolved) {
            return resolved;
        } catch {
            return fallbackDecimals;
        }
    }

    receive() external payable {}
}