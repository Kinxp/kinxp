// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {UsdHtsController} from "./UsdHtsController.sol";
import {ReserveRegistry} from "../ReserveRegistry.sol";
import {MathUtils} from "../libraries/MathUtils.sol";

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import {OApp, MessagingFee, Origin} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";
import {OptionsBuilder} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";

import {MessageTypes} from "../MessageTypes.sol";

/// @title HederaCreditOApp
/// @notice Issues HTS denominated credit against mirrored ETH collateral while keeping
///         track of interest, protocol fees, oracle bounds, and cross-chain messaging.
/// @dev The contract intentionally mirrors Aave-style accounting (scaled variable debt and
///      reserve indices) so that additional markets can be plugged in through ReserveRegistry.
contract HederaCreditOApp is OApp, ReentrancyGuard {
    using OptionsBuilder for bytes;

    // Fixed-point constants (we duplicate the library values for gas efficiency)
    uint256 private constant WAD = 1e18;
    uint256 private constant RAY = 1e27;

    uint256 private constant HEDERA_MIN_NATIVE = 1; // tinybar

    /// @notice Default reserve used by legacy borrow entrypoints.
    bytes32 public defaultReserveId;

    /// @notice Registry describing reserves, treasuries, oracle settings, etc.
    ReserveRegistry public reserveRegistry;

    /// @notice Primary oracle provider (Pyth) used for price discovery.
    IPyth public pyth;

    /// @notice LayerZero endpoint identifier for the paired Ethereum OApp.
    uint32 public ethEid;

    /// -----------------------------------------------------------------------
    ///                             DATA STRUCTURES
    /// -----------------------------------------------------------------------

    struct Position {
        address borrower;
        address borrowerCanonical;
        bytes32 reserveId;
        uint256 collateralWei;
        uint128 scaledDebtRay;
        bool open;
        bool liquidated;
    }

    struct ReserveState {
        uint256 totalVariableDebtRay;
        uint256 accruedProtocolFeesRay;
        uint128 liquidityIndex;
        uint128 variableBorrowIndex;
        uint40 lastUpdateTimestamp;
        uint32 lastBorrowRateBps;
    }

    struct OracleState {
        int64 lastPrice;
        uint64 lastPublishTime;
    }

	mapping(bytes32 => Position) public positions;
	mapping(bytes32 => ReserveState) public reserveStates;
	mapping(bytes32 => OracleState) public oracleStates;
	bool public debugStopAfterMint = false;

    /// -----------------------------------------------------------------------
    ///                                 EVENTS
    /// -----------------------------------------------------------------------

    event HederaOrderOpened(
        bytes32 indexed orderId,
        bytes32 indexed reserveId,
        address indexed borrower,
        uint256 collateralWei
    );
    event Borrowed(
        bytes32 indexed orderId,
        bytes32 indexed reserveId,
        address indexed borrower,
        uint64 grossAmount,
        uint64 netAmount,
        uint64 originationFee,
        uint32 borrowRateBps
    );
    event RepayApplied(
        bytes32 indexed orderId,
        bytes32 indexed reserveId,
        uint64 repayBurnAmount,
        uint256 remainingDebtRay,
        bool fullyRepaid
    );
    event InterestAccrued(
        bytes32 indexed reserveId,
        uint256 newTotalDebtRay,
        uint256 protocolFeesRay,
        uint32 borrowRateBps
    );
    event ProtocolFeesCollected(
        bytes32 indexed reserveId,
        address indexed recipient,
        uint64 amount
    );
    event ReserveRegistryUpdated(address indexed newRegistry);
    event DefaultReserveUpdated(bytes32 indexed newReserveId);
    event OraclePriceChecked(bytes32 indexed reserveId, uint256 price1e18);
    event PositionLiquidated(
        bytes32 indexed orderId,
        bytes32 indexed reserveId,
        address indexed liquidator,
        uint64 repaidAmountUsd,
        uint256 seizedCollateralWei,
        address ethRecipient,
        bool fullyRepaid
    );
	event OrderManuallyMirrored(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed borrower, uint256 collateralWei);
	event BorrowDebug(bytes32 indexed orderId, string tag, uint256 val1, uint256 val2, address addr);

    /// -----------------------------------------------------------------------
    ///                                 ERRORS
    /// -----------------------------------------------------------------------

    error BadOrder(bytes32 orderId);
    error BadAmount();
    error ReserveMismatch(bytes32 expected, bytes32 provided);
    error ReserveInactive(bytes32 reserveId);
    error ControllerMismatch();
    error RateOverflow();
    error DebtOverflow();
    error LzFeeTooLow(uint256 required, uint256 provided);
    error NothingToCollect();

	constructor(
		address lzEndpoint,
		address owner_,
		address registry_,
		address pythContract,
        bytes32 defaultReserveId_
    ) OApp(lzEndpoint, owner_) {
        reserveRegistry = ReserveRegistry(registry_);
		pyth = IPyth(pythContract);
		defaultReserveId = defaultReserveId_;
		_transferOwnership(owner_);
	}

	function setDebugStopAfterMint(bool enabled) external onlyOwner {
		debugStopAfterMint = enabled;
	}

    /// -----------------------------------------------------------------------
    ///                              MESSAGING HOOK
    /// -----------------------------------------------------------------------

    function _lzReceive(
        Origin calldata,
        bytes32,
        bytes calldata message,
        address,
        bytes calldata
    ) internal override {
        uint8 msgType = uint8(message[0]);
        if (msgType == MessageTypes.FUNDED) {
            (
                ,
                bytes32 orderId,
                bytes32 reserveId,
                address borrower,
                uint256 ethAmountWei
            ) = abi.decode(message, (uint8, bytes32, bytes32, address, uint256));
            Position storage pos = positions[orderId];
            require(!pos.open, "order exists");
            pos.borrower = borrower;
            pos.reserveId = reserveId;
            pos.collateralWei = ethAmountWei;
            pos.open = true;
            pos.liquidated = false;
            pos.borrowerCanonical = borrower;

            emit HederaOrderOpened(orderId, reserveId, borrower, ethAmountWei);
        } else if (msgType == MessageTypes.LIQUIDATED) {
            (, bytes32 orderId, bytes32 reserveId, , ) = abi.decode(
                message,
                (uint8, bytes32, bytes32, address, uint256)
            );
            Position storage pos = positions[orderId];
            pos.open = false;
            pos.liquidated = true;
            emit PositionLiquidated(orderId, reserveId, address(0), 0, 0, address(0), true);
        }
    }

    /// -----------------------------------------------------------------------
    ///                              USER ACTIONS
    /// -----------------------------------------------------------------------

    function borrow(
        bytes32 orderId,
        uint64 usdAmount,
        bytes[] calldata priceUpdateData,
        uint32 maxAgeSecs
    ) external payable returns (uint64 netAmount) {
        return
            borrowWithReserve(
                defaultReserveId,
                orderId,
                usdAmount,
                priceUpdateData,
                maxAgeSecs
            );
    }

    function borrowWithReserve(
        bytes32 reserveId,
        bytes32 orderId,
        uint64 usdAmount,
        bytes[] calldata priceUpdateData,
        uint32 maxAgeSecs
    ) public payable nonReentrant returns (uint64 netAmount) {
        if (usdAmount == 0) revert BadAmount();

        Position storage pos = positions[orderId];
        if (!(pos.open && !pos.liquidated && pos.borrower == msg.sender)) {
            revert BadOrder(orderId);
        }
        if (pos.reserveId != reserveId) {
            revert ReserveMismatch(pos.reserveId, reserveId);
        }

        ReserveRegistry.ReserveConfigBundle memory cfg = reserveRegistry
            .getReserveConfig(reserveId);
        if (!cfg.metadata.active || cfg.metadata.frozen) {
            revert ReserveInactive(reserveId);
        }

        UsdHtsController ctrl = UsdHtsController(payable(cfg.metadata.controller));
        if (ctrl.usdDecimals() != cfg.metadata.debtTokenDecimals) {
            revert ControllerMismatch();
        }

        uint256 feePaid = _updateOracle(priceUpdateData);
        uint256 price1e18 = _fetchPrice(
            reserveId,
            cfg.oracle,
            maxAgeSecs
        );
        emit OraclePriceChecked(reserveId, price1e18);

        ReserveState storage state = _accrueReserve(
            reserveId,
            cfg.risk,
            cfg.interest
        );

        uint8 decimals = cfg.metadata.debtTokenDecimals;
        uint256 existingDebtRay = _positionDebtRay(pos, state);
        uint256 existingDebtTokens = MathUtils.fromRay(
            existingDebtRay,
            decimals
        );
        uint256 desiredTokens = uint256(usdAmount);
        uint256 desired18 = _to1e18(desiredTokens, decimals);
        uint256 existingDebt18 = _to1e18(existingDebtTokens, decimals);

        uint256 collateralUsd18 = (pos.collateralWei * price1e18) / WAD;
        uint256 maxBorrow18 = (collateralUsd18 *
            cfg.risk.maxLtvBps) / 10_000;
        require(existingDebt18 + desired18 <= maxBorrow18, "exceeds LTV");

        uint256 originationFee = MathUtils.applyBps(
            desiredTokens,
            cfg.interest.originationFeeBps
        );
        require(desiredTokens > originationFee, "fee>=amount");
        netAmount = uint64(desiredTokens - originationFee);
        uint64 feeAmount = uint64(originationFee);

        // Mint principal to borrower and fees to treasury
        address borrower = pos.borrower;
        // if (canonicalBorrower == address(0)) {
        //     canonicalBorrower = pos.borrower;
        // }

        emit BorrowDebug(orderId, "mint_borrower_start", netAmount, feeAmount, borrower);

        try ctrl.mintTo(borrower, netAmount) {
            // no-op
        } catch (bytes memory /* err */) {
            emit BorrowDebug(orderId, "mint_borrower_failed", netAmount, feeAmount, msg.sender);
            return 0;
        }
        if (feeAmount > 0) {
            try ctrl.mintTo(
                cfg.metadata.protocolTreasury,
                feeAmount
            ) {
                // no-op
            } catch (bytes memory /* err2 */) {
                emit BorrowDebug(orderId, "mint_fee_failed", netAmount, feeAmount, cfg.metadata.protocolTreasury);
                return 0;
            }
        }

        if (debugStopAfterMint) {
            emit BorrowDebug(orderId, "post_mint", desiredTokens, feeAmount, msg.sender);
			return netAmount;
		}

        // Update scaled debt
        uint256 amountRay = MathUtils.toRay(desiredTokens, decimals);
        uint256 scaledDelta = MathUtils.rayDiv(
            amountRay,
            uint256(state.variableBorrowIndex)
        );
        if (scaledDelta > type(uint128).max) revert DebtOverflow();

        pos.scaledDebtRay += uint128(scaledDelta);
        state.totalVariableDebtRay += amountRay;

        emit Borrowed(
            orderId,
            reserveId,
            msg.sender,
            usdAmount,
            netAmount,
            feeAmount,
            state.lastBorrowRateBps
        );

        if (msg.value > feePaid) {
            (bool refundOk, ) = msg.sender.call{value: msg.value - feePaid}(
                ""
            );
            require(refundOk, "refund fail");
        }
    }


function repay(
    bytes32 orderId,
    uint64 usdAmount,
    bool notifyEthereum
) external payable nonReentrant returns (bool fullyRepaid) {
    if (usdAmount == 0) revert BadAmount();

    // Validate order
    Position storage pos = positions[orderId];
    if (!(pos.open && !pos.liquidated && pos.borrower == msg.sender)) {
        revert BadOrder(orderId);
    }

    // Resolve controller & config
    ReserveRegistry.ReserveConfigBundle memory cfg =
        reserveRegistry.getReserveConfig(pos.reserveId);
    UsdHtsController ctrl = UsdHtsController(payable(cfg.metadata.controller));
    if (ctrl.usdDecimals() != cfg.metadata.debtTokenDecimals) {
        revert ControllerMismatch();
    }

    // Accrue interest and get up-to-date state
    ReserveState storage state = _accrueReserve(
        pos.reserveId,
        cfg.risk,
        cfg.interest
    );

    uint8 decimals = cfg.metadata.debtTokenDecimals;

    // Compute total outstanding debt (in ray)
    uint256 totalDebtRay = _positionDebtRay(pos, state);
    if (totalDebtRay == 0) revert BadAmount();

    // Clamp requested repay to total debt
    uint256 requestedRay = MathUtils.toRay(usdAmount, decimals);
    uint256 repayRay = requestedRay > totalDebtRay ? totalDebtRay : requestedRay;

    // Convert to scaled units and update position/state
    uint256 scaledRepayment = MathUtils.rayDiv(
        repayRay,
        uint256(state.variableBorrowIndex)
    );

    if (scaledRepayment >= pos.scaledDebtRay) {
        // Full repay
        scaledRepayment = pos.scaledDebtRay;
        repayRay = MathUtils.rayMul(
            uint256(pos.scaledDebtRay),
            uint256(state.variableBorrowIndex)
        );
        pos.scaledDebtRay = 0;
    } else {
        // Partial repay
        pos.scaledDebtRay -= uint128(scaledRepayment);
    }
    state.totalVariableDebtRay -= repayRay;

    // Convert repay size back to token units (may round down slightly)
    uint256 repayTokens = MathUtils.fromRay(repayRay, decimals);
    uint64 burnAmount = uint64(repayTokens);

    // 🔐 IMPORTANT: charge the BORROWER:
    // pulls hUSD from borrower -> treasury, then burns from treasury
    // (requires borrower approval to controller for at least `burnAmount`)
    ctrl.pullFromAndBurn(pos.borrower, burnAmount);

    fullyRepaid = (pos.scaledDebtRay == 0);

    emit RepayApplied(
        orderId,
        pos.reserveId,
        burnAmount,
        pos.scaledDebtRay,
        fullyRepaid
    );

    // Optional LayerZero notify to Ethereum on full repay
    if (fullyRepaid && notifyEthereum && ethEid != 0) {
        bytes memory payload = abi.encode(
            MessageTypes.REPAID,
            orderId,
            pos.reserveId
        );
        bytes memory opts = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(120_000, 0);

        MessagingFee memory q = _quote(ethEid, payload, opts, false);
        uint256 nativeFee = q.nativeFee;
        if (nativeFee > 0 && nativeFee < HEDERA_MIN_NATIVE) {
            nativeFee = HEDERA_MIN_NATIVE;
        }
        if (msg.value < nativeFee) {
            revert LzFeeTooLow(nativeFee, msg.value);
        }
        q.nativeFee = nativeFee;
        _lzSend(ethEid, payload, opts, q, payable(msg.sender));

        uint256 refund = msg.value - q.nativeFee;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "refund fail");
        }
    } else if (msg.value > 0) {
        (bool ok2, ) = msg.sender.call{value: msg.value}("");
        require(ok2, "refund fail");
    }
}

    function liquidate(
        bytes32 orderId,
        uint64 repayAmount,
        bytes[] calldata priceUpdateData,
        uint32 maxAgeSecs,
        address ethRecipient
    ) external payable nonReentrant {
        require(ethRecipient != address(0), "recipient=0");
        Position storage pos = positions[orderId];
        if (!(pos.open && !pos.liquidated)) revert BadOrder(orderId);
        require(repayAmount > 0, "repay=0");

        ReserveRegistry.ReserveConfigBundle memory cfg = reserveRegistry
            .getReserveConfig(pos.reserveId);
        require(cfg.metadata.active && !cfg.metadata.frozen, "reserve inactive");
        UsdHtsController ctrl = UsdHtsController(payable(cfg.metadata.controller));
        if (ctrl.usdDecimals() != cfg.metadata.debtTokenDecimals) {
            revert ControllerMismatch();
        }

        uint256 oracleFee = 0;
        if (priceUpdateData.length > 0) {
            oracleFee = pyth.getUpdateFee(priceUpdateData);
            require(msg.value >= oracleFee, "fee");
            pyth.updatePriceFeeds{value: oracleFee}(priceUpdateData);
        }

        uint256 price1e18 = _fetchPrice(pos.reserveId, cfg.oracle, maxAgeSecs);
        require(price1e18 > 0, "bad price");
        ReserveState storage state = _accrueReserve(
            pos.reserveId,
            cfg.risk,
            cfg.interest
        );

        uint8 decimals = cfg.metadata.debtTokenDecimals;
        uint256 debtRay = _positionDebtRay(pos, state);
        require(debtRay > 0, "no debt");
        uint256 debtTokens = MathUtils.fromRay(debtRay, decimals);

        require(
            _isLiquidatable(pos, cfg.risk, price1e18, debtTokens, decimals),
            "healthy"
        );

        uint256 repayTokens = repayAmount;
        if (repayTokens > debtTokens) repayTokens = debtTokens;
        uint256 maxClose = (debtTokens * cfg.risk.closeFactorBps) / 10_000;
        if (maxClose > 0 && repayTokens > maxClose) {
            repayTokens = maxClose;
        }
        require(repayTokens > 0, "closeFactor=0");

        uint256 repayRay = MathUtils.toRay(repayTokens, decimals);
        uint256 scaledRepayment = MathUtils.rayDiv(
            repayRay,
            uint256(state.variableBorrowIndex)
        );
        uint256 actualRepayRay;
        if (scaledRepayment >= pos.scaledDebtRay) {
            scaledRepayment = pos.scaledDebtRay;
            actualRepayRay = MathUtils.rayMul(
                uint256(pos.scaledDebtRay),
                uint256(state.variableBorrowIndex)
            );
            pos.scaledDebtRay = 0;
        } else {
            actualRepayRay = repayRay;
            pos.scaledDebtRay -= uint128(scaledRepayment);
        }
        state.totalVariableDebtRay -= actualRepayRay;

        ctrl.burnFromTreasury(uint64(repayTokens));

        uint256 repayUsd18 = _to1e18(repayTokens, decimals);
        uint256 seizeWei = _calcSeizeAmountWei(
            repayUsd18,
            price1e18,
            cfg.risk.liquidationBonusBps
        );
        if (seizeWei > pos.collateralWei) {
            seizeWei = pos.collateralWei;
        }
        pos.collateralWei -= seizeWei;

        bool fullyRepaid = (pos.scaledDebtRay == 0);
        if (fullyRepaid) {
            pos.open = false;
            pos.liquidated = true;
        }

        emit PositionLiquidated(
            orderId,
            pos.reserveId,
            msg.sender,
            uint64(repayTokens),
            seizeWei,
            ethRecipient,
            fullyRepaid
        );

        if (ethEid != 0 && seizeWei > 0) {
            bytes memory payload = abi.encode(
                MessageTypes.LIQUIDATED,
                orderId,
                pos.reserveId,
                ethRecipient,
                seizeWei
            );
            bytes memory opts = OptionsBuilder
                .newOptions()
                .addExecutorLzReceiveOption(200_000, 0);
            MessagingFee memory q = _quote(ethEid, payload, opts, false);
            uint256 lzValue = msg.value - oracleFee;
            require(lzValue >= q.nativeFee, "insufficient msg.value");
            _lzSend(ethEid, payload, opts, q, payable(msg.sender));
            uint256 refund = lzValue - q.nativeFee;
            if (refund > 0) {
                (bool ok, ) = msg.sender.call{value: refund}("");
                require(ok, "refund fail");
            }
        } else if (oracleFee > 0) {
            // refund unused oracle fee excess
            uint256 refund = msg.value - oracleFee;
            if (refund > 0) {
                (bool ok2, ) = msg.sender.call{value: refund}("");
                require(ok2, "refund fail");
            }
        }
    }

    /// -----------------------------------------------------------------------
    ///                              ADMIN ACTIONS
    /// -----------------------------------------------------------------------

    function collectProtocolFees(
        bytes32 reserveId,
        address recipient
    ) external onlyOwner returns (uint64 amountCollected) {
        require(recipient != address(0), "recipient=0");
        ReserveState storage state = reserveStates[reserveId];
        uint256 accruedRay = state.accruedProtocolFeesRay;
        if (accruedRay == 0) revert NothingToCollect();

        ReserveRegistry.ReserveConfigBundle memory cfg = reserveRegistry
            .getReserveConfig(reserveId);
        uint8 decimals = cfg.metadata.debtTokenDecimals;

        uint256 amountTokens = MathUtils.fromRay(accruedRay, decimals);
        if (amountTokens == 0) revert NothingToCollect();
        if (amountTokens > type(uint64).max) {
            amountTokens = type(uint64).max;
        }

        uint256 tokensRay = MathUtils.toRay(amountTokens, decimals);
        if (tokensRay > state.accruedProtocolFeesRay) {
            tokensRay = state.accruedProtocolFeesRay;
        }
        state.accruedProtocolFeesRay -= tokensRay;
        amountCollected = uint64(amountTokens);

        UsdHtsController(payable(cfg.metadata.controller)).mintTo(
            recipient,
            amountCollected
        );

        emit ProtocolFeesCollected(reserveId, recipient, amountCollected);
    }

    function setReserveRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "registry=0");
        reserveRegistry = ReserveRegistry(newRegistry);
        emit ReserveRegistryUpdated(newRegistry);
    }

    function setDefaultReserve(bytes32 newReserveId) external onlyOwner {
        defaultReserveId = newReserveId;
        emit DefaultReserveUpdated(newReserveId);
    }

    function setEthEid(uint32 _eid) external onlyOwner {
        ethEid = _eid;
    }

    /// -----------------------------------------------------------------------
    ///                               VIEW HELPERS
    /// -----------------------------------------------------------------------

    function quoteRepayFee(bytes32 orderId) external view returns (uint256) {
        Position storage pos = positions[orderId];
        bytes memory payload = abi.encode(
            MessageTypes.REPAID,
            orderId,
            pos.reserveId
        );
        bytes memory opts = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(120_000, 0);
        MessagingFee memory q = _quote(ethEid, payload, opts, false);
        return q.nativeFee;
    }

    function getOutstandingDebt(bytes32 orderId) external view returns (uint256) {
        Position storage pos = positions[orderId];
        ReserveState storage state = reserveStates[pos.reserveId];
        uint256 debtRay = _positionDebtRay(pos, state);
        ReserveRegistry.ReserveConfigBundle memory cfg = reserveRegistry
            .getReserveConfig(pos.reserveId);
        return MathUtils.fromRay(debtRay, cfg.metadata.debtTokenDecimals);
    }

    /// -----------------------------------------------------------------------
    ///                  Legacy compatibility / view adapters
    /// -----------------------------------------------------------------------

    struct HOrderCompat {
        address borrower;
        uint256 ethAmountWei;
        uint64 borrowedUsd;
        bool open;
    }

    function horders(bytes32 orderId) external view returns (HOrderCompat memory) {
        Position storage pos = positions[orderId];
        if (!pos.open) {
            return HOrderCompat({
                borrower: address(0),
                ethAmountWei: 0,
                borrowedUsd: 0,
                open: false
            });
        }

        bytes32 reserveId = pos.reserveId == bytes32(0)
            ? defaultReserveId
            : pos.reserveId;

        ReserveRegistry.ReserveConfigBundle memory cfg;
        try reserveRegistry.getReserveConfig(reserveId) returns (
            ReserveRegistry.ReserveConfigBundle memory data
        ) {
            cfg = data;
        } catch {
            return HOrderCompat({
                borrower: pos.borrower,
                ethAmountWei: pos.collateralWei,
                borrowedUsd: 0,
                open: pos.open && !pos.liquidated
            });
        }

        ReserveState storage state = reserveStates[reserveId];
        uint256 debtRay = _positionDebtRay(pos, state);
        uint256 debtTokens = MathUtils.fromRay(
            debtRay,
            cfg.metadata.debtTokenDecimals
        );
        if (debtTokens > type(uint64).max) {
            debtTokens = type(uint64).max;
        }

        return HOrderCompat({
            borrower: pos.borrower,
            ethAmountWei: pos.collateralWei,
            borrowedUsd: uint64(debtTokens),
            open: pos.open && !pos.liquidated
        });
    }

    function ltvBps() external view returns (uint16) {
        try reserveRegistry.getRiskConfig(defaultReserveId) returns (
            ReserveRegistry.RiskConfig memory risk
        ) {
            return risk.maxLtvBps;
        } catch {
            return 0;
        }
    }

    function controller() external view returns (address) {
        try reserveRegistry.getMetadata(defaultReserveId) returns (
            ReserveRegistry.ReserveMetadata memory meta
        ) {
            return meta.controller;
        } catch {
            return address(0);
        }
    }

    /// -----------------------------------------------------------------------
    ///                             INTERNAL HELPERS
    /// -----------------------------------------------------------------------

    error OracleFeeTooLow(uint256 required, uint256 provided);
    error OracleUpdateFailed(bytes data, uint256 required, uint256 provided, uint256 items);
    error OraclePriceQueryFailed(bytes data, uint32 maxAgeSecs);

    function _updateOracle(
        bytes[] calldata priceUpdateData
    ) internal returns (uint256 feePaid) {
        if (priceUpdateData.length == 0) return 0;
        feePaid = pyth.getUpdateFee(priceUpdateData);
        if (msg.value < feePaid) {
            revert OracleFeeTooLow(feePaid, msg.value);
        }
        try pyth.updatePriceFeeds{value: feePaid}(priceUpdateData) {
            // no-op
        } catch (bytes memory errData) {
            revert OracleUpdateFailed(errData, feePaid, msg.value, priceUpdateData.length);
        }
    }

    function _fetchPrice(
        bytes32 reserveId,
        ReserveRegistry.OracleConfig memory oracleCfg,
        uint32 externalMaxAgeSecs
    ) internal returns (uint256 price1e18) {
        require(oracleCfg.priceId != bytes32(0), "oracle unset");
        uint32 maxAge = oracleCfg.maxStalenessSeconds;
        if (externalMaxAgeSecs != 0 && (maxAge == 0 || externalMaxAgeSecs < maxAge)) {
            maxAge = externalMaxAgeSecs;
        }
        if (maxAge == 0) {
            maxAge = oracleCfg.heartbeatSeconds;
        }

        PythStructs.Price memory price;
        try pyth.getPriceNoOlderThan(
            oracleCfg.priceId,
            maxAge
        ) returns (PythStructs.Price memory fetched) {
            price = fetched;
        } catch (bytes memory errData) {
            revert OraclePriceQueryFailed(errData, maxAge);
        }
        require(price.price > 0, "bad price");
        if (
            oracleCfg.heartbeatSeconds > 0 &&
            price.publishTime + oracleCfg.heartbeatSeconds < block.timestamp
        ) {
            revert("price stale");
        }

        if (oracleCfg.maxConfidenceBps > 0) {
            uint256 conf = uint256(price.conf);
            uint256 base = uint256(uint64(price.price));
            uint256 ratioBps = (conf * 10_000) / base;
            require(ratioBps <= oracleCfg.maxConfidenceBps, "conf high");
        }

        OracleState storage oracleState = oracleStates[reserveId];
        if (
            oracleCfg.maxDeviationBps > 0 &&
            oracleState.lastPrice != 0
        ) {
            uint256 last = uint64(oracleState.lastPrice);
            uint256 current = uint64(price.price);
            uint256 diff = current > last ? current - last : last - current;
            if (last > 0) {
                uint256 deviationBps = (diff * 10_000) / last;
                require(deviationBps <= oracleCfg.maxDeviationBps, "price dev");
            }
        }

        oracleState.lastPrice = price.price;
        oracleState.lastPublishTime = uint64(price.publishTime);

        price1e18 = _scalePriceTo1e18(
            uint256(uint64(price.price)),
            price.expo
        );
    }

    function _accrueReserve(
        bytes32 reserveId,
        ReserveRegistry.RiskConfig memory riskCfg,
        ReserveRegistry.InterestRateConfig memory rateCfg
    ) internal returns (ReserveState storage state) {
        state = reserveStates[reserveId];
        if (state.liquidityIndex == 0) {
            state.liquidityIndex = uint128(RAY);
        }
        if (state.variableBorrowIndex == 0) {
            state.variableBorrowIndex = uint128(RAY);
        }

        uint40 currentTs = uint40(block.timestamp);
        if (state.lastUpdateTimestamp == 0) {
            state.lastUpdateTimestamp = currentTs;
            state.lastBorrowRateBps = rateCfg.baseRateBps;
            return state;
        }

        uint256 timeDelta = currentTs - state.lastUpdateTimestamp;
        if (timeDelta == 0 || state.totalVariableDebtRay == 0) {
            state.lastUpdateTimestamp = currentTs;
            state.lastBorrowRateBps = rateCfg.baseRateBps;
            return state;
        }

        uint256 principalRay = state.totalVariableDebtRay;
        uint256 rateBps = rateCfg.baseRateBps;
        state.lastBorrowRateBps = uint32(rateBps);

        (uint256 updatedDebtRay, uint256 interestRay) = MathUtils
            .accrueLinearInterest(principalRay, rateBps, timeDelta);
        state.totalVariableDebtRay = updatedDebtRay;

        if (interestRay > 0 && riskCfg.reserveFactorBps > 0) {
            uint256 protocolShareRay = MathUtils.applyBps(
                interestRay,
                riskCfg.reserveFactorBps
            );
            state.accruedProtocolFeesRay += protocolShareRay;
        }

        uint256 linearInterestRay = MathUtils.rayDiv(
            updatedDebtRay,
            principalRay
        );
        state.variableBorrowIndex = uint128(
            MathUtils.rayMul(
                uint256(state.variableBorrowIndex),
                linearInterestRay
            )
        );
        state.liquidityIndex = state.variableBorrowIndex;
        state.lastUpdateTimestamp = currentTs;

        emit InterestAccrued(
            reserveId,
            updatedDebtRay,
            state.accruedProtocolFeesRay,
            state.lastBorrowRateBps
        );
    }

    function _positionDebtRay(
        Position storage pos,
        ReserveState storage state
    ) internal view returns (uint256) {
        if (pos.scaledDebtRay == 0) return 0;
        return MathUtils.rayMul(
            uint256(pos.scaledDebtRay),
            uint256(state.variableBorrowIndex == 0 ? uint128(RAY) : state.variableBorrowIndex)
        );
    }

    function _scalePriceTo1e18(
        uint256 rawPrice,
        int32 expo
    ) internal pure returns (uint256) {
        int32 power = expo + 18;
        if (power > 0) {
            return rawPrice * (10 ** uint32(uint32(power)));
        }
        return rawPrice / (10 ** uint32(uint32(-power)));
    }

    function _to1e18(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals < 18) {
            return amount * (10 ** (18 - decimals));
        }
        if (decimals > 18) {
            return amount / (10 ** (decimals - 18));
        }
        return amount;
    }

    function _isLiquidatable(
        Position storage pos,
        ReserveRegistry.RiskConfig memory riskCfg,
        uint256 price1e18,
        uint256 debtTokens,
        uint8 decimals
    ) internal view returns (bool) {
        uint256 collateralUsd18 = (pos.collateralWei * price1e18) / WAD;
        uint256 debtUsd18 = _to1e18(debtTokens, decimals);
        uint256 threshold = (collateralUsd18 * riskCfg.liquidationThresholdBps) /
            10_000;
        return debtUsd18 > threshold;
    }

    function _msgSender() internal view override returns (address) {
        return msg.sender;
    }

    function _calcSeizeAmountWei(
        uint256 repayUsd18,
        uint256 price1e18,
        uint16 bonusBps
    ) internal pure returns (uint256) {
        uint256 usdWithBonus = (repayUsd18 * (10_000 + bonusBps)) / 10_000;
        return (usdWithBonus * WAD) / price1e18;
    }

    function adminMirrorOrder(
        bytes32 orderId,
        bytes32 reserveId,
        address borrower,
        address borrowerCanonical,
        uint256 collateralWei
    ) external onlyOwner {
        require(borrower != address(0), "borrower=0");
        require(collateralWei > 0, "collateral=0");
        Position storage pos = positions[orderId];
        require(!pos.open, "already mirrored");

        pos.borrower = borrower;
        pos.borrowerCanonical = borrowerCanonical == address(0)
            ? borrower
            : borrowerCanonical;
        pos.reserveId = reserveId;
        pos.collateralWei = collateralWei;
        pos.scaledDebtRay = 0;
        pos.open = true;
        pos.liquidated = false;

        emit HederaOrderOpened(orderId, reserveId, borrower, collateralWei);
        emit OrderManuallyMirrored(orderId, reserveId, borrower, collateralWei);
    }

    receive() external payable {}
}
    error ControllerMintFailed(bytes data);
