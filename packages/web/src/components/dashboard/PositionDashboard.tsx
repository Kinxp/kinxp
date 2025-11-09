import React, { useState } from 'react';
import { OrderData } from '../../App';
import { SpinnerIcon } from '../Icons';
// Import our new API service function and the response type
import { fetchLiquidationRisk, LiquidationRiskResponse } from '../../services/api';

interface PositionDashboardProps {
  orderData: OrderData;
  onRepay: () => void;
  onLiquidate: () => void;
}

const PositionDashboard: React.FC<PositionDashboardProps> = ({ orderData, onRepay, onLiquidate }) => {
  // --- NEW STATES TO MANAGE THE RISK ANALYSIS API CALL ---
  const [riskData, setRiskData] = useState<LiquidationRiskResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // --- EXISTING LOGIC ---
  const currentEthPrice = 3267.17; // Example price for display
  const healthFactor = (orderData.ethAmount * currentEthPrice) / parseFloat(orderData.usdValue);
  const healthPercentage = Math.min(((healthFactor - 1) / 1) * 100, 100);

  // --- FUNCTION TO HANDLE THE ANALYSIS BUTTON CLICK ---
  const handleAnalyzeRisk = async () => {
    setIsAnalyzing(true);
    setRiskData(null); // Reset previous results
    setAnalysisError(null); // Reset previous errors

    try {
      // Use the Hedera Order ID as the unique identifier for the borrow position
      const data = await fetchLiquidationRisk(orderData.hederaOrderId);
      setRiskData(data);
    } catch (error) {
      setAnalysisError("Failed to fetch risk analysis. Please try again later.");
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Helper function to get Tailwind classes based on the risk level
  const getRiskColorClasses = (level: LiquidationRiskResponse['riskLevel']): string => {
    switch (level) {
      case 'Low': return 'bg-green-500/10 text-green-400 border-green-500/30';
      case 'Medium': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'High': return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
      case 'Critical': return 'bg-red-500/10 text-red-400 border-red-500/30';
      default: return 'bg-gray-700/20 text-gray-400 border-gray-600';
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-300 mb-4 border-l-4 border-blue-400 pl-3">Active Position Dashboard</h2>
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold">Your Position Details</h3>
          <span className="bg-green-500/20 text-green-300 text-xs font-medium px-2.5 py-1 rounded-full">Healthy</span>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">ETH Collateral</span>
            <span className="font-medium">{orderData.ethAmount} ETH (${(orderData.ethAmount * currentEthPrice).toFixed(2)})</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">USD Debt</span>
            <span className="font-medium">{orderData.usdValue} H-USD</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Liquidation Price</span>
            <span className="font-medium text-yellow-400">ETH &lt; ${orderData.liquidationPrice}</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300">Health Factor</label>
          <div className="w-full bg-gray-700 rounded-full h-2.5 mt-1">
            <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${healthPercentage}%` }}></div>
          </div>
        </div>
        
        {/* --- NEW AI RISK ANALYSIS SECTION --- */}
        <div className="pt-5 border-t border-gray-700/50 space-y-4">
          <button
            onClick={handleAnalyzeRisk}
            disabled={isAnalyzing}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-colors text-lg flex items-center justify-center gap-2 disabled:bg-indigo-900/50 disabled:cursor-not-allowed"
          >
            {isAnalyzing ? (
              <>
                <SpinnerIcon /> Analyzing Risk...
              </>
            ) : (
              "Analyze Liquidation Risk (AI)"
            )}
          </button>

          {/* Render analysis error if it exists */}
          {analysisError && (
            <div className="text-center text-sm text-red-400 bg-red-500/10 p-3 rounded-lg">
              {analysisError}
            </div>
          )}

          {/* Render analysis results card if data is available */}
          {riskData && (
            <div className={`p-4 rounded-lg border ${getRiskColorClasses(riskData.riskLevel)} transition-all`}>
              <h4 className="font-bold text-lg">AI Risk Analysis Result</h4>
              <p className="text-sm mt-2">
                <span className="font-semibold">Risk Level:</span> {riskData.riskLevel} ({riskData.riskScore} / 100)
              </p>
              <p className="text-sm mt-2">
                <span className="font-semibold">Recommendation:</span> {riskData.recommendation}
              </p>
            </div>
          )}
        </div>
        
        {/* --- EXISTING ACTION BUTTONS --- */}
        <div className="pt-5 border-t border-gray-700/50 space-y-3">
          <button onClick={onRepay} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors text-lg">
            Repay H-USD
          </button>
          <button onClick={onLiquidate} className="w-full bg-red-800/50 hover:bg-red-800 text-red-300 text-sm py-2 px-4 rounded-lg transition-colors">
            Simulate Liquidation Event
          </button>
        </div>

      </div>
    </div>
  );
};

export default PositionDashboard;