import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatUnits } from 'viem';

// Import the service functions we need to get live data
import { fetchAllHistoricalFunding, fetchAllHistoricalBorrows, FundingEvent, BorrowEvent } from '../services/blockscoutService';
import { fetchPythUpdateData } from '../services/pythService';
import { SpinnerIcon } from '../components/Icons'; 

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

// Helper to format ETH values with fixed precision (at least 10 decimal places)
const formatEth = (wei: bigint) => {
  if (wei === 0n) return '0.0000000000 ETH';
  const decimal = formatUnits(wei, 18);
  const [intPart, fracPart = '0'] = decimal.split('.');
  const normalizedFrac = `${fracPart}${'0'.repeat(10)}`.slice(0, 10);
  return `${Number(intPart).toLocaleString('en-US')}.${normalizedFrac} ETH`;
};

// Custom Tooltip component for the chart
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-700/80 backdrop-blur-sm border border-gray-600 rounded-lg p-3 text-sm">
        <p className="font-bold text-gray-200">{label}</p>
        {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }}>
                {`${entry.name}: ${formatCurrency(entry.value)}`}
            </p>
        ))}
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

      const [fundingRes, borrowRes, priceRes] = await Promise.allSettled([
        fetchAllHistoricalFunding(),
        fetchAllHistoricalBorrows(),
        fetchPythUpdateData(),
      ]);

      if (fundingRes.status === 'fulfilled') {
        setFundingData(fundingRes.value);
      } else {
        console.warn('Funding history unavailable', fundingRes.reason);
      }

      if (borrowRes.status === 'fulfilled') {
        setBorrowData(borrowRes.value);
      } else {
        console.warn('Borrow history unavailable', borrowRes.reason);
      }

      if (priceRes.status === 'fulfilled') {
        setEthPrice(priceRes.value.scaledPrice);
      } else {
        console.warn('Pyth price unavailable', priceRes.reason);
        setEthPrice(0n);
      }

      if (fundingRes.status === 'rejected' && borrowRes.status === 'rejected') {
        setError('Could not load protocol history from explorers.');
      }

      setIsLoading(false);
    };

    fetchProtocolData();
  }, []);

  // 1. KPI Calculation
  const kpiData = useMemo(() => {
    if (isLoading || error || !ethPrice) {
      return { tvl: 0, totalBorrows: 0, totalOrders: 0, totalEthWei: 0n };
    }

    const totalCollateralWei = fundingData.reduce((acc, event) => acc + event.amountWei, 0n);
    const tvl = parseFloat(formatUnits(totalCollateralWei * ethPrice, 36));
    
    // Assuming Borrowed amounts are 6 decimals (e.g. USDC/HUSD)
    const totalBorrows = borrowData.reduce((acc, event) => acc + parseFloat(formatUnits(event.amountUsd, 6)), 0);

    const totalOrders = new Set(fundingData.map(e => e.timestamp)).size;

    return { tvl, totalBorrows, totalOrders, totalEthWei: totalCollateralWei };
  }, [isLoading, error, fundingData, borrowData, ethPrice]);

  // 2. TVL Chart Data Calculation
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

  // 3. Borrowed Chart Data Calculation
  const accumulatedBorrowData = useMemo(() => {
    if (borrowData.length === 0) return [];

    const dailyTotalsUsd = borrowData.reduce((acc, event) => {
      const date = new Date(event.timestamp * 1000).toISOString().split('T')[0];
      acc[date] = (acc[date] || 0n) + event.amountUsd;
      return acc;
    }, {} as Record<string, bigint>);

    const sortedDates = Object.keys(dailyTotalsUsd).sort();

    let runningTotalUsd = 0n;
    return sortedDates.map(date => {
      runningTotalUsd += dailyTotalsUsd[date];
      // Assuming 6 decimals for stablecoins
      const accumulatedValue = parseFloat(formatUnits(runningTotalUsd, 6));
      return { date, borrows: accumulatedValue };
    });
  }, [borrowData]);

  return (
    <div className="space-y-12 animate-fade-in pb-12">
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

      {/* --- KPI SECTION --- */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        {isLoading ? (
            <div className="col-span-full text-gray-400 py-8">Loading protocol stats...</div>
        ) : error ? (
            <div className="col-span-full text-red-400 py-8">{error}</div>
        ) : (
            <>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Total Value Locked</p><p className="text-3xl font-bold text-white">{formatCurrency(kpiData.tvl)}</p></div>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Total Borrows</p><p className="text-3xl font-bold text-cyan-400">{formatCurrency(kpiData.totalBorrows)}</p></div>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Total ETH Locked</p><p className="text-3xl font-bold text-white">{formatEth(kpiData.totalEthWei)}</p></div>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Supported Chains</p><p className="text-3xl font-bold text-white">2</p></div>
                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700/50"><p className="text-sm text-gray-400">Total Orders</p><p className="text-3xl font-bold text-white">{kpiData.totalOrders}</p></div>
            </>
        )}
      </section>

      {/* --- CHARTS GRID --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* --- CHART 1: TVL --- */}
        <section className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700/30">
          <h2 className="text-xl font-semibold mb-4 text-white">Protocol Growth (TVL)</h2>
          {isLoading ? (
            <div className="h-[300px] flex justify-center items-center gap-2 text-gray-400"><SpinnerIcon /><span>Loading Data...</span></div>
          ) : error ? (
            <div className="h-[300px] flex justify-center items-center text-red-400">{error}</div>
          ) : accumulatedTvlData.length === 0 ? (
            <div className="h-[300px] flex flex-col justify-center items-center text-gray-400 gap-2">
              <span>No funding activity detected yet.</span>
            </div>
          ) : (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <AreaChart data={accumulatedTvlData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" opacity={0.5} />
                  <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} tickMargin={10} />
                  <YAxis stroke="#9ca3af" tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="tvl" name="TVL" stroke="#2dd4bf" strokeWidth={2} fill="url(#colorTvl)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* --- CHART 2: BORROWS --- */}
        <section className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700/30">
          <h2 className="text-xl font-semibold mb-4 text-white">Total Borrowed Over Time</h2>
          {isLoading ? (
            <div className="h-[300px] flex justify-center items-center gap-2 text-gray-400"><SpinnerIcon /><span>Loading Data...</span></div>
          ) : error ? (
            <div className="h-[300px] flex justify-center items-center text-red-400">{error}</div>
          ) : accumulatedBorrowData.length === 0 ? (
            <div className="h-[300px] flex flex-col justify-center items-center text-gray-400 gap-2">
              <span>No borrowing activity detected yet.</span>
            </div>
          ) : (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <AreaChart data={accumulatedBorrowData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBorrow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" opacity={0.5} />
                  <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} tickMargin={10} />
                  <YAxis stroke="#9ca3af" tickFormatter={(value) => formatCurrency(value)} tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="borrows" name="Borrowed" stroke="#818cf8" strokeWidth={2} fill="url(#colorBorrow)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

      </div>
    </div>
  );
};

export default HomePage;