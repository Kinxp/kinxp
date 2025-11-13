// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HederaTokenService} from "@hashgraph/smart-contracts/contracts/system-contracts/hedera-token-service/HederaTokenService.sol";
import {HederaResponseCodes} from "@hashgraph/smart-contracts/contracts/system-contracts/HederaResponseCodes.sol";
import {LiquidityPoolV1} from "./LiquidityPoolV1.sol";

/// @title CrossChainDepositGateway
/// @notice Trusted LayerZero receiver that forwards bridged liquidity into LiquidityPoolV1.
contract CrossChainDepositGateway is HederaTokenService {
    address public owner;
    address public layerZeroEndpoint;
    LiquidityPoolV1 public immutable pool;
    IERC20 public immutable underlying;
    bool public gatewayReady;

    event CrossChainDepositReceived(uint16 srcChainId, address indexed receiver, uint256 amount);
    event LayerZeroEndpointUpdated(address indexed newEndpoint);
    event GatewayInitAttempt(address indexed caller, uint256 msgValue);
    event GatewayInitSkipped(address indexed caller);
    event GatewayInitialized(uint256 hbarDeposited);
    event GatewayFunded(address indexed sender, uint256 amount);
    event GatewayAssociateResult(address indexed token, int256 responseCode);
    event GatewayApproveResult(bool success, bytes data);
    event GatewayForwardResult(bool success, bytes data, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyEndpoint() {
        require(msg.sender == layerZeroEndpoint, "not endpoint");
        _;
    }

    constructor(address poolAddr, address underlyingToken, address endpoint, address owner_) {
        require(poolAddr != address(0), "pool=0");
        require(underlyingToken != address(0), "token=0");
        require(owner_ != address(0), "owner=0");
        owner = owner_;
        pool = LiquidityPoolV1(poolAddr);
        underlying = IERC20(underlyingToken);
        layerZeroEndpoint = endpoint;
    }

    function setLayerZeroEndpoint(address newEndpoint) external onlyOwner {
        layerZeroEndpoint = newEndpoint;
        emit LayerZeroEndpointUpdated(newEndpoint);
    }

    /// @notice One-time setup to associate with the underlying HTS token and grant approval to the pool.
    function initializeGateway() external payable onlyOwner {
        emit GatewayInitAttempt(msg.sender, msg.value);
        if (gatewayReady) {
            emit GatewayInitSkipped(msg.sender);
            return;
        }

        _associateWithSelf(address(underlying));
        _approvePoolAllowance();
        gatewayReady = true;

        emit GatewayInitialized(msg.value);
    }

    /// @notice Admin helper to exercise the flow without LayerZero.
    function adminDeposit(address receiver, uint256 amount) external onlyOwner {
        require(gatewayReady, "gateway not ready");
        _forwardUnderlying(amount);
        pool.depositFor(receiver, amount);
    }

    function onCrossChainDeposit(
        uint16 srcChainId,
        bytes calldata,
        bytes calldata payload
    ) external onlyEndpoint {
        require(gatewayReady, "gateway not ready");
        (address receiver, uint256 amount) = abi.decode(payload, (address, uint256));
        require(receiver != address(0), "receiver=0");
        require(amount > 0, "amount=0");
        _forwardUnderlying(amount);
        pool.depositFor(receiver, amount);
        emit CrossChainDepositReceived(srcChainId, receiver, amount);
    }

    receive() external payable {
        emit GatewayFunded(msg.sender, msg.value);
    }

    function _associateWithSelf(address token) private {
        int rc = associateToken(address(this), token);
        emit GatewayAssociateResult(token, rc);
    }

    function _approvePoolAllowance() private {
        (bool success, bytes memory data) = address(underlying).call(
            abi.encodeWithSelector(IERC20.approve.selector, address(pool), type(uint256).max)
        );
        emit GatewayApproveResult(success, data);
    }

    function _forwardUnderlying(uint256 amount) private {
        (bool success, bytes memory data) = address(underlying).call(
            abi.encodeWithSelector(IERC20.transfer.selector, address(pool), amount)
        );
        emit GatewayForwardResult(success, data, amount);
    }
}
