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
    OAppOptionsType3
} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OAppOptionsType3.sol";

/**
 * @title EthCollateralOApp
 * @notice Locks ETH against an order id and optionally coordinates with Hedera via LayerZero.
 */
contract EthCollateralOApp is OApp, Ownable, ReentrancyGuard {
    using OAppOptionsType3 for bytes;

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

    constructor(address lzEndpoint)
        OApp(lzEndpoint, msg.sender)
        Ownable(msg.sender)
    {}

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

        // Optional: notify Hedera over LayerZero (message-only)
        if (!OAPP_DISABLED && hederaEid != 0) {
            bytes memory payload = abi.encode(
                uint8(1), // msgType 1 = OPEN
                orderId,
                msg.sender,
                msg.value
            );
            // executor gas limit ~200k for bookkeeping on Hedera side; tune if needed
            bytes memory opts = OAppOptionsType3
                .newOptions()
                .addExecutorLzReceiveOption(200_000, 0);
            _lzSend(
                hederaEid,
                payload,
                opts,
                MessagingFee(0, 0),
                payable(msg.sender)
            );
        }
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
        if (msgType == 2) {
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
}
