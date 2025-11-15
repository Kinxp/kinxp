// src/config.ts
import { keccak256, toHex, parseAbi } from 'viem';
import type { Abi } from 'viem';

// Import ABIs from JSON files
import ethCollateralAbi from './abis/EthCollateralOApp.json';
import hederaCreditAbi from './abis/HederaCreditOApp.json';
import usdControllerAbi from './abis/UsdHtsController.json';
import husdTokenAbi from './abis/SimpleHtsToken.json';
import liquidityPoolAbi from './abis/LiquidityPoolV1.json';

export const API_BASE_URL = import.meta.env.VITE_API_BASE ?? 'https://kinxp.loca.lt';

// Chain IDs
export const ETH_CHAIN_ID = 11155111; // Sepolia
export const HEDERA_CHAIN_ID = 296; // Hedera Testnet

// Blockscout API endpoint for Hedera Testnet
export const HEDERA_BLOCKSCOUT_API_URL = '/blockscout-api/api';
// Sepolia Blockscout API endpoint
export const SEPOLIA_BLOCKSCOUT_API_URL = '/sepolia-blockscout-api/api';
export const USE_MOCK_API = (import.meta.env.VITE_USE_MOCK_API ?? 'false') === 'true';

// Polling interval in milliseconds for blockchain state updates
export const POLLING_INTERVAL = 5000; // 5 seconds
// --- CONTRACT ADDRESSES ---
// Load from environment variables with fallback to hardcoded values for development
export const ETH_COLLATERAL_OAPP_ADDR = (import.meta.env.VITE_ETH_COLLATERAL_OAPP || '0xeCEd920d7cF6b6f9986821daD85f2fC76279E12E').toLowerCase() as `0x${string}`;
export const HEDERA_CREDIT_OAPP_ADDR = (import.meta.env.VITE_HEDERA_CREDIT_OAPP || '0x00000000000000000000000000000000006eac30').toLowerCase() as `0x${string}`;
export const RESERVE_REGISTRY_ADDR = '0x00000000000000000000000000000000006eac2d' as `0x${string}`;
// HUSD token ID in Hedera format (0.0.0.7253040)
// Can be set via VITE_HUSD_TOKEN_ID environment variable
export const HUSD_TOKEN_ID = import.meta.env.VITE_HUSD_TOKEN_ID || '0.0.7253040';

// HUSD token address in EVM format (for contract calls)
// Can be set via VITE_HUSD_TOKEN_ADDR environment variable
const HUSD_TOKEN_ADDR_RAW = import.meta.env.VITE_HUSD_TOKEN_ADDR || '0x00000000000000000000000000000000006eac30';

// Ensure the address is properly formatted as an EVM address
export const HUSD_TOKEN_ADDR = (() => {
  // Remove any comments or extra spaces
  const cleanAddr = HUSD_TOKEN_ADDR_RAW.split('#')[0].trim();
  // Ensure it starts with 0x and is lowercase
  return cleanAddr.toLowerCase().startsWith('0x') 
    ? (cleanAddr.toLowerCase() as `0x${string}`)
    : (`0x${cleanAddr}` as `0x${string}`);
})();
export const PYTH_CONTRACT_ADDR = '0xa2aa501b19aff244d90cc15a4cf739d2725b5729'.toLowerCase() as `0x${string}`;

// New contract addresses
export const USD_CONTROLLER_ADDR = (import.meta.env.VITE_USD_CONTROLLER || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;
export const LIQUIDITY_POOL_ADDR = (import.meta.env.VITE_LIQUIDITY_POOL || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;
export const CROSS_CHAIN_GATEWAY_ADDR = (import.meta.env.VITE_CROSS_CHAIN_GATEWAY || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;
export const UNDERLYING_TOKEN_ADDR = (import.meta.env.VITE_UNDERLYING_TOKEN || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;
export const LP_TOKEN_ADDR = (import.meta.env.VITE_LP_TOKEN || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;
export const REWARD_TOKEN_ADDR = (import.meta.env.VITE_REWARD_TOKEN || '0x0000000000000000000000000000000000000000').toLowerCase() as `0x${string}`;

// ABIs from JSON files
export const LIQUIDITY_POOL_ABI = liquidityPoolAbi.abi as Abi;
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

// ABIs from JSON files
export const ETH_COLLATERAL_ABI = ethCollateralAbi.abi as Abi;
export const HEDERA_CREDIT_ABI = hederaCreditAbi.abi as Abi;
export const USD_CONTROLLER_ABI = usdControllerAbi.abi as Abi;
export const HUSD_TOKEN_ABI = husdTokenAbi.abi as Abi;

// Pyth Network ABI
export const PYTH_ABI = parseAbi([
  'function getPriceUnsafe(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)',
  'function getPrice(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime, int64 emaPrice, uint64 emaConf)',
  'function getPriceNoOlderThan(bytes32 id, uint256 age) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)',
  'function getEmaPriceUnsafe(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)',
  'function getEmaPrice(bytes32 id) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)',
  'function getEmaPriceNoOlderThan(bytes32 id, uint256 age) view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)',
  'function priceFeedExists(bytes32 id) view returns (bool)',
  'function getUpdateFee(bytes[] updateData) view returns (uint256 feeAmount)',
  'function updatePriceFeeds(bytes[] updateData) payable',
  'function updatePriceFeedsIfNecessary(bytes[] updateData, bytes32[] priceIds, uint64[] publishTimes) payable',
  'function getValidTimePeriod() view returns (uint64)'
]);

// Common ABIs
export const ERC20_ABI = parseAbi([
  // ERC20 Standard
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
]);

// Liquidity Pool ABI is imported from the JSON file

// Cross Chain Gateway ABI
export const CROSS_CHAIN_GATEWAY_ABI = [
  // Core Functions
  'function deposit(address receiver) payable',
  'function withdraw(uint256 amount, address receiver)',
  'function adminDeposit(address receiver, uint256 amount) payable',
  'function adminWithdraw(address token, address to, uint256 amount)',
  
  // Getters
  'function token() view returns (address)',
  'function totalDeposits() view returns (uint256)',
  'function depositsOf(address account) view returns (uint256)',
  'function isAdmin(address account) view returns (bool)'
] as const;

// Reserve Registry ABI
export const RESERVE_REGISTRY_ABI = parseAbi([
  'function getReserveConfig(bytes32 reserveId) view returns ((bytes32 reserveId, string label, address controller, address protocolTreasury, uint8 debtTokenDecimals, bool active, bool frozen) metadata, (uint16 maxLtvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps, uint16 closeFactorBps, uint16 reserveFactorBps, uint16 liquidationProtocolFeeBps) risk, (uint32 baseRateBps, uint32 slope1Bps, uint32 slope2Bps, uint32 optimalUtilizationBps, uint16 originationFeeBps) interest, (bytes32 priceId, uint32 heartbeatSeconds, uint32 maxStalenessSeconds, uint16 maxConfidenceBps, uint16 maxDeviationBps) oracle)',
  'function defaultReserveId() view returns (bytes32)'
]);

export const HEDERA_ORDER_OPENED_TOPIC = '0xb8c7df1413610d962f04c4eb8df98f0194228023b45937a1075398981ca9f207';
export const AI_LIQUIDATION_RISK_URL = import.meta.env.VITE_AI_RISK_URL ?? 'https://kinxp.loca.lt/ai/liquidation-risk';
export const CHAIN_EXPLORERS: Record<number, string> = {
  [ETH_CHAIN_ID]: 'https://eth-sepolia.blockscout.com/tx/',
  [HEDERA_CHAIN_ID]: 'https://hedera.cloud.blockscout.com/tx/',
};

// Network configuration
export const NETWORK_CONFIG = {
  [ETH_CHAIN_ID]: {
    name: 'Sepolia',
    explorer: CHAIN_EXPLORERS[ETH_CHAIN_ID],
    contracts: {
      ethCollateral: ETH_COLLATERAL_OAPP_ADDR,
      usdController: USD_CONTROLLER_ADDR,
      liquidityPool: LIQUIDITY_POOL_ADDR,
      crossChainGateway: CROSS_CHAIN_GATEWAY_ADDR,
      underlyingToken: UNDERLYING_TOKEN_ADDR,
      lpToken: LP_TOKEN_ADDR,
      rewardToken: REWARD_TOKEN_ADDR,
    },
    // ABIs are available via direct imports
  },
  [HEDERA_CHAIN_ID]: {
    name: 'Hedera Testnet',
    explorer: CHAIN_EXPLORERS[HEDERA_CHAIN_ID],
    contracts: {
      credit: HEDERA_CREDIT_OAPP_ADDR,
      husdToken: HUSD_TOKEN_ADDR,
    },
  },
} as const;

// Token configuration
export const TOKEN_CONFIG = {
  HUSD: {
    address: HUSD_TOKEN_ADDR,
    tokenId: HUSD_TOKEN_ID,
    decimals: 6,
    symbol: 'hUSD',
    name: 'Hedera USD',
  },
  UNDERLYING: {
    address: UNDERLYING_TOKEN_ADDR,
    decimals: 18,
    symbol: 'USDC',
    name: 'USD Coin',
  },
  LP: {
    address: LP_TOKEN_ADDR,
    decimals: 18,
    symbol: 'LP',
    name: 'Liquidity Provider Token',
  },
  REWARD: {
    address: REWARD_TOKEN_ADDR,
    decimals: 18,
    symbol: 'KXP',
    name: 'KinXP Token',
  },
} as const;
