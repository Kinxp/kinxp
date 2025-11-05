// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReserveRegistry
/// @notice Governance controlled registry describing risk, oracle, and treasury
///         configuration for each supported debt reserve.
/// @dev The registry is chain-agnostic and intended to be referenced by both the
///      Hedera and Ethereum OApps so that a single source of truth drives market
///      configuration. Reserve identifiers are arbitrary `bytes32` values (the
///      deployment scripts can derive them via keccak256).
contract ReserveRegistry is Ownable {
    /// @notice Risk configuration influencing borrowing power and liquidations.
    struct RiskConfig {
        uint16 maxLtvBps;
        uint16 liquidationThresholdBps;
        uint16 liquidationBonusBps;
        uint16 closeFactorBps;
        uint16 reserveFactorBps;
        uint16 liquidationProtocolFeeBps;
    }

    /// @notice Interest rate configuration applied during borrow/repay flows.
    struct InterestRateConfig {
        uint32 baseRateBps;
        uint32 slope1Bps;
        uint32 slope2Bps;
        uint32 optimalUtilizationBps;
        uint16 originationFeeBps;
    }

    /// @notice Oracle configuration for Pyth (or other) price feeds.
    struct OracleConfig {
        bytes32 priceId;
        uint32 heartbeatSeconds;
        uint32 maxStalenessSeconds;
        uint16 maxConfidenceBps;
        uint16 maxDeviationBps;
    }

    /// @notice General metadata required by the OApps.
    struct ReserveMetadata {
        bytes32 reserveId;
        string label;
        address controller;
        address protocolTreasury;
        uint8 debtTokenDecimals;
        bool active;
        bool frozen;
    }

    /// @notice Combined view of all configs for convenience.
    struct ReserveConfigBundle {
        ReserveMetadata metadata;
        RiskConfig risk;
        InterestRateConfig interest;
        OracleConfig oracle;
    }

    /// @dev Reserve identifier => metadata
    mapping(bytes32 => ReserveMetadata) private _metadata;

    /// @dev Reserve identifier => risk config
    mapping(bytes32 => RiskConfig) private _riskConfig;

    /// @dev Reserve identifier => rate config
    mapping(bytes32 => InterestRateConfig) private _rateConfig;

    /// @dev Reserve identifier => oracle config
    mapping(bytes32 => OracleConfig) private _oracleConfig;

    /// @dev LayerZero endpoints / peers per chain (eid => peer)
    mapping(uint32 => address) private _chainPeers;

    /// @notice Emitted when a new reserve is registered.
    event ReserveRegistered(bytes32 indexed reserveId, string label, address controller);

    /// @notice Emitted when metadata is updated.
    event ReserveMetadataUpdated(bytes32 indexed reserveId, ReserveMetadata metadata);

    /// @notice Emitted when risk configuration changes.
    event RiskConfigUpdated(bytes32 indexed reserveId, RiskConfig config);

    /// @notice Emitted when interest configuration changes.
    event InterestConfigUpdated(bytes32 indexed reserveId, InterestRateConfig config);

    /// @notice Emitted when oracle configuration changes.
    event OracleConfigUpdated(bytes32 indexed reserveId, OracleConfig config);

    /// @notice Emitted when a LayerZero peer address is changed.
    event ChainPeerUpdated(uint32 indexed eid, address peer);

    error ReserveAlreadyExists(bytes32 reserveId);
    error UnknownReserve(bytes32 reserveId);
    error InvalidController();
    error InvalidTreasury();

    constructor(address owner_) {
        if (owner_ != address(0)) {
            _transferOwnership(owner_);
        }
    }

    /// @notice Registers a new reserve and sets all configuration in a single call.
    function registerReserve(ReserveConfigBundle calldata bundle) external onlyOwner {
        bytes32 reserveId = bundle.metadata.reserveId;
        if (_metadata[reserveId].reserveId != bytes32(0)) {
            revert ReserveAlreadyExists(reserveId);
        }
        if (bundle.metadata.controller == address(0)) revert InvalidController();
        if (bundle.metadata.protocolTreasury == address(0)) revert InvalidTreasury();
        _metadata[reserveId] = bundle.metadata;
        _riskConfig[reserveId] = bundle.risk;
        _rateConfig[reserveId] = bundle.interest;
        _oracleConfig[reserveId] = bundle.oracle;

        emit ReserveRegistered(reserveId, bundle.metadata.label, bundle.metadata.controller);
        emit ReserveMetadataUpdated(reserveId, bundle.metadata);
        emit RiskConfigUpdated(reserveId, bundle.risk);
        emit InterestConfigUpdated(reserveId, bundle.interest);
        emit OracleConfigUpdated(reserveId, bundle.oracle);
    }

    /// @notice Updates the registry metadata for a reserve.
    function setReserveMetadata(bytes32 reserveId, ReserveMetadata calldata meta) external onlyOwner {
        _ensureExists(reserveId);
        if (meta.controller == address(0)) revert InvalidController();
        if (meta.protocolTreasury == address(0)) revert InvalidTreasury();
        _metadata[reserveId] = meta;
        emit ReserveMetadataUpdated(reserveId, meta);
    }

    /// @notice Updates the risk configuration for a reserve.
    function setRiskConfig(bytes32 reserveId, RiskConfig calldata config) external onlyOwner {
        _ensureExists(reserveId);
        _riskConfig[reserveId] = config;
        emit RiskConfigUpdated(reserveId, config);
    }

    /// @notice Updates the interest configuration for a reserve.
    function setRateConfig(bytes32 reserveId, InterestRateConfig calldata config) external onlyOwner {
        _ensureExists(reserveId);
        _rateConfig[reserveId] = config;
        emit InterestConfigUpdated(reserveId, config);
    }

    /// @notice Updates the oracle configuration for a reserve.
    function setOracleConfig(bytes32 reserveId, OracleConfig calldata config) external onlyOwner {
        _ensureExists(reserveId);
        _oracleConfig[reserveId] = config;
        emit OracleConfigUpdated(reserveId, config);
    }

    /// @notice Updates or registers a LayerZero peer for a chain.
    function setChainPeer(uint32 eid, address peer) external onlyOwner {
        _chainPeers[eid] = peer;
        emit ChainPeerUpdated(eid, peer);
    }

    /// @notice Returns a full config bundle for convenience.
    function getReserveConfig(bytes32 reserveId) external view returns (ReserveConfigBundle memory bundle) {
        _ensureExists(reserveId);
        bundle = ReserveConfigBundle({
            metadata: _metadata[reserveId],
            risk: _riskConfig[reserveId],
            interest: _rateConfig[reserveId],
            oracle: _oracleConfig[reserveId]
        });
    }

    function getMetadata(bytes32 reserveId) external view returns (ReserveMetadata memory) {
        _ensureExists(reserveId);
        return _metadata[reserveId];
    }

    function getRiskConfig(bytes32 reserveId) external view returns (RiskConfig memory) {
        _ensureExists(reserveId);
        return _riskConfig[reserveId];
    }

    function getRateConfig(bytes32 reserveId) external view returns (InterestRateConfig memory) {
        _ensureExists(reserveId);
        return _rateConfig[reserveId];
    }

    function getOracleConfig(bytes32 reserveId) external view returns (OracleConfig memory) {
        _ensureExists(reserveId);
        return _oracleConfig[reserveId];
    }

    function chainPeer(uint32 eid) external view returns (address) {
        return _chainPeers[eid];
    }

    function _ensureExists(bytes32 reserveId) private view {
        if (_metadata[reserveId].reserveId == bytes32(0)) {
            revert UnknownReserve(reserveId);
        }
    }
}
