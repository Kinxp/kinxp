import React, { useMemo, useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ResponsiveContainer, AreaChart, Area, Tooltip, Legend, XAxis, YAxis, CartesianGrid } from 'recharts';
import { fetchHistoricalBorrows, BorrowEvent } from '../../services/blockscoutService';
import { formatUnits } from 'viem';
import ChartCard from './ChartCard';

// Helper functions can be defined here or imported from a shared file
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

const TotalBorrowedChart = () => {
  const { address } = useAccount();
  const [borrowData, setBorrowData] = useState<BorrowEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (address) {
      setIsLoading(true);
      fetchHistoricalBorrows(address)
        .then(setBorrowData)
        .catch(() => setError("Failed to fetch borrow history."))
        .finally(() => setIsLoading(false));
    }
  }, [address]);

  const accumulatedBorrowData = useMemo(() => {
    if (borrowData.length === 0) return [];
    
    const dailyTotals = borrowData.reduce((acc, event) => {
      const date = new Date(event.timestamp * 1000).toISOString().split('T')[0];
      acc[date] = (acc[date] || 0n) + event.amountUsd;
      return acc;
    }, {} as Record<string, bigint>);

    const sortedDates = Object.keys(dailyTotals).sort();
    
    let runningTotal = 0n;
    return sortedDates.map(date => {
      runningTotal += dailyTotals[date];
      return {
        date,
        'Total Debt': parseFloat(formatUnits(runningTotal, 6)),
      };
    });
  }, [borrowData]);

  return (
    <ChartCard title="Total Debt Over Time (USD)" isLoading={isLoading} error={error}>
      {accumulatedBorrowData.length > 0 ? (
        <ResponsiveContainer>
          <AreaChart data={accumulatedBorrowData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="colorDebt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
            <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} />
            <YAxis stroke="#9ca3af" tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Area type="monotone" dataKey="Total Debt" stroke="#2dd4bf" strokeWidth={2} fill="url(#colorDebt)" />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex justify-center items-center h-full text-gray-500">
          No historical borrow activity found.
        </div>
      )}
    </ChartCard>
  );
};

export default TotalBorrowedChart;