import React from 'react';
import { formatUnits } from 'viem';
import { UserOrderSummary } from '../../types';

interface OrderDebugPanelProps {
  order: UserOrderSummary;
}

const formatEth = (value?: bigint) => {
  const wei = value ?? 0n;
  return formatUnits(wei, 18);
};

const formatUsd = (value?: bigint) => {
  const usd = value ?? 0n;
  return formatUnits(usd, 6);
};

export const OrderDebugPanel: React.FC<OrderDebugPanelProps> = ({ order }) => {
  const ethCollateralWei = order.amountWei ?? 0n;
  const hederaCollateralWei = order.hederaCollateralWei ?? order.amountWei ?? 0n;
  const unlockedWei = order.unlockedWei ?? 0n;
  const borrowedUsd = order.hederaBorrowedUsd ?? order.borrowedUsd ?? 0n;

  const dataPoints = [
    {
      label: 'Sepolia collateral (on-chain state)',
      value: `${formatEth(ethCollateralWei)} ETH`,
    },
    {
      label: 'Hedera collateral (positions.collateralWei)',
      value: `${formatEth(hederaCollateralWei)} ETH`,
    },
    {
      label: 'Debt on Hedera',
      value: `${formatUsd(borrowedUsd)} hUSD`,
    },
    {
      label: 'Unlocked on Sepolia',
      value: `${formatEth(unlockedWei)} ETH`,
    },
  ];

  let statusLine = '';
  if (borrowedUsd > 0n) {
    statusLine = `Outstanding Hedera debt: ${formatUsd(borrowedUsd)} hUSD. Repay to unlock ETH.`;
  } else if (unlockedWei > 0n) {
    statusLine = `${formatEth(unlockedWei)} ETH unlocked on Sepolia. Withdraw to free this order.`;
  } else if (order.status === 'Funded') {
    statusLine = 'Collateral bridged. You can borrow or add more collateral.';
  } else if (order.status === 'Created') {
    statusLine = 'Order exists on Ethereum. Fund it to bridge collateral.';
  } else {
    statusLine = `Status: ${order.status}.`;
  }

  return (
    <div className="bg-gray-900/50 border border-gray-700/60 rounded-xl px-4 py-3 text-left space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>On-chain telemetry</span>
        <span className="font-mono text-[11px] text-gray-500">{order.orderId.slice(0, 10)}…</span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-200">
        {dataPoints.map((item) => (
          <div key={item.label} className="bg-gray-800/60 rounded-lg px-3 py-2 border border-gray-700/60">
            <dt className="text-[11px] uppercase tracking-widest text-gray-500">{item.label}</dt>
            <dd className="font-semibold text-white mt-1">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-gray-400">{statusLine}</p>
    </div>
  );
};

export default OrderDebugPanel;
