// src/types.ts

/**
 * Defines the shape of the data that tracks a user's cross-chain order
 * throughout the entire application lifecycle.
 */
export interface OrderData {
    ethAmount: number;
    ethOrderId: string;
    usdValue: string;
    hederaOrderId: string;
    liquidationPrice: string;
  }
  
  /**
   * Defines the shape of the data returned by the AI liquidation risk endpoint.
   */
  export interface LiquidationRiskResponse {
    riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
    riskScore: number; // A value from 0 to 100
    recommendation: string;
    details: {
      currentEthPrice: number;
      liquidationPrice: number;
    };
  }