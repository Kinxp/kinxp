import React, { useMemo, useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { UserOrderSummary } from '../../types';
import { fetchAllUserOrders } from '../../services/blockscoutService';
import ChartCard from './ChartCard';

const COLORS = {
  Created: '#6b7280',
  Funded: '#3b82f6',
  Borrowed: '#2dd4bf',
  ReadyToWithdraw: '#f59e0b',
  Withdrawn: '#10b981',
  Liquidated: '#ef4444',
  PendingRepayConfirmation: '#a855f7',
};

const StatusPieChart = () => {
  const { address } = useAccount();
  const [allOrders, setAllOrders] = useState<UserOrderSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (address) {
      setIsLoading(true);
      fetchAllUserOrders(address)
        .then(setAllOrders)
        .catch(() => setError("Failed to fetch order statuses."))
        .finally(() => setIsLoading(false));
    }
  }, [address]);

  const portfolioDistribution = useMemo(() => {
    if (allOrders.length === 0) return [];
    
    const statusCounts = allOrders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(statusCounts).map(([name, value]) => ({
      name: name.replace(/([A-Z])/g, ' $1').trim(),
      value,
    }));
  }, [allOrders]);

  return (
    <ChartCard title="Order Status Distribution" isLoading={isLoading} error={error}>
      {portfolioDistribution.length > 0 ? (
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={portfolioDistribution}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
              nameKey="name"
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
            >
              {portfolioDistribution.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[entry.name.replace(/\s/g, '') as keyof typeof COLORS] || '#8884d8'} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ backgroundColor: '#1f2937', borderColor: '#4b5563' }} 
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex justify-center items-center h-full text-gray-500">
          No order data available.
        </div>
      )}
    </ChartCard>
  );
};

export default StatusPieChart;