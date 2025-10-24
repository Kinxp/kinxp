// src/config.ts

import { parseAbi,keccak256,toHex } from 'viem';

// Chain IDs
export const ETH_CHAIN_ID = 11155111; // Sepolia
export const HEDERA_CHAIN_ID = 296; // Hedera Testnet

// Blockscout API endpoint for Hedera Testnet
export const HEDERA_BLOCKSCOUT_API_URL = '/blockscout-api/api';
// Sepolia Blockscout API endpoint
export const SEPOLIA_BLOCKSCOUT_API_URL = '/sepolia-blockscout-api/api';
// --- CONTRACT ADDRESSES ---
export const ETH_COLLATERAL_OAPP_ADDR = '0x3692aF62148947126f1A1E4010f508892e586B96'; 
export const HEDERA_CREDIT_OAPP_ADDR = '0x00000000000000000000000000000000006C85bb';
export const HUSD_TOKEN_ADDR = '0x00000000000000000000000000000000006c8603'; 
export const PYTH_CONTRACT_ADDR = '0xa2aa501b19aff244d90cc15a4cf739d2725b5729'.toLowerCase();
// Calculate the correct topic hash for the 'MarkRepaid' event
export const MARK_REPAID_TOPIC = keccak256(toHex('MarkRepaid(bytes32)'));


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
  "function fundOrderWithNotify(bytes32 orderId, uint256 amount) payable",
  "function quoteOpenNativeFee(address, uint256) view returns (uint256)",
  "function withdraw(bytes32 orderId)",
  "function nonces(address owner) view returns (uint96)",
  "function orders(bytes32) view returns (address owner, uint256 amountWei, bool funded, bool repaid, bool liquidated)",
  "event OrderCreated(bytes32 indexed orderId, address indexed owner)",
  "event OrderFunded(bytes32 indexed orderId, address indexed user, uint256 amountWei)",
  "event MarkRepaid(bytes32 indexed orderId)",
  "event Withdrawn(bytes32 indexed orderId, address indexed user, uint256 amountWei)",
  "event Liquidated(bytes32 indexed orderId, uint256 amountWei)",
]);

export const HEDERA_CREDIT_ABI = parseAbi([
    "struct HOrder { address borrower; uint256 ethAmountWei; uint64 borrowedUsd; bool open; }",
    "function horders(bytes32) view returns (HOrder memory)",
    "function borrow(bytes32 orderId, uint64 amount, bytes[] calldata priceUpdateData, uint32 pythMaxAgeSec) payable",
    "function repay(bytes32 id, uint64 usdAmount, bool notifyEthereum) payable",
    "function quoteRepayFee(bytes32 orderId) view returns (uint256)",
    "function ltvBps() view returns (uint16)",
    "function controller() view returns (address)",
    "event HederaOrderOpened(bytes32 indexed orderId, address indexed borrower, uint256 ethAmountWei)",
    "event Borrowed(bytes32 indexed orderId, address indexed to, uint64 usdAmount)",
    "event Repaid(bytes32 indexed orderId, uint64 repaidAmount, bool fullyRepaid)"
  ]);

export const USD_CONTROLLER_ABI = parseAbi([
  "function treasuryAccount() view returns (address)",
]);
export const HEDERA_ORDER_OPENED_TOPIC = '0xb8c7df1413610d962f04c4eb8df98f0194228023b45937a1075398981ca9f207';
