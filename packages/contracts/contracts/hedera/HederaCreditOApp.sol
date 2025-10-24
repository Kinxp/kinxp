// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {UsdHtsController} from "./UsdHtsController.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import {OApp, MessagingFee, Origin} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import {OptionsBuilder} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";

import {MessageTypes} from "../MessageTypes.sol";

/**
 * @title HederaCreditOApp
 * @notice Issues USD HTS credit against mirrored ETH collateral and handles repayments.
 */
contract HederaCreditOApp is OApp, ReentrancyGuard {
    using OptionsBuilder for bytes;

    error BadOrder();
    error BadAmount();
    error LzFeeTooLow(uint256 required, uint256 provided);

    event HederaOrderOpened(
        bytes32 indexed orderId,
        address indexed borrower,
        uint256 ethAmountWei
    );
    event Borrowed(
        bytes32 indexed orderId,
        address indexed to,
        uint64 usdAmount
    );
    event Repaid(
        bytes32 indexed orderId,
        uint64 repaidAmount,
        bool fullyRepaid
    );

    struct HOrder {
        address borrower;
        uint256 ethAmountWei;
        uint64 borrowedUsd;
        bool open;
    }

    mapping(bytes32 => HOrder) public horders;

    UsdHtsController public controller;
    IPyth public pyth;
    bytes32 public ethUsdPriceId;
    uint32 public ethEid;

    uint16 public ltvBps = 7000; // 70% LTV
    uint256 public constant HEDERA_MIN_NATIVE = 1; // 1 tinybar (Hedera exposes msg.value in tinybar units)

    constructor(
        address lzEndpoint,
        address owner_,
        address payable controller_,
        address pythContract,
        bytes32 ethUsdPriceId_
    ) OApp(lzEndpoint, owner_) {
        controller = UsdHtsController(controller_);
        pyth = IPyth(pythContract);
        ethUsdPriceId = ethUsdPriceId_;
        _transferOwnership(owner_);
    }

    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        (
            uint8 msgType,
            bytes32 id,
            address borrower,
            uint256 ethAmountWei
        ) = abi.decode(message, (uint8, bytes32, address, uint256));
        if (msgType == MessageTypes.FUNDED) {
            HOrder storage o = horders[id];
            require(!o.open, "exists");
            o.borrower = borrower;
            o.ethAmountWei = ethAmountWei;
            o.open = true;
            emit HederaOrderOpened(id, borrower, ethAmountWei);
        } else if (msgType == MessageTypes.LIQUIDATED) {
            HOrder storage o = horders[id];
            // close order, so repayment is not possible anymore
            o.open = false;
        }
    }

    function borrow(
        bytes32 id,
        uint64 usdAmount,
        bytes[] calldata priceUpdateData,
        uint32 maxAgeSecs
    ) external payable nonReentrant {
        HOrder storage o = horders[id];
        require(o.open && o.borrower == msg.sender, "bad order");
        require(usdAmount > 0, "bad amount");

        if (priceUpdateData.length > 0) {
            uint256 fee = pyth.getUpdateFee(priceUpdateData);
            require(msg.value >= fee, "fee");
            pyth.updatePriceFeeds{value: fee}(priceUpdateData);
            if (msg.value > fee) {
                (bool refundOk, ) = msg.sender.call{value: msg.value - fee}("");
                require(refundOk, "refund fail");
            }
        }

        PythStructs.Price memory price = _fetchPrice(maxAgeSecs);
        require(price.price > 0, "bad price");

        uint256 priceScaled = _scalePriceTo1e18(
            uint256(uint64(price.price)),
            price.expo
        );
        uint256 collateralUsd18 = (o.ethAmountWei * priceScaled) / 1e18;
        uint256 maxBorrow18 = (collateralUsd18 * ltvBps) / 10_000;
        uint8 usdDecimals = controller.usdDecimals();
        uint256 desired18 = _to1e18(uint256(usdAmount), usdDecimals);
        uint256 currentBorrowed18 = _to1e18(
            uint256(o.borrowedUsd),
            usdDecimals
        );
        require(currentBorrowed18 + desired18 <= maxBorrow18, "exceeds LTV");

        controller.mintTo(msg.sender, usdAmount);
        o.borrowedUsd += usdAmount;

        emit Borrowed(id, msg.sender, usdAmount);
    }

    function _fetchPrice(
        uint32 maxAgeSecs
    ) internal view virtual returns (PythStructs.Price memory) {
        return pyth.getPriceNoOlderThan(ethUsdPriceId, maxAgeSecs);
    }

    function repay(
        bytes32 id,
        uint64 usdAmount,
        bool notifyEthereum
    ) external payable nonReentrant {
        HOrder storage o = horders[id];
        if (!(o.open && o.borrower == msg.sender)) revert BadOrder();
        if (!(usdAmount > 0 && usdAmount <= o.borrowedUsd)) revert BadAmount();

        controller.burnFromTreasury(usdAmount);
        o.borrowedUsd -= usdAmount;

        bool full = (o.borrowedUsd == 0);
        emit Repaid(id, usdAmount, full);

        if (full && notifyEthereum && ethEid != 0) {
            bytes memory payload = abi.encode(MessageTypes.REPAID, id);
            bytes memory opts = OptionsBuilder
                .newOptions()
                .addExecutorLzReceiveOption(120_000, 0);

            MessagingFee memory q = _quote(ethEid, payload, opts, false);
            uint256 nativeFee = q.nativeFee;
            if (nativeFee > 0 && nativeFee < HEDERA_MIN_NATIVE) {
                nativeFee = HEDERA_MIN_NATIVE;
            }
            if (msg.value < nativeFee) revert LzFeeTooLow(nativeFee, msg.value);
            q.nativeFee = nativeFee;

            // ==============================================================================
            // === THIS IS THE CORRECTED LINE ===============================================
            // ==============================================================================
            _lzSend(ethEid, payload, opts, q, payable(msg.sender));
            // ==============================================================================

            uint256 refund = msg.value - q.nativeFee;
            if (refund > 0) {
                (bool ok, ) = msg.sender.call{value: refund}("");
                require(ok, "refund fail");
            }
        } else {
            if (msg.value > 0) {
                (bool ok, ) = msg.sender.call{value: msg.value}("");
                require(ok, "refund fail");
            }
        }
    }

    /**
     * @notice Quote the LayerZero native fee the sender must include to notify Ethereum of a REPAY.
     * @param id The orderId being repaid.
     */
    function quoteRepayFee(bytes32 id) external view returns (uint256 nativeFee) {
        require(ethEid != 0, "eid unset");
        bytes memory payload = abi.encode(MessageTypes.REPAID, id);
        bytes memory opts = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(120_000, 0);
        MessagingFee memory q = _quote(ethEid, payload, opts, false);
        return q.nativeFee;
    }

    function setEthEid(uint32 _eid) external onlyOwner {
        ethEid = _eid;
    }

    function setLtvBps(uint16 _bps) external onlyOwner {
        require(_bps <= 9000, "too high");
        ltvBps = _bps;
    }

    function _scalePriceTo1e18(
        uint256 rawPrice,
        int32 expo
    ) internal pure returns (uint256) {
        int32 power = expo + 18;
        if (power > 0) {
            return rawPrice * (10 ** uint32(power));
        }
        return rawPrice / (10 ** uint32(-power));
    }

    function _to1e18(
        uint256 amount,
        uint8 decimals_
    ) internal pure returns (uint256) {
        if (decimals_ < 18) {
            return amount * (10 ** (18 - decimals_));
        }
        return amount / (10 ** (decimals_ - 18));
    }

    receive() external payable {}
}
