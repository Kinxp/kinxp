// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../hedera/HederaCreditOApp.sol";
import "../ReserveRegistry.sol";

interface IPythTestHelper {
    function setPrice(int64 price, int32 expo) external;
    function setForceMismatch(bool enabled) external;
}

/// @notice Test harness for HederaCreditOApp with helper methods to inject state.
contract TestHederaCreditOApp is HederaCreditOApp {
    IPythTestHelper private immutable mockPythControl;

    constructor(
        address endpoint,
        address owner_,
        address controller_,
        address pythContract,
        bytes32 defaultReserveId_
    )
        HederaCreditOApp(
            endpoint,
            owner_,
            _deployRegistry(controller_, defaultReserveId_),
            pythContract,
            defaultReserveId_
        )
    {
        mockPythControl = IPythTestHelper(pythContract);
    }

    function forceOpenOrder(bytes32 orderId, address borrower, uint256 collateralWei) external {
        Position storage pos = positions[orderId];
        pos.borrower = borrower;
        pos.reserveId = defaultReserveId;
        pos.collateralWei = collateralWei;
        pos.scaledDebtRay = 0;
        pos.open = true;
        pos.liquidated = false;
    }

    function setStubPrice(uint256 price, int32 expo) external {
        mockPythControl.setPrice(int64(int256(price)), expo);
    }

    function forcePriceMismatch() external {
        mockPythControl.setForceMismatch(true);
    }

    function forceSetLtvBps(uint16 newLtv) external onlyOwner {
        ReserveRegistry.RiskConfig memory cfg = reserveRegistry.getRiskConfig(defaultReserveId);
        cfg.maxLtvBps = newLtv;
        reserveRegistry.setRiskConfig(defaultReserveId, cfg);
    }

    function forceSetLtvBpsUnsafe(uint16 newLtv) external {
        ReserveRegistry.RiskConfig memory cfg = reserveRegistry.getRiskConfig(defaultReserveId);
        cfg.maxLtvBps = newLtv;
        reserveRegistry.setRiskConfig(defaultReserveId, cfg);
    }

    function _deployRegistry(address controller_, bytes32 reserveId) private returns (address) {
        ReserveRegistry registry = new ReserveRegistry(address(this));

        ReserveRegistry.ReserveConfigBundle memory bundle;
        bundle.metadata = ReserveRegistry.ReserveMetadata({
            reserveId: reserveId,
            label: "TEST",
            controller: controller_,
            protocolTreasury: controller_,
            debtTokenDecimals: 6,
            active: true,
            frozen: false
        });
        bundle.risk = ReserveRegistry.RiskConfig({
            maxLtvBps: 7000,
            liquidationThresholdBps: 8000,
            liquidationBonusBps: 10500,
            closeFactorBps: 5000,
            reserveFactorBps: 1000,
            liquidationProtocolFeeBps: 500
        });
        bundle.interest = ReserveRegistry.InterestRateConfig({
            baseRateBps: 200,
            slope1Bps: 400,
            slope2Bps: 900,
            optimalUtilizationBps: 8000,
            originationFeeBps: 50
        });
        bundle.oracle = ReserveRegistry.OracleConfig({
            priceId: reserveId,
            heartbeatSeconds: 60,
            maxStalenessSeconds: 90,
            maxConfidenceBps: 500,
            maxDeviationBps: 1_500
        });

        registry.registerReserve(bundle);
        registry.transferOwnership(msg.sender);
        return address(registry);
    }
}
