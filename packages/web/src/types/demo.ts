// Mock data types for the future demo page
// These match the new contract structure and will be replaced with real contract calls

import { OrderStatus } from '../types';

export interface MockReserveConfig {
  reserveId: `0x${string}`;
  label: string;
  maxLtvBps: number; // e.g., 7500 = 75%
  liquidationThresholdBps: number;
  baseRateBps: number; // Annual interest rate in basis points
  originationFeeBps: number;
  active: boolean;
}

export interface MockOrderSummary {
  orderId: `0x${string}`;
  reserveId: `0x${string}`;
  amountWei: bigint; // Total collateral locked
  unlockedWei: bigint; // Available for withdrawal (from partial repayments)
  status: OrderStatus;
  borrowedUsd?: bigint; // Current debt (6 decimals)
  outstandingDebt?: bigint; // Debt including accrued interest
  reserveLabel?: string; // For display
  createdAt?: number; // Timestamp
  lastBorrowRateBps?: number; // Current interest rate
}

export interface MockReserveInfo {
  reserveId: `0x${string}`;
  label: string;
  maxLtvBps: number;
  liquidationThresholdBps: number;
  baseRateBps: number;
  originationFeeBps: number;
  controller: string;
  active: boolean;
}

