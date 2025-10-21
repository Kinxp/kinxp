// src/components/PositionDashboard.tsx

import React, { useState } from 'react';
import { OrderData } from '../App';
import { SpinnerIcon } from './Icons';
// Importamos nuestra nueva función y el tipo de respuesta
import { fetchLiquidationRisk, LiquidationRiskResponse } from '../services/api';

interface PositionDashboardProps {
  orderData: OrderData;
  onRepay: () => void;
  onLiquidate: () => void;
}

const PositionDashboard: React.FC<PositionDashboardProps> = ({ orderData, onRepay, onLiquidate }) => {
  // --- NUEVOS ESTADOS PARA MANEJAR EL ANÁLISIS DE RIESGO ---
  const [riskData, setRiskData] = useState<LiquidationRiskResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const healthFactor = (parseFloat(orderData.ethAmount) * 3267.17) / parseFloat(orderData.usdValue);
  const healthPercentage = Math.min(((healthFactor - 1) / 1) * 100, 100);

  // --- FUNCIÓN PARA MANEJAR EL CLICK DEL BOTÓN DE ANÁLISIS ---
  const handleAnalyzeRisk = async () => {
    setIsAnalyzing(true);
    setRiskData(null);
    setAnalysisError(null);

    try {
      // Usamos el ID de Hedera como "borrowId"
      const data = await fetchLiquidationRisk(orderData.hederaOrderId);
      setRiskData(data);
    } catch (error) {
      setAnalysisError("Failed to fetch risk analysis. Please try again later.");
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Helper para obtener el color según el nivel de riesgo
  const getRiskColorClasses = (level: LiquidationRiskResponse['riskLevel']): string => {
    switch (level) {
      case 'Low': return 'bg-green-500/10 text-green-400 border-green-500/30';
      case 'Medium': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'High': return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
      case 'Critical': return 'bg-red-500/10 text-red-400 border-red-500/30';
      default: return 'bg-gray-700/20 text-gray-400';
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-300 mb-4 border-l-4 border-blue-400 pl-3">Active Position Dashboard</h2>
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-5">
        {/* ... (código existente del dashboard) ... */}
        <div className="flex justify-between items-center">
            {/* ... */}
        </div>
        <div className="space-y-3 text-sm">
            {/* ... */}
        </div>
        <div>
            {/* ... */}
        </div>

        {/* --- NUEVA SECCIÓN DE ANÁLISIS DE RIESGO --- */}
        <div className="pt-4 border-t border-gray-700/50">
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

          {/* Mostrar error si lo hay */}
          {analysisError && (
            <div className="mt-4 text-center text-sm text-red-400 bg-red-500/10 p-3 rounded-lg">
              {analysisError}
            </div>
          )}

          {/* Mostrar resultados del análisis */}
          {riskData && (
            <div className={`mt-4 p-4 rounded-lg border ${getRiskColorClasses(riskData.riskLevel)}`}>
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

        <div className="flex flex-col space-y-3">
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