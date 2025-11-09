import React, { useMemo, useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ResponsiveContainer, AreaChart, Area, Tooltip, Legend, XAxis, YAxis, CartesianGrid } from 'recharts';
import { fetchHistoricalFunding, FundingEvent } from '../../services/blockscoutService';
import { fetchPythUpdateData } from '../../services/pythService';
import { formatUnits } from 'viem';
import ChartCard from './ChartCard';

// Helper functions can be shared, but are included here for simplicity
const formatCurrency = (value: number) => {
  if (isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(value);
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-700/80 backdrop-blur-sm border border-gray-600 rounded-lg p-3 text-sm">
        <p className="font-bold text-gray-200">{label}</p>
        <p style={{ color: payload[0].color }}>{`${payload[0].name}: ${formatCurrency(payload[0].value)}`}</p>
      </div>
    );
  }
  return null;
};

const CollateralChart = () => {
  const { address } = useAccount();
  const [fundingData, setFundingData] = useState<FundingEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ethPrice, setEthPrice] = useState<bigint>(0n);

  useEffect(() => {
    if (address) {
      setIsLoading(true);
      Promise.all([
        fetchHistoricalFunding(address),
        fetchPythUpdateData(),
      ])
      .then(([activity, priceData]) => {
        setFundingData(activity);
        setEthPrice(priceData.scaledPrice);
      })
      .catch(() => setError("Failed to fetch collateral history."))
      .finally(() => setIsLoading(false));
    }
  }, [address]);

  const accumulatedCollateralData = useMemo(() => {
    if (fundingData.length === 0 || !ethPrice) return [];
    
    const dailyTotalsWei = fundingData.reduce((acc, event) => {
      const date = new Date(event.timestamp * 1000).toISOString().split('T')[0];
      acc[date] = (acc[date] || 0n) + event.amountWei;
      return acc;
    }, {} as Record<string, bigint>);

    const sortedDates = Object.keys(dailyTotalsWei).sort();
    
    let runningTotalWei = 0n;
    return sortedDates.map(date => {
      runningTotalWei += dailyTotalsWei[date];
      const accumulatedUsdValue = parseFloat(formatUnits(runningTotalWei * ethPrice, 36));
      return {
        date,
        'Total Collateral Value': accumulatedUsdValue,
      };
    });
  }, [fundingData, ethPrice]);

  return (
    <ChartCard title="Total Collateral Value Over Time (USD)" isLoading={isLoading} error={error}>
      {accumulatedCollateralData.length > 0 ? (
        <ResponsiveContainer>
          <AreaChart data={accumulatedCollateralData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="colorCollateral" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
            <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} />
            <YAxis stroke="#9ca3af" tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Area type="monotone" dataKey="Total Collateral Value" stroke="#10b981" strokeWidth={2} fill="url(#colorCollateral)" name="Collateral Value (USD)" />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex justify-center items-center h-full text-gray-500">
          No historical funding activity found.
        </div>
      )}
    </ChartCard>
  );
};

export default CollateralChart;