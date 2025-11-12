// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {HederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/HederaTokenService.sol";
import {IHederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/IHederaTokenService.sol";
import {HederaResponseCodes} from "@hashgraph/smart-contracts/contracts/system-contracts/HederaResponseCodes.sol";

/// @title UsdHtsController
/// @notice Controller for managing an existing HTS token (created via SimpleHtsToken)
/// @dev This contract manages minting, burning, and tracks treasury USD amounts
contract UsdHtsController is HederaTokenService, Ownable {
   
    uint64 private constant MAX_INT64 = uint64(type(int64).max);

    address public immutable treasuryAccount;
    address public usdToken;
    uint8 public usdDecimals;
    string public usdTokenName;
    string public usdTokenSymbol;
    bool public tokenInitialized;

    uint256 public mintCap; // 0 = unlimited
    uint256 public totalMinted;
    uint256 public totalBurned;
    bool public paused;

    // Treasury USD amounts tracking
    struct TreasuryInfo {
        address treasury;
        uint256 usdAmount; // Amount in token's smallest unit (with decimals)
        bool active;
    }

    mapping(address => TreasuryInfo) public treasuries;
    address[] public treasuryList; // List of all treasury addresses

    event TokenLinked(
        address indexed token,
        uint8 decimals,
        string name,
        string symbol
    );
    event TokenAssociated(address indexed token);
    event MintCapUpdated(uint256 newCap);
    event Minted(address indexed to, uint64 amount);
    event Burned(uint64 amount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event TreasuryAdded(address indexed treasury, uint256 initialAmount);
    event TreasuryUpdated(address indexed treasury, uint256 newAmount);
    event TreasuryRemoved(address indexed treasury);

    error TokenNotInitialized();
    error TokenAlreadyInitialized();
    error MintCapExceeded();
    error ControllerPaused();
    error InvalidRecipient();
    error InvalidAmount();
    error AmountExceedsInt64();
    error MintFailed(int64 rc);
    error TransferFailed(int64 rc);
    error BurnFailed(int64 rc);
    error AssociateFailed(int64 rc);
    error TreasuryNotFound();
    error TreasuryAlreadyExists();

    constructor(address owner_) {
        treasuryAccount = address(this);
        if (owner_ != address(0)) {
            _transferOwnership(owner_);
        }
    }

    /// @notice Links an existing HTS token to this controller
    /// @param tokenAddr Address of the existing token
    /// @param decimals_ Token decimals
    function setUsdToken(address tokenAddr, uint8 decimals_)
        external
        onlyOwner
    {
        if (tokenInitialized) revert TokenAlreadyInitialized();
        require(tokenAddr != address(0), "token=0");

        usdToken = tokenAddr;
        usdDecimals = _resolveDecimals(tokenAddr, decimals_);
        usdTokenName = _readName(tokenAddr);
        usdTokenSymbol = _readSymbol(tokenAddr);
        tokenInitialized = true;

        emit TokenLinked(tokenAddr, usdDecimals, usdTokenName, usdTokenSymbol);
    }

    /// @notice Associates this controller with the token
    /// @dev Must be called after setUsdToken to enable minting/burning
    function associateToken() external onlyOwner {
        if (!tokenInitialized) revert TokenNotInitialized();
        require(usdToken != address(0), "token=0");
        
        int rc = HederaTokenService.associateToken(address(this), usdToken);
        if (rc != HederaResponseCodes.SUCCESS) {
            revert AssociateFailed(int64(rc));
        }
        
        emit TokenAssociated(usdToken);
    }

    /// @notice Adds a treasury to track USD amounts
    /// @param treasury Treasury address
    /// @param initialAmount Initial USD amount (in token's smallest unit)
    function addTreasury(address treasury, uint256 initialAmount) external onlyOwner {
        require(treasury != address(0), "treasury=0");
        if (treasuries[treasury].active) revert TreasuryAlreadyExists();

        treasuries[treasury] = TreasuryInfo({
            treasury: treasury,
            usdAmount: initialAmount,
            active: true
        });
        treasuryList.push(treasury);

        emit TreasuryAdded(treasury, initialAmount);
    }

    /// @notice Updates USD amount for a treasury
    /// @param treasury Treasury address
    /// @param newAmount New USD amount (in token's smallest unit)
    function updateTreasuryAmount(address treasury, uint256 newAmount) external onlyOwner {
        if (!treasuries[treasury].active) revert TreasuryNotFound();
        
        treasuries[treasury].usdAmount = newAmount;
        emit TreasuryUpdated(treasury, newAmount);
    }

    /// @notice Removes a treasury from tracking
    /// @param treasury Treasury address
    function removeTreasury(address treasury) external onlyOwner {
        if (!treasuries[treasury].active) revert TreasuryNotFound();
        
        treasuries[treasury].active = false;
        
        // Remove from list (keep in mapping for historical data)
        for (uint i = 0; i < treasuryList.length; i++) {
            if (treasuryList[i] == treasury) {
                treasuryList[i] = treasuryList[treasuryList.length - 1];
                treasuryList.pop();
                break;
            }
        }
        
        emit TreasuryRemoved(treasury);
    }

    /// @notice Gets all active treasuries
    /// @return addresses Array of treasury addresses
    /// @return amounts Array of USD amounts
    function getAllTreasuries() external view returns (address[] memory addresses, uint256[] memory amounts) {
        uint256 activeCount = 0;
        for (uint i = 0; i < treasuryList.length; i++) {
            if (treasuries[treasuryList[i]].active) {
                activeCount++;
            }
        }

        addresses = new address[](activeCount);
        amounts = new uint256[](activeCount);
        
        uint256 idx = 0;
        for (uint i = 0; i < treasuryList.length; i++) {
            if (treasuries[treasuryList[i]].active) {
                addresses[idx] = treasuryList[i];
                amounts[idx] = treasuries[treasuryList[i]].usdAmount;
                idx++;
            }
        }
    }

    /// @notice Gets total USD amount across all treasuries
    /// @return total Total USD amount
    function getTotalTreasuryAmount() external view returns (uint256 total) {
        for (uint i = 0; i < treasuryList.length; i++) {
            if (treasuries[treasuryList[i]].active) {
                total += treasuries[treasuryList[i]].usdAmount;
            }
        }
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


    /// @notice Transfers tokens from controller treasury to recipient
    /// @param to Address to receive the tokens
    /// @param amount Amount to transfer
    function transferTo(address to, uint64 amount) external  {
        // if (paused) revert ControllerPaused();
        // if (!tokenInitialized) revert TokenNotInitialized();
        // if (to == address(0)) revert InvalidRecipient();
        // if (amount == 0) revert InvalidAmount();
        // if (amount > MAX_INT64) revert AmountExceedsInt64();

        int64 signedAmount = int64(uint64(amount));

        int rcXfer = HederaTokenService.transferToken(
            usdToken,
            treasuryAccount,
            to,
            signedAmount
        );
        // if (rcXfer != HederaResponseCodes.SUCCESS) {
        //     revert TransferFailed(int64(rcXfer));
        // }
        emit TreasuryAdded(address(this), uint256(rcXfer));

        emit Minted(to, amount); // Reusing event for transfer
    }

 

    /// @notice Transfers tokens from an address back to treasury (requires approval)
    /// @param from Address to transfer tokens from
    /// @param amount Amount to transfer
    function pullFrom(address from, uint64 amount) external onlyOwner {
        if (from == address(0)) revert InvalidRecipient();
        if (!tokenInitialized) revert TokenNotInitialized();
        if (amount == 0) revert InvalidAmount();
        if (amount > MAX_INT64) revert AmountExceedsInt64();

        uint256 transferAmount = uint256(amount);

        // Transfer from borrower to treasury (requires approval)
        int64 rcTransfer = this.transferFrom(
            usdToken,
            from,
            treasuryAccount,
            transferAmount
        );

        if (rcTransfer != HederaResponseCodes.SUCCESS) {
            revert TransferFailed(rcTransfer);
        }

        emit Minted(treasuryAccount, amount); // Reusing event for transfer back
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
