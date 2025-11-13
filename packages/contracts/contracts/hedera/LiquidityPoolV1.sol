// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/HederaTokenService.sol";
import {IHederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/IHederaTokenService.sol";
import {KeyHelper} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/KeyHelper.sol";
import {HederaResponseCodes} from "@hashgraph/smart-contracts/contracts/system-contracts/HederaResponseCodes.sol";

/// @title LiquidityPoolV1
/// @notice Single-asset liquidity pool with LP + reward HTS tokens and a cross-chain deposit gateway hook.
contract LiquidityPoolV1 is HederaTokenService, KeyHelper {
    uint256 private constant MAX_INT64 = (1 << 63) - 1;

    address public immutable underlyingToken;
    address public lpToken;
    address public rewardToken;
    address public depositGateway;

    address public owner;
    bool public initialized;
    bool public rewardsInitialized;

    uint256 public totalUnderlying;
    uint256 public totalLpShares;
    mapping(address => uint256) public lpBalances;

    // Rewards accounting
    uint256 public rewardPerShare; // scaled by 1e18
    uint64 public lastRewardUpdateTime;
    uint256 public rewardRatePerSecond;
    mapping(address => uint256) public userRewardDebt;
    mapping(address => uint256) public accruedRewards;

    event Deposit(address indexed user, uint256 amountIn, uint256 lpMinted);
    event Withdraw(address indexed user, uint256 amountOut, uint256 lpBurned);
    event LpTokenCreated(address indexed token);
    event RewardTokenCreated(address indexed token);
    event ClaimRewards(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);
    event DepositGatewayUpdated(address indexed gateway);

    error ZeroAmount();
    error InsufficientLiquidity();
    error HederaTokenError(int64 code);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address underlyingToken_, address owner_) {
        require(underlyingToken_ != address(0), "UNDERLYING_ZERO");
        require(owner_ != address(0), "OWNER_ZERO");
        owner = owner_;
        underlyingToken = underlyingToken_;
    }

    function setDepositGateway(address gateway) external onlyOwner {
        depositGateway = gateway;
        emit DepositGatewayUpdated(gateway);
    }

    function createLpToken(string calldata name, string calldata symbol, uint8 decimals) external payable onlyOwner {
        require(lpToken == address(0), "lp exists");
        require(msg.value > 0, "fee required");

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        keys[1] = getSingleKey(KeyType.ADMIN, KeyValueType.CONTRACT_ID, address(this));

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry(0, address(this), 7_890_000);

        IHederaTokenService.HederaToken memory tokenConfig = IHederaTokenService.HederaToken(
            name,
            symbol,
            address(this),
            "LP Token",
            false,
            int64(0),
            false,
            keys,
            expiry
        );

        (int responseCode, address tokenAddress) = HederaTokenService.createFungibleToken(
            tokenConfig,
            int64(0),
            int32(uint32(decimals))
        );
        _checkResponse(responseCode);

        lpToken = tokenAddress;
        initialized = true;
        _associateWithSelf(underlyingToken);
        _associateWithSelf(lpToken);

        emit LpTokenCreated(tokenAddress);
    }

    function createRewardToken(string calldata name, string calldata symbol, uint8 decimals) external payable onlyOwner {
        require(rewardToken == address(0), "reward exists");
        require(msg.value > 0, "fee required");

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        keys[1] = getSingleKey(KeyType.ADMIN, KeyValueType.CONTRACT_ID, address(this));

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry(0, address(this), 7_890_000);

        IHederaTokenService.HederaToken memory tokenConfig = IHederaTokenService.HederaToken(
            name,
            symbol,
            address(this),
            "Reward Token",
            false,
            int64(0),
            false,
            keys,
            expiry
        );

        (int responseCode, address tokenAddress) = HederaTokenService.createFungibleToken(
            tokenConfig,
            int64(0),
            int32(uint32(decimals))
        );
        _checkResponse(responseCode);

        rewardToken = tokenAddress;
        rewardsInitialized = true;
        lastRewardUpdateTime = uint64(block.timestamp);
        _associateWithSelf(rewardToken);

        emit RewardTokenCreated(tokenAddress);
    }

    function setRewardRate(uint256 newRatePerSecond) external onlyOwner {
        require(rewardsInitialized, "reward token missing");
        _updateRewards();
        rewardRatePerSecond = newRatePerSecond;
        emit RewardRateUpdated(newRatePerSecond);
    }

    function deposit(uint256 amount) external {
        require(initialized, "not initialized");
        if (amount == 0) revert ZeroAmount();

        _updateRewards();
        _harvest(msg.sender);

        IERC20(underlyingToken).transferFrom(msg.sender, address(this), amount);

        uint256 lpToMint = _previewDeposit(amount);
        require(lpToMint > 0, "LP_ZERO");

        totalUnderlying += amount;
        totalLpShares += lpToMint;
        lpBalances[msg.sender] += lpToMint;

        _mintLpTo(msg.sender, lpToMint);
        _syncRewardDebt(msg.sender);

        emit Deposit(msg.sender, amount, lpToMint);
    }

    function depositFor(address receiver, uint256 amount) external {
        require(initialized, "not initialized");
        require(msg.sender == depositGateway, "not gateway");
        require(receiver != address(0), "receiver=0");
        if (amount == 0) revert ZeroAmount();

        _updateRewards();
        _harvest(receiver);

        uint256 expectedBalance = totalUnderlying + amount;
        IERC20 token = IERC20(underlyingToken);
        uint256 currentBalance = token.balanceOf(address(this));
        if (currentBalance < expectedBalance) {
            try token.transferFrom(msg.sender, address(this), amount) {
                currentBalance = token.balanceOf(address(this));
            } catch {}
            require(currentBalance >= expectedBalance, "gateway funding missing");
        }

        uint256 lpToMint = _previewDeposit(amount);
        require(lpToMint > 0, "LP_ZERO");

        totalUnderlying += amount;
        totalLpShares += lpToMint;
        lpBalances[receiver] += lpToMint;

        _mintLpTo(receiver, lpToMint);
        _syncRewardDebt(receiver);

        emit Deposit(receiver, amount, lpToMint);
    }

    function withdraw(uint256 lpShares) external {
        require(initialized, "not initialized");
        if (lpShares == 0) revert ZeroAmount();
        if (lpShares > totalLpShares) revert InsufficientLiquidity();
        require(lpBalances[msg.sender] >= lpShares, "insufficient balance");

        uint256 amountOut = (lpShares * totalUnderlying) / totalLpShares;
        if (amountOut == 0) revert InsufficientLiquidity();

        _updateRewards();
        _harvest(msg.sender);

        totalUnderlying -= amountOut;
        totalLpShares -= lpShares;
        lpBalances[msg.sender] -= lpShares;

        IERC20(lpToken).transferFrom(msg.sender, address(this), lpShares);
        _burnLp(lpShares);
        IERC20(underlyingToken).transfer(msg.sender, amountOut);
        _syncRewardDebt(msg.sender);

        emit Withdraw(msg.sender, amountOut, lpShares);
    }

    function claimRewards() external {
        require(rewardsInitialized, "no rewards");
        _updateRewards();
        _harvest(msg.sender);
        uint256 pending = accruedRewards[msg.sender];
        require(pending > 0, "no rewards");
        accruedRewards[msg.sender] = 0;
        _mintReward(msg.sender, pending);
        emit ClaimRewards(msg.sender, pending);
    }

    function pendingRewards(address user) external view returns (uint256) {
        if (!rewardsInitialized) return 0;
        uint256 tempPerShare = rewardPerShare;
        if (block.timestamp > lastRewardUpdateTime && totalLpShares > 0) {
            uint256 dt = block.timestamp - lastRewardUpdateTime;
            uint256 totalReward = dt * rewardRatePerSecond;
            tempPerShare += (totalReward * 1e18) / totalLpShares;
        }
        uint256 accumulated = (lpBalances[user] * tempPerShare) / 1e18;
        return accumulated - userRewardDebt[user] + accruedRewards[user];
    }

    function getExchangeRate() public view returns (uint256) {
        if (totalLpShares == 0) {
            return 1e18;
        }
        return (totalUnderlying * 1e18) / totalLpShares;
    }

    function _previewDeposit(uint256 amount) private view returns (uint256) {
        if (totalLpShares == 0 || totalUnderlying == 0) {
            return amount;
        }
        return (amount * totalLpShares) / totalUnderlying;
    }

    function _mintLpTo(address recipient, uint256 amount) private {
        int64 amt = _toInt64(amount);
        bytes[] memory metadata = new bytes[](0);
        (int response,,) = mintToken(lpToken, amt, metadata);
        _checkResponse(response);

        int transferRc = transferToken(lpToken, address(this), recipient, amt);
        _checkResponse(transferRc);
    }

    function _burnLp(uint256 amount) private {
        int64 amt = _toInt64(amount);
        int64[] memory serials = new int64[](0);
        (int burnRc,) = burnToken(lpToken, amt, serials);
        _checkResponse(burnRc);
    }

    function _mintReward(address recipient, uint256 amount) private {
        int64 amt = _toInt64(amount);
        bytes[] memory metadata = new bytes[](0);
        (int response,,) = mintToken(rewardToken, amt, metadata);
        _checkResponse(response);
        IERC20(rewardToken).transfer(recipient, amount);
    }

    function _associateWithSelf(address token) private {
        int rc = associateToken(address(this), token);
        if (rc != HederaResponseCodes.SUCCESS && rc != HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT) {
            revert HederaTokenError(int64(rc));
        }
    }

    function _updateRewards() private {
        if (!rewardsInitialized) return;
        uint256 current = block.timestamp;
        if (current <= lastRewardUpdateTime) return;
        uint256 totalShares = totalLpShares;
        if (totalShares == 0) {
            lastRewardUpdateTime = uint64(current);
            return;
        }
        uint256 dt = current - lastRewardUpdateTime;
        uint256 totalReward = dt * rewardRatePerSecond;
        rewardPerShare += (totalReward * 1e18) / totalShares;
        lastRewardUpdateTime = uint64(current);
    }

    function _harvest(address user) private {
        if (!rewardsInitialized) return;
        uint256 accumulated = (lpBalances[user] * rewardPerShare) / 1e18;
        uint256 pending = accumulated - userRewardDebt[user];
        if (pending > 0) {
            accruedRewards[user] += pending;
        }
    }

    function _syncRewardDebt(address user) private {
        if (!rewardsInitialized) return;
        userRewardDebt[user] = (lpBalances[user] * rewardPerShare) / 1e18;
    }

    function _toInt64(uint256 amount) private pure returns (int64) {
        require(amount <= MAX_INT64, "AMOUNT_TOO_LARGE");
        return int64(int256(amount));
    }

    function _checkResponse(int responseCode) private pure {
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert HederaTokenError(int64(responseCode));
        }
    }
}
