import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatUnits } from 'viem';

// Import the service functions we need to get live data
import { fetchAllHistoricalFunding, fetchAllHistoricalBorrows, FundingEvent, BorrowEvent } from '../services/blockscoutService';
import { fetchPythUpdateData } from '../services/pythService';
import { SpinnerIcon } from '../components/Icons'; // Assuming you have a spinner icon component

// Helper to format large currency values with compact notation (e.g., $1.5K)
const formatCurrency = (value: number) => {
  if (isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD', 
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
};

// Custom Tooltip component for the chart
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-700/80 backdrop-blur-sm border border-gray-600 rounded-lg p-3 text-sm">
        <p className="font-bold text-gray-200">{label}</p>
        <p style={{ color: payload[0].color }}>
          {`${payload[0].name}: ${formatCurrency(payload[0].value)}`}
        </p>
      </div>
    );
  }
  return null;
};

const HomePage: React.FC = () => {
  // State management for the live data
  const [fundingData, setFundingData] = useState<FundingEvent[]>([]);
  const [borrowData, setBorrowData] = useState<BorrowEvent[]>([]);
  const [ethPrice, setEthPrice] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProtocolData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // --- THIS IS THE FIX ---
        // Use Promise.allSettled to ensure we get results even if one API fails.
        const results = await Promise.allSettled([
          fetchAllHistoricalFunding(),
          fetchAllHistoricalBorrows(),
          fetchPythUpdateData(),
        ]);

        // Now, we check the status of each promise individually.
        const fundingResult = results[0];
        if (fundingResult.status === 'fulfilled') {
          setFundingData(fundingResult.value);
        } else {
          console.error("Failed to fetch funding data:", fundingResult.reason);
          // We can still continue without this data.
        }

        const borrowResult = results[1];
        if (borrowResult.status === 'fulfilled') {
          setBorrowData(borrowResult.value);
        } else {
          console.error("Failed to fetch borrow data:", borrowResult.reason);
          // This is expected if the Hedera API is down.
        }

        const priceResult = results[2];
        if (priceResult.status === 'fulfilled') {
          setEthPrice(priceResult.value.scaledPrice);
        } else {
          console.error("Failed to fetch Pyth price data:", priceResult.reason);
          // Price is critical, so we might throw an error if it fails.
          throw new Error("Could not load critical market data.");
        }

      } catch (err: any) {
        setError(err.message || "Could not load all protocol statistics.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchProtocolData();
  }, []);

  // useMemo hooks to efficiently process the raw data into displayable metrics
  const kpiData = useMemo(() => {
    if (isLoading || error || !ethPrice) return { tvl: 0, totalBorrows: 0, totalOrders: 0 };

    const totalCollateralWei = fundingData.reduce((acc, event) => acc + event.amountWei, 0n);
    const tvl = parseFloat(formatUnits(totalCollateralWei * ethPrice, 36));
    
    const totalBorrows = borrowData.reduce((acc, event) => acc + parseFloat(formatUnits(event.amountUsd, 6)), 0);

    const totalOrders = new Set(fundingData.map(e => e.timestamp)).size;

    return { tvl, totalBorrows, totalOrders };
  }, [isLoading, error, fundingData, borrowData, ethPrice]);

  const accumulatedTvlData = useMemo(() => {
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
      return { date, tvl: accumulatedUsdValue };
    });
  }, [fundingData, ethPrice]);

  return (
    <div className="space-y-12 animate-fade-in">
      {/* --- HERO SECTION --- */}
      <section className="text-center max-w-3xl mx-auto">
        <h1 className="text-5xl md:text-6xl font-bold mb-4">
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 text-transparent bg-clip-text">
            The Cross-Chain Liquidity Protocol
          </span>
        </h1>
        <p className="text-lg text-gray-300 mb-8">
          Seamlessly collateralize assets on Ethereum to access instant liquidity on Hedera.
        </p>
        <Link 
          to="/dashboard"
          className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-4 px-8 rounded-lg text-xl transition-transform transform hover:scale-105"
        >
          Launch App
        </Link>
      </section>

      {/* --- KPI SECTION WITH LIVE DATA --- */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {isLoading ? (
            <div className="col-span-full text-gray-400 py-8">Loading protocol stats...</div>
        ) : error ? (
            <div className="col-span-full text-red-400 py-8">{error}</div>
        ) : (
            <>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Total Value Locked</p><p className="text-3xl font-bold text-white">{formatCurrency(kpiData.tvl)}</p></div>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Total Borrows</p><p className="text-3xl font-bold text-cyan-400">{formatCurrency(kpiData.totalBorrows)}</p></div>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Supported Chains</p><p className="text-3xl font-bold text-white">2</p></div>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Total Orders</p><p className="text-3xl font-bold text-white">{kpiData.totalOrders}</p></div>
            </>
        )}
      </section>

      {/* --- CHART SECTION WITH LIVE DATA --- */}
      <section className="bg-gray-800 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Protocol Growth (TVL Over Time)</h2>
        {isLoading ? (
            <div className="h-[400px] flex justify-center items-center gap-2 text-gray-400"><SpinnerIcon /><span>Loading Chart Data...</span></div>
        ) : error ? (
            <div className="h-[400px] flex justify-center items-center text-red-400">{error}</div>
        ) : (
            <div style={{ width: '100%', height: 400 }}>
              <ResponsiveContainer>
                <AreaChart data={accumulatedTvlData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <defs><linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.4}/><stop offset="95%" stopColor="#2dd4bf" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                  <XAxis dataKey="date" stroke="#9ca3af" tick={{fontSize: 12}} />
                  <YAxis stroke="#9ca3af" tickFormatter={(value) => formatCurrency(value)} tick={{fontSize: 12}} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="tvl" name="TVL (USD)" stroke="#2dd4bf" strokeWidth={2} fill="url(#colorTvl)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
        )}
      </section>
    </div>
  );
};

export default HomePage;