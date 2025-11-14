// src/config.ts

import { parseAbi, keccak256, toHex } from 'viem';

export const API_BASE_URL = import.meta.env.VITE_API_BASE ?? 'https://kinxp.loca.lt';

// Chain IDs
export const ETH_CHAIN_ID = 11155111; // Sepolia
export const HEDERA_CHAIN_ID = 296; // Hedera Testnet

// Blockscout API endpoint for Hedera Testnet
export const HEDERA_BLOCKSCOUT_API_URL = '/blockscout-api/api';
// Sepolia Blockscout API endpoint
export const SEPOLIA_BLOCKSCOUT_API_URL = '/sepolia-blockscout-api/api';
export const USE_MOCK_API = (import.meta.env.VITE_USE_MOCK_API ?? 'false') === 'true';
// --- CONTRACT ADDRESSES ---
export const ETH_COLLATERAL_OAPP_ADDR = '0xeCEd920d7cF6b6f9986821daD85f2fC76279E12E' as `0x${string}`;
export const HEDERA_CREDIT_OAPP_ADDR = '0x00000000000000000000000000000000006eac30' as `0x${string}`;
export const RESERVE_REGISTRY_ADDR = '0x00000000000000000000000000000000006eac2d' as `0x${string}`;
export const HUSD_TOKEN_ADDR = '0x00000000000000000000000000000000006ca0cb' as `0x${string}`;
export const PYTH_CONTRACT_ADDR = '0xa2aa501b19aff244d90cc15a4cf739d2725b5729'.toLowerCase() as `0x${string}`;
// Calculate the correct topic hash for the 'MarkRepaid' event
export const MARK_REPAID_TOPIC = keccak256(toHex('MarkRepaid(bytes32)'));
export const ORDER_CREATED_TOPIC = keccak256(toHex('OrderCreated(bytes32,bytes32,address)'));
export const ORDER_FUNDED_TOPIC = keccak256(toHex('OrderFunded(bytes32,bytes32,address,uint256)'));
export const HEDERA_REPAID_TOPIC = keccak256(toHex('RepayApplied(bytes32,bytes32,uint64,uint256,bool)'));
// Add these two topic hashes
export const WITHDRAWN_TOPIC = keccak256(toHex('Withdrawn(bytes32,address,uint256)'));
export const LIQUIDATED_TOPIC = keccak256(toHex('Liquidated(bytes32,uint256)'));
// Hedera: event Borrowed(bytes32 indexed orderId, address indexed to, uint64 usdAmount);
export const HEDERA_BORROWED_TOPIC = keccak256(toHex('Borrowed(bytes32,address,uint64)'));

// Sepolia: event Withdrawn(bytes32 indexed orderId, address indexed user, uint256 amountWei);
export const ETH_WITHDRAWN_TOPIC = keccak256(toHex('Withdrawn(bytes32,address,uint256)'));

// --- THIS IS THE FIX ---
// Add the missing constant required by App.tsx
export const BORROW_SAFETY_BPS = 8000; // 80% safety margin, from your script's default

export const PYTH_ABI = parseAbi([
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

export const ETH_COLLATERAL_ABI = parseAbi([
  "function createOrderId() returns (bytes32)",
  "function createOrderIdWithReserve(bytes32 reserveId) returns (bytes32)",
  "function setOrderReserve(bytes32 orderId, bytes32 reserveId)",
  "function fundOrder(bytes32 orderId) payable",
  "function fundOrderWithNotify(bytes32 orderId, uint256 depositAmountWei) payable",
  "function addCollateral(bytes32 orderId) payable",
  "function addCollateralWithNotify(bytes32 orderId, uint256 topUpAmountWei) payable",
  "function quoteOpenNativeFee(address borrower, uint256 depositAmountWei) view returns (uint256)",
  "function quoteOpenNativeFeeWithReserve(bytes32 reserveId, uint256 depositAmountWei) view returns (uint256)",
  "function quoteAddCollateralNativeFee(bytes32 orderId, uint256 topUpAmountWei) view returns (uint256)",
  "function defaultReserveId() view returns (bytes32)",
  "function withdraw(bytes32 orderId)",
  "function nonces(address owner) view returns (uint96)",
  "function orders(bytes32) view returns (address owner, bytes32 reserveId, uint256 amountWei, uint256 unlockedWei, bool funded, bool repaid, bool liquidated)",
  "event OrderCreated(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user)",
  "event OrderFunded(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user, uint256 amountWei)",
  "event OrderReserveUpdated(bytes32 indexed orderId, bytes32 indexed newReserveId)",
  "event MarkRepaid(bytes32 indexed orderId, bytes32 indexed reserveId)",
  "event CollateralUnlocked(bytes32 indexed orderId, bytes32 indexed reserveId, uint256 unlockedAmount, uint256 totalUnlocked, bool fullyRepaid)",
  "event CollateralAdded(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user, uint256 addedAmountWei, uint256 newTotalCollateralWei)",
  "event Withdrawn(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user, uint256 amountWei)",
  "event Liquidated(bytes32 indexed orderId, bytes32 indexed reserveId, uint256 amountWei, address indexed payout)",
]);

export const HEDERA_CREDIT_ABI = parseAbi([
  "function defaultReserveId() view returns (bytes32)",
  "function defaultReserveId() view returns (bytes32)",
  "function reserveRegistry() view returns (address)",
  "function horders(bytes32) view returns (address borrower, uint256 ethAmountWei, uint64 borrowedUsd, bool open)",
  "function getOutstandingDebt(bytes32 orderId) view returns (uint256)",
  "function borrow(bytes32 orderId, uint64 amount, bytes[] priceUpdateData, uint32 pythMaxAgeSec) payable",
  "function borrowWithReserve(bytes32 reserveId, bytes32 orderId, uint64 amount, bytes[] priceUpdateData, uint32 pythMaxAgeSec) payable",
  "function repay(bytes32 orderId, uint64 usdAmount, bool notifyEthereum) payable",
  "function quoteRepayFee(bytes32 orderId) view returns (uint256)",
  "function ltvBps() view returns (uint16)",
  "function controller() view returns (address)",
  "event HederaOrderOpened(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed borrower, uint256 collateralWei)",
  "event HederaCollateralIncreased(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed borrower, uint256 addedCollateralWei, uint256 newTotalCollateralWei)",
  "event Borrowed(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed borrower, uint64 grossAmount, uint64 netAmount, uint64 originationFee, uint32 borrowRateBps)",
  "event RepayApplied(bytes32 indexed orderId, bytes32 indexed reserveId, uint64 repayBurnAmount, uint256 remainingDebtRay, bool fullyRepaid)",
  "event Repaid(bytes32 indexed orderId, bytes32 indexed reserveId, uint64 repaidAmount, bool fullyRepaid)",
  "event PositionLiquidated(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed liquidator, uint64 repaidAmountUsd, uint256 seizedCollateralWei, address ethRecipient, bool fullyRepaid)"
]);

export const RESERVE_REGISTRY_ABI = parseAbi([
  "function getReserveConfig(bytes32 reserveId) view returns ((bytes32 reserveId, string label, address controller, address protocolTreasury, uint8 debtTokenDecimals, bool active, bool frozen) metadata, (uint16 maxLtvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps, uint16 closeFactorBps, uint16 reserveFactorBps, uint16 liquidationProtocolFeeBps) risk, (uint32 baseRateBps, uint32 slope1Bps, uint32 slope2Bps, uint32 optimalUtilizationBps, uint16 originationFeeBps) interest, (bytes32 priceId, uint32 heartbeatSeconds, uint32 maxStalenessSeconds, uint16 maxConfidenceBps, uint16 maxDeviationBps) oracle)",
  "function getMetadata(bytes32 reserveId) view returns (bytes32 reserveId, string label, address controller, address protocolTreasury, uint8 debtTokenDecimals, bool active, bool frozen)",
  "function getRiskConfig(bytes32 reserveId) view returns (uint16 maxLtvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps, uint16 closeFactorBps, uint16 reserveFactorBps, uint16 liquidationProtocolFeeBps)",
  "function defaultReserveId() view returns (bytes32)"
]);

export const USD_CONTROLLER_ABI = parseAbi([
  "function treasuryAccount() view returns (address)",
]);
export const HEDERA_ORDER_OPENED_TOPIC = '0xb8c7df1413610d962f04c4eb8df98f0194228023b45937a1075398981ca9f207';
export const AI_LIQUIDATION_RISK_URL = import.meta.env.VITE_AI_RISK_URL ?? 'https://kinxp.loca.lt/ai/liquidation-risk';
export const CHAIN_EXPLORERS: Record<number, string> = {
  [ETH_CHAIN_ID]: 'https://eth-sepolia.blockscout.com/tx/',
  [HEDERA_CHAIN_ID]: 'https://hedera.cloud.blockscout.com/tx/',
};
