/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_USE_MOCK_API?: string;
  readonly VITE_ETH_COLLATERAL_OAPP?: string;
  readonly VITE_HEDERA_CREDIT_OAPP?: string;
  readonly VITE_HUSD_TOKEN_ID?: string;
  readonly VITE_HUSD_TOKEN_ADDR?: string;
  readonly VITE_USD_CONTROLLER?: string;
  readonly VITE_LIQUIDITY_POOL?: string;
  readonly VITE_CROSS_CHAIN_GATEWAY?: string;
  readonly VITE_UNDERLYING_TOKEN?: string;
  readonly VITE_LP_TOKEN?: string;
  readonly VITE_REWARD_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
