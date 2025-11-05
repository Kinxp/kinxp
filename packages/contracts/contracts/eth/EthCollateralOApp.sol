// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

bool constant OAPP_DISABLED = false;

import {
    OApp,
    MessagingFee,
    Origin
} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import {
    OptionsBuilder
} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";
import {
    MessagingParams
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

import {MessageTypes} from "../MessageTypes.sol";

/// @title EthCollateralOApp
/// @notice Locks ETH collateral per order and coordinates cross-chain repayment signals.
contract EthCollateralOApp is OApp, ReentrancyGuard {
    using OptionsBuilder for bytes;

    struct Order {
        address owner;
        bytes32 reserveId;
        uint256 amountWei;
        bool funded;
        bool repaid;
        bool liquidated;
    }

    mapping(bytes32 => Order) public orders;
    mapping(address => uint96) public nonces; // deterministic ids per borrower

    bytes32 public defaultReserveId;
    uint32 public hederaEid;

    event OrderCreated(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user);
    event OrderFunded(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user, uint256 amountWei);
    event OrderReserveUpdated(bytes32 indexed orderId, bytes32 indexed newReserveId);
    event MarkRepaid(bytes32 indexed orderId, bytes32 indexed reserveId);
    event Withdrawn(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user, uint256 amountWei);
    event Liquidated(bytes32 indexed orderId, bytes32 indexed reserveId, uint256 amountWei);

    constructor(address lzEndpoint, bytes32 defaultReserveId_) OApp(lzEndpoint, msg.sender) {
        defaultReserveId = defaultReserveId_;
    }

    /// @notice Creates an order tied to the default reserve.
    function createOrderId() external returns (bytes32 orderId) {
        return _createOrder(msg.sender, defaultReserveId);
    }

    /// @notice Creates an order bound to a specific reserve.
    function createOrderIdWithReserve(bytes32 reserveId) external returns (bytes32 orderId) {
        require(reserveId != bytes32(0), "reserve=0");
        return _createOrder(msg.sender, reserveId);
    }

    /// @notice Allows borrower to change the reserve prior to funding.
    function setOrderReserve(bytes32 orderId, bytes32 reserveId) external {
        Order storage o = orders[orderId];
        require(o.owner == msg.sender, "not owner");
        require(!o.funded, "already funded");
        require(reserveId != bytes32(0), "reserve=0");
        o.reserveId = reserveId;
        emit OrderReserveUpdated(orderId, reserveId);
    }

    /// @notice Funds collateral without notifying Hedera.
    function fundOrder(bytes32 orderId) external payable nonReentrant {
        _fund(orderId, msg.sender, msg.value);
    }

    /// @notice Funds collateral and notifies Hedera via LayerZero.
    function fundOrderWithNotify(bytes32 orderId, uint256 depositAmountWei)
        external
        payable
        nonReentrant
    {
        require(hederaEid != 0, "eid unset");
        _fundWithNotify(orderId, msg.sender, depositAmountWei);
    }

    /// @notice Quotes the LayerZero fee required to send a FUNDED message.
    function quoteOpenNativeFee(address /* borrower */, uint256 depositAmountWei)
        external
        view
        returns (uint256 nativeFee)
    {
        return _quoteOpenFee(defaultReserveId, depositAmountWei);
    }

    function quoteOpenNativeFeeWithReserve(bytes32 reserveId, uint256 depositAmountWei)
        external
        view
        returns (uint256 nativeFee)
    {
        return _quoteOpenFee(reserveId, depositAmountWei);
    }

    function markRepaid(bytes32) external pure {
        revert("use LayerZero message");
    }

    function withdraw(bytes32 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        require(o.owner == msg.sender, "not owner");
        require(o.funded && o.repaid, "not repaid");
        require(!o.liquidated, "liquidated");

        uint256 amt = o.amountWei;
        o.amountWei = 0;
        o.funded = false;

        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "eth send fail");

        emit Withdrawn(orderId, o.reserveId, msg.sender, amt);
    }

    function adminLiquidate(bytes32 orderId, address payout)
        external
        payable
        nonReentrant
        onlyOwner
    {
        require(hederaEid != 0, "eid unset");
        Order storage o = orders[orderId];
        require(o.funded && !o.repaid, "nothing to liquidate");
        o.liquidated = true;

        uint256 amt = o.amountWei;
        o.amountWei = 0;

        (bool ok, ) = payout.call{value: amt}("");
        require(ok, "send fail");

        bytes memory payload = abi.encode(MessageTypes.LIQUIDATED, orderId, o.reserveId);
        bytes memory opts = _getMessageOptions();
        MessagingFee memory q = _quote(hederaEid, payload, opts, false);
        require(msg.value >= q.nativeFee, "insufficient msg.value");

        _sendLzMessage(hederaEid, payload, opts, q.nativeFee, msg.sender);

        emit Liquidated(orderId, o.reserveId, amt);

        uint256 refund = msg.value - q.nativeFee;
        if (refund > 0) {
            (bool refundOk, ) = msg.sender.call{value: refund}("");
            require(refundOk, "refund fail");
        }
    }

    function quoteLiquidationFee(bytes32 orderId) external view returns (uint256 nativeFee) {
        require(hederaEid != 0, "eid unset");
        Order storage o = orders[orderId];
        bytes memory payload = abi.encode(MessageTypes.LIQUIDATED, orderId, o.reserveId);
        bytes memory opts = _getMessageOptions();
        MessagingFee memory q = _quote(hederaEid, payload, opts, false);
        return q.nativeFee;
    }

    function setDefaultReserve(bytes32 newDefault) external onlyOwner {
        defaultReserveId = newDefault;
    }

    function setHederaEid(uint32 _eid) external onlyOwner {
        hederaEid = _eid;
    }

    /// ---------------------------------------------------------------------
    /// LayerZero Receive
    /// ---------------------------------------------------------------------

    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        uint8 msgType = uint8(message[0]);
        if (msgType == MessageTypes.REPAID) {
            (, bytes32 orderId, bytes32 reserveId) = abi.decode(
                message,
                (uint8, bytes32, bytes32)
            );
            Order storage o = orders[orderId];
            if (o.reserveId == reserveId) {
                o.repaid = true;
                emit MarkRepaid(orderId, reserveId);
            }
        }
    }

    /// ---------------------------------------------------------------------
    /// Internal helpers
    /// ---------------------------------------------------------------------

    function _createOrder(address user, bytes32 reserveId) internal returns (bytes32 orderId) {
        uint96 n = ++nonces[user];
        orderId = keccak256(abi.encode(user, n, block.chainid, reserveId));
        orders[orderId] = Order({
            owner: user,
            reserveId: reserveId,
            amountWei: 0,
            funded: false,
            repaid: false,
            liquidated: false
        });
        emit OrderCreated(orderId, reserveId, user);
    }

    function _fund(bytes32 orderId, address sender, uint256 value) internal {
        require(value > 0, "no ETH");
        Order storage o = orders[orderId];
        require(o.owner == sender, "not owner");
        require(!o.funded, "already funded");
        require(o.reserveId != bytes32(0), "reserve unset");

        o.amountWei = value;
        o.funded = true;

        emit OrderFunded(orderId, o.reserveId, sender, value);
    }

    function _fundWithNotify(
        bytes32 orderId,
        address sender,
        uint256 depositAmountWei
    ) internal {
        Order storage o = orders[orderId];
        require(o.owner == sender, "not owner");
        require(!o.funded, "already funded");
        require(o.reserveId != bytes32(0), "reserve unset");
        require(depositAmountWei > 0, "no ETH");
        require(msg.value >= depositAmountWei, "insufficient msg.value");

        bytes memory payload = abi.encode(
            MessageTypes.FUNDED,
            orderId,
            o.reserveId,
            sender,
            depositAmountWei
        );
        bytes memory opts = _getMessageOptions();
        MessagingFee memory q = _quote(hederaEid, payload, opts, false);

        uint256 feeProvided = msg.value - depositAmountWei;
        require(feeProvided >= q.nativeFee, "insufficient msg.value");

        o.amountWei = depositAmountWei;
        o.funded = true;
        emit OrderFunded(orderId, o.reserveId, sender, depositAmountWei);

        _sendLzMessage(hederaEid, payload, opts, q.nativeFee, sender);

        uint256 refund = feeProvided - q.nativeFee;
        if (refund > 0) {
            (bool ok, ) = payable(sender).call{value: refund}("");
            require(ok, "refund fail");
        }
    }

    function _sendLzMessage(
        uint32 dstEid,
        bytes memory payload,
        bytes memory opts,
        uint256 nativeFeePaid,
        address refundAddress
    ) internal virtual {
        endpoint.send{value: nativeFeePaid}(
            MessagingParams(
                dstEid,
                _getPeerOrRevert(dstEid),
                payload,
                opts,
                false
            ),
            refundAddress
        );
    }

    function _getMessageOptions() private pure returns (bytes memory messageOptions) {
        return OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0);
    }

    function _quoteOpenFee(bytes32 reserveId, uint256 depositAmountWei) internal view returns (uint256 nativeFee) {
        require(hederaEid != 0, "eid unset");
        bytes memory payload = abi.encode(
            MessageTypes.FUNDED,
            bytes32(0),
            reserveId,
            address(0),
            depositAmountWei
        );
        bytes memory opts = _getMessageOptions();
        MessagingFee memory q = _quote(hederaEid, payload, opts, false);
        return q.nativeFee;
    }
}
