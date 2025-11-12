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
        uint256 unlockedWei; 
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
    event Liquidated(bytes32 indexed orderId, bytes32 indexed reserveId, uint256 amountWei, address indexed payout);

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

    /// @notice Withdraws the MAXIMUM available unlocked collateral for an order.
    /// @dev This single function handles both partial and full withdrawals by
    /// withdrawing the entire current `unlockedWei` balance.
    /// @param orderId The ID of the order to withdraw from.
    function withdraw(bytes32 orderId) external nonReentrant {
        Order storage o = orders[orderId];

        // 1. Determine Amount & Verify Conditions
        uint256 amountToWithdraw = o.unlockedWei;

        require(o.owner == msg.sender, "not owner");
        require(o.funded, "order not funded or already closed");
        require(amountToWithdraw > 0, "no unlocked collateral to withdraw");
        // This is a safeguard against inconsistent state. It should never fail if the logic is correct elsewhere.
        require(amountToWithdraw <= o.amountWei, "consistency check failed: unlocked > total collateral");

        // 2. Update State (Effects) - BEFORE sending ETH
        // The entire unlocked balance is being withdrawn, so reset it to zero.
        o.unlockedWei = 0;
        // Reduce the total collateral held by the contract by the amount withdrawn.
        o.amountWei -= amountToWithdraw;

        // If all collateral has been withdrawn, fully close the order.
        if (o.amountWei == 0) {
            o.funded = false;
        }

        // 3. Send ETH (Interaction)
        (bool ok, ) = msg.sender.call{value: amountToWithdraw}("");
        require(ok, "eth send fail");

        emit Withdrawn(orderId, o.reserveId, msg.sender, amountToWithdraw);
    }
    
    function adminLiquidate(bytes32 orderId, address payout, uint256 seizeAmountWei)
        external
        payable
        nonReentrant
        onlyOwner
    {
        require(hederaEid != 0, "eid unset");
        Order storage o = orders[orderId];
        require(o.funded && !o.repaid, "nothing to liquidate");

        uint256 available = o.amountWei;
        uint256 amt = seizeAmountWei == 0 ? available : seizeAmountWei;
        if (amt > available) {
            amt = available;
        }
        o.amountWei = available - amt;
        o.liquidated = (o.amountWei == 0);

        (bool ok, ) = payout.call{value: amt}("");
        require(ok, "send fail");

        bytes memory payload = _encodeLiquidationPayload(orderId, o.reserveId, payout, amt);
        bytes memory opts = _getMessageOptions();
        MessagingFee memory q = _quote(hederaEid, payload, opts, false);
        require(msg.value >= q.nativeFee, "insufficient msg.value");

        _sendLzMessage(hederaEid, payload, opts, q.nativeFee, msg.sender);

        emit Liquidated(orderId, o.reserveId, amt, payout);

        uint256 refund = msg.value - q.nativeFee;
        if (refund > 0) {
            (bool refundOk, ) = msg.sender.call{value: refund}("");
            require(refundOk, "refund fail");
        }
    }

    function quoteLiquidationFee(bytes32 orderId, address payout, uint256 seizeAmountWei) external view returns (uint256 nativeFee) {
        require(hederaEid != 0, "eid unset");
        Order storage o = orders[orderId];
        bytes memory payload = _encodeLiquidationPayload(orderId, o.reserveId, payout, seizeAmountWei);
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
        require(message.length > 0, "Empty message received");
        uint8 msgType = uint8(message[0]);

        if (msgType == MessageTypes.REPAID) {
            (
                ,
                bytes32 orderId,
                bytes32 reserveId,
                bool fullyRepaid,
                uint256 collateralToUnlock
            ) = abi.decode(message, (uint8, bytes32, bytes32, bool, uint256));
            
            Order storage o = orders[orderId];
            require(o.funded, "order not funded");
            
            if (fullyRepaid) {
                // Full repayment - mark as repaid so user can withdraw all
                o.repaid = true;
                
                emit MarkRepaid(orderId, reserveId);
            } else {
                // Partial repayment - reduce collateral (user can withdraw unlocked portion)
                require(collateralToUnlock <= o.amountWei, "unlock amount exceeds collateral");
                
                o.amountWei -= collateralToUnlock;
                
                // Note: No event defined for partial repayment in original contract
                // You may want to add: emit PartialRepayment(orderId, reserveId, collateralToUnlock, o.amountWei);
            }
        } else if (msgType == MessageTypes.LIQUIDATED) {
            try this.decodeLiquidationPayload(message) returns (
                bytes32 orderId,
                bytes32 reserveId,
                address payout,
                uint256 seizeWei
            ) {
                _applyLiquidation(orderId, reserveId, payout, seizeWei);
            } catch {
                // fallback to legacy payload (no payout/seize info)
                (, bytes32 orderIdLegacy, bytes32 reserveIdLegacy) = abi.decode(
                    message,
                    (uint8, bytes32, bytes32)
                );
                _applyLiquidation(orderIdLegacy, reserveIdLegacy, orders[orderIdLegacy].owner, orders[orderIdLegacy].amountWei);
            }
        }
    }
    function decodeLiquidationPayload(
        bytes calldata message
    )
        external
        pure
        returns (bytes32 orderId, bytes32 reserveId, address payout, uint256 seizeWei)
    {
        ( , orderId, reserveId, payout, seizeWei) = abi.decode(
            message,
            (uint8, bytes32, bytes32, address, uint256)
        );
    }

    function _applyLiquidation(
        bytes32 orderId,
        bytes32 reserveId,
        address payout,
        uint256 seizeWei
    ) private {
        Order storage o = orders[orderId];
        require(o.reserveId == reserveId, "reserve mismatch");
        uint256 amount = seizeWei > o.amountWei ? o.amountWei : seizeWei;
        o.amountWei -= amount;
        if (o.amountWei == 0) {
            o.liquidated = true;
        }
        (bool ok, ) = payout.call{value: amount}("");
        require(ok, "eth send fail");
        emit Liquidated(orderId, reserveId, amount, payout);
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
            unlockedWei:0,
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

    function _encodeLiquidationPayload(
        bytes32 orderId,
        bytes32 reserveId,
        address payout,
        uint256 seizeWei
    ) private pure returns (bytes memory) {
        return abi.encode(
            MessageTypes.LIQUIDATED,
            orderId,
            reserveId,
            payout,
            seizeWei
        );
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

    /// @notice Admin function to manually mirror repayment for testing (when LayerZero is offline)
    /// @dev This simulates the _lzReceive REPAID message handling - ONLY updates state, doesn't transfer ETH
    /// @dev ETH transfer happens when user calls withdraw() separately
    function adminMirrorRepayment(
        bytes32 orderId,
        bytes32 reserveId,
        bool fullyRepaid,
        uint256 collateralToUnlock
    ) external onlyOwner {
        Order storage o = orders[orderId];
        require(o.funded, "order not funded");
        require(collateralToUnlock <= o.amountWei, "unlock amount exceeds total collateral");

        // Add the unlocked amount to the withdrawable balance
        o.unlockedWei += collateralToUnlock;

        if (fullyRepaid) {
            o.repaid = true;
            emit MarkRepaid(orderId, reserveId);
        }
    }
}
