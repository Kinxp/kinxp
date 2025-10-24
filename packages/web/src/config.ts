// src/config.ts

export const API_BASE_URL = import.meta.env.VITE_API_BASE || 'http://localhost:8787';


export const USE_MOCK_API = true;

// src/config.ts

import { parseAbi } from 'viem';


// Chain IDs
export const ETH_CHAIN_ID = 11155111; // Sepolia
export const HEDERA_CHAIN_ID = 296; // Hedera Testnet

// --- FIX: Point to our local Vite proxy to bypass CORS ---
export const HEDERA_BLOCKSCOUT_API_URL = '/blockscout-api/api';

// --- CONTRACT ADDRESSES ---
// Using the verified contract address from your logs
export const ETH_COLLATERAL_OAPP_ADDR = '0x3692aF62148947126f1A1E4010f508892e586B96'; 
export const HEDERA_CREDIT_OAPP_ADDR = '0x00000000000000000000000000000000006ca0c3';

// ABI Fragments
export const ETH_COLLATERAL_ABI = parseAbi([
  "function createOrderId() returns (bytes32)",
  "function fundOrderWithNotify(bytes32 orderId, uint256 amount) payable",
  "function quoteOpenNativeFee(address, uint256) view returns (uint256)",
  "function withdraw(bytes32 orderId)",
  "struct Order { uint256 amount; address owner; bool repaid; bool open; }",
  "function orders(bytes32) view returns (Order memory)",
  "event OrderCreated(bytes32 indexed orderId, address indexed owner)",
]);

export const HEDERA_CREDIT_ABI = parseAbi([
  "struct HOrder { uint256 collateralAmount; address owner; bool open; }",
  "function horders(bytes32) view returns (HOrder memory)",
  "function borrow(bytes32 orderId, uint256 amount, bytes[] calldata priceUpdateData, uint32 pythMaxAgeSec) payable",
  "function repay(bytes32 orderId, uint256 amount, bool notify) payable",
  "function quoteRepayFee(bytes32 orderId) view returns (uint256)",
  "event HederaOrderOpened(bytes32 indexed orderId, address indexed borrower, uint256 ethAmountWei)",
  "event Borrowed(bytes32 indexed orderId, address indexed to, uint64 usdAmount)",
  "event Repaid(bytes32 indexed orderId, uint64 repaidAmount, bool fullyRepaid)"
]);

// This is the correct topic hash from the verified contract
export const HEDERA_ORDER_OPENED_TOPIC = '0xb8c7df1413610d962f04c4eb8df98f0194228023b45937a1075398981ca9f207';