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

  export type OrderStatus = 'Created' | 'Funded' | 'Borrowed' | 'ReadyToWithdraw' | 'Withdrawn' | 'Liquidated';

  export interface UserOrderSummary {
    orderId: `0x${string}`;
    amountWei: bigint;
    status: OrderStatus;
    borrowedUsd?: bigint;
  }



  export enum AppState {
    IDLE, ORDER_CREATING, ORDER_CREATED, FUNDING_IN_PROGRESS, CROSSING_TO_HEDERA,
    READY_TO_BORROW, BORROWING_IN_PROGRESS, LOAN_ACTIVE,
    RETURNING_FUNDS,
    REPAYING_IN_PROGRESS,
    CROSSING_TO_ETHEREUM, READY_TO_WITHDRAW, WITHDRAWING_IN_PROGRESS, COMPLETED, ERROR
  }

