// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// === LayerZero v2 (optional, pure messaging — no bridging) ===
// If you do not want cross-chain messages yet, set OAPP_DISABLED = true.
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

/**
 * @title EthCollateralOApp
 * @notice Locks ETH against an order id and optionally coordinates with Hedera via LayerZero.
 */
contract EthCollateralOApp is OApp, ReentrancyGuard {
    using OptionsBuilder for bytes;

    event OrderCreated(bytes32 indexed orderId, address indexed user);
    event OrderFunded(
        bytes32 indexed orderId,
        address indexed user,
        uint256 amountWei
    );
    event MarkRepaid(bytes32 indexed orderId);
    event Withdrawn(
        bytes32 indexed orderId,
        address indexed user,
        uint256 amountWei
    );
    event Liquidated(bytes32 indexed orderId, uint256 amountWei);

    struct Order {
        address owner;
        uint256 amountWei;
        bool funded;
        bool repaid;
        bool liquidated;
    }

    mapping(bytes32 => Order) public orders;
    mapping(address => uint96) public nonces; // user-scoped nonce for deterministic IDs

    // ===== LayerZero config (optional) =====
    // local endpoint address is injected via constructor; remote Hedera eid is set post-deploy
    uint32 public hederaEid;

    constructor(address lzEndpoint) OApp(lzEndpoint, msg.sender) {}

    /// @notice Deterministic per-user order id. User funds later with fundOrder().
    function createOrderId() external returns (bytes32 orderId) {
        uint96 n = ++nonces[msg.sender];
        orderId = keccak256(abi.encode(msg.sender, n, block.chainid));
        orders[orderId] = Order({
            owner: msg.sender,
            amountWei: 0,
            funded: false,
            repaid: false,
            liquidated: false
        });
        emit OrderCreated(orderId, msg.sender);
    }

    /// @notice Fund ETH for an existing id. Emits events the UI can check on Blockscout.
    function fundOrder(bytes32 orderId) external payable nonReentrant {
        Order storage o = orders[orderId];
        require(o.owner == msg.sender, "not owner");
        require(!o.funded, "already funded");
        require(msg.value > 0, "no ETH");

        o.amountWei = msg.value;
        o.funded = true;
        emit OrderFunded(orderId, msg.sender, msg.value);

        if (!OAPP_DISABLED && hederaEid != 0) {
            bytes memory payload = abi.encode(
                MessageTypes.FUNDED,
                orderId,
                msg.sender,
                msg.value
            );
            bytes memory opts = OptionsBuilder
                .newOptions()
                .addExecutorLzReceiveOption(200_000, 0);

            _sendLzMessage(hederaEid, payload, opts, 0, msg.sender);
        }
    }

    /// @notice Quote the LayerZero native fee the sender must include to notify Hedera of an OPEN.
    function quoteOpenNativeFee(address borrower, uint256 depositAmountWei)
        external
        view
        returns (uint256 nativeFee)
    {
        require(hederaEid != 0, "eid unset");
        bytes memory payload = abi.encode(
            MessageTypes.FUNDED,
            bytes32(0),
            borrower,
            depositAmountWei
        );
        bytes memory opts = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0);
        MessagingFee memory q = _quote(hederaEid, payload, opts, false);
        return q.nativeFee;
    }

    /// @notice Admins should rely on LayerZero message for marking orders repaid.
    function markRepaid(bytes32) external pure {
        revert("use LayerZero message");
    }

    /// @dev LayerZero receive hook: Hedera sends msgType 2=REPAID once USD is fully repaid.
    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        (uint8 msgType, bytes32 orderId) = abi.decode(
            message,
            (uint8, bytes32)
        );
        if (msgType == MessageTypes.REPAID) {
            orders[orderId].repaid = true;
            emit MarkRepaid(orderId);
        }
    }

    /// @notice Withdraw ETH after Hedera confirms full repayment.
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

        emit Withdrawn(orderId, msg.sender, amt);
    }

    /**
     * @notice Fund and notify Hedera in one tx. Send msg.value = deposit + LZ fee (excess refunded).
     * @param orderId previously created with createOrderId()
     * @param depositAmountWei how much ETH you want locked as collateral
     */
    function fundOrderWithNotify(bytes32 orderId, uint256 depositAmountWei)
        external
        payable
        nonReentrant
    {
        require(hederaEid != 0, "eid unset");
        Order storage o = orders[orderId];
        require(o.owner == msg.sender, "not owner");
        require(!o.funded, "already funded");
        require(depositAmountWei > 0, "no ETH");

        bytes memory payload = abi.encode(
            MessageTypes.FUNDED,
            orderId,
            msg.sender,
            depositAmountWei
        );
        bytes memory opts = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0);

        MessagingFee memory q = _quote(hederaEid, payload, opts, false);
        require(msg.value >= depositAmountWei, "insufficient msg.value");
        uint256 feeProvided = msg.value - depositAmountWei;
        require(feeProvided >= q.nativeFee, "insufficient msg.value");

        o.amountWei = depositAmountWei;
        o.funded = true;
        emit OrderFunded(orderId, msg.sender, depositAmountWei);

        _sendLzMessage(hederaEid, payload, opts, q.nativeFee, msg.sender);

        uint256 refund = feeProvided - q.nativeFee;
        if (refund > 0) {
            (bool ok, ) = payable(msg.sender).call{value: refund}("");
            require(ok, "refund fail");
        }
    }

    /// @notice Owner safety valve: liquidate funds if repayment fails.
    function adminLiquidate(bytes32 orderId, address payout) external onlyOwner {
        Order storage o = orders[orderId];
        require(o.funded && !o.repaid, "nothing to liquidate");
        o.liquidated = true;

        uint256 amt = o.amountWei;
        o.amountWei = 0;

        (bool ok, ) = payout.call{value: amt}("");
        require(ok, "send fail");

        emit Liquidated(orderId, amt);
    }

    function setHederaEid(uint32 _eid) external onlyOwner {
        hederaEid = _eid;
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
}
