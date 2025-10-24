// src/components/RepayView.tsx

import React, { useState } from 'react';
import { parseEther, formatUnits } from 'viem';
import { ETH_CHAIN_ID, AI_LIQUIDATION_RISK_URL } from '../config';
import { fetchPythUpdateData } from '../services/pythService';
import type { LiquidationRiskResponse } from '../services/api';

interface RepayViewProps {
  orderId: string;
  // NEW: Accept the borrowed amount as a prop
  borrowAmount: string | null;
  collateralEth: string | null;
  onRepay: () => void;
}

const LIMITS = {
  targetLtv: 0.6,
  maxLtv: 0.8,
  liqLtv: 0.85,
};

const riskClassMap: Record<LiquidationRiskResponse['riskLevel'], string> = {
  Low: 'bg-green-500/10 text-green-300 border-green-500/30',
  Medium: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
  High: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  Critical: 'bg-red-600/10 text-red-300 border-red-500/30',
};

const RepayView: React.FC<RepayViewProps> = ({ orderId, borrowAmount, collateralEth, onRepay }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [riskResult, setRiskResult] = useState<LiquidationRiskResponse | null>(null);
  const [riskError, setRiskError] = useState<string | null>(null);

  const handleAnalyzeRisk = async () => {
    if (!borrowAmount || !collateralEth) {
      setRiskError('Collateral and borrow information are required.');
      return;
    }

    const debtUsd = Number(borrowAmount);
    if (Number.isNaN(debtUsd)) {
      setRiskError('Unable to parse the borrow amount.');
      return;
    }

    setIsAnalyzing(true);
    setRiskError(null);
    setRiskResult(null);

    try {
      const collateralWei = parseEther(collateralEth);
      const { scaledPrice } = await fetchPythUpdateData();
      const ethUsd = Number(formatUnits(scaledPrice, 18));

      const payload = {
        orderId,
        eth: {
          chainId: ETH_CHAIN_ID,
          collateralWei: collateralWei.toString(),
        },
        hedera: {
          network: 'testnet',
          debtAmountUsd: debtUsd,
        },
        price: {
          ethUsd,
        },
        limits: LIMITS,
      };

      const response = await fetch(AI_LIQUIDATION_RISK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Risk service returned ${response.status}`);
      }

      const result = (await response.json()) as LiquidationRiskResponse;
      setRiskResult(result);
    } catch (error: any) {
      console.error('Failed to analyze liquidation risk', error);
      setRiskError(error?.message ?? 'Unexpected error while analyzing risk.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4 animate-fade-in">
      <h3 className="text-xl font-bold">Step 4: Repay Your Loan</h3>
      <p className="text-gray-400">Repay the hUSD to unlock your ETH collateral on Ethereum.</p>
      
      <div className="bg-gray-900/50 p-3 rounded-lg text-left text-sm space-y-2">
        <div>
          <span className="text-gray-500">Order ID:</span>
          <code className="text-cyan-300 ml-2 text-xs">{orderId}</code>
        </div>
        {/* NEW: Display the amount to repay */}
        <div>
          <span className="text-gray-500">Amount to Repay:</span>
          <code className="text-cyan-300 ml-2 font-mono">{borrowAmount ?? '...'} hUSD</code>
        </div>
      </div>

      <div className="space-y-3 text-left text-sm bg-gray-900/40 border border-gray-700/60 rounded-lg p-4">
        <div className="flex justify-between items-center">
          <span className="font-medium text-gray-100">Liquidation Risk (AI)</span>
          <button
            onClick={handleAnalyzeRisk}
            disabled={!borrowAmount || !collateralEth || isAnalyzing}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900/70 disabled:text-indigo-200 text-white px-3 py-1.5 rounded-md transition-colors"
          >
            {isAnalyzing ? 'Analyzing…' : 'Run Analysis'}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Uses current Pyth price data and your collateral to simulate liquidation risk.
        </p>

        {riskError && (
          <div className="text-xs text-red-300 bg-red-600/10 border border-red-500/30 rounded-md px-3 py-2">
            {riskError}
          </div>
        )}

        {riskResult && (
          <div className={`rounded-md border px-3 py-3 space-y-2 ${riskClassMap[riskResult.riskLevel]}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold uppercase tracking-wide">
                {riskResult.riskLevel} Risk
              </span>
              <span className="text-xs font-mono">{riskResult.riskScore}/100</span>
            </div>
            <p className="text-xs">
              <span className="font-semibold">Recommendation:</span> {riskResult.recommendation}
            </p>
            {riskResult.details && (
              <p className="text-xs text-gray-300">
                <span className="font-semibold">ETH Price:</span> $
                {Number(riskResult.details.currentEthPrice).toFixed(2)}{' '}
                <span className="font-semibold">| Liquidation:</span> $
                {Number(riskResult.details.liquidationPrice).toFixed(2)}
              </p>
            )}
          </div>
        )}
      </div>

      <button 
        onClick={onRepay} 
        // NEW: Disable the button if the amount isn't loaded yet
        disabled={!borrowAmount}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Return & Repay {borrowAmount ? `${borrowAmount} hUSD` : ''}
      </button>
      <p className="text-xs text-gray-500">
        We'll return your hUSD to the treasury and then submit the repay transaction.
      </p>
    </div>
  );
};

export default RepayView;
