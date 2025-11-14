/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Ethereum Network
  readonly VITE_ETHEREUM_RPC_URL: string;
  
  // Contract Addresses
  readonly VITE_ETH_COLLATERAL_OAPP: string;
  readonly VITE_HEDERA_CREDIT_OAPP: string;
  readonly VITE_USD_CONTROLLER: string;
  readonly VITE_HUSD_TOKEN: string;
  readonly VITE_LIQUIDITY_POOL: string;
  readonly VITE_CROSS_CHAIN_GATEWAY: string;
  readonly VITE_UNDERLYING_TOKEN: string;
  readonly VITE_LP_TOKEN: string;
  readonly VITE_REWARD_TOKEN: string;
  
  // Hedera Network
  readonly VITE_HEDERA_RPC_URL: string;
  
  // Block Explorer URLs
  readonly VITE_ETHERSCAN_URL: string;
  readonly VITE_HEDERA_EXPLORER_URL: string;
  
  // Other environment variables
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
