import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatUnits } from 'viem';

// Import service functions
import { 
  fetchAllHistoricalFunding, 
  fetchAllHistoricalBorrows, 
  fetchAllHistoricalRepayments, 
  FundingEvent, 
  BorrowEvent, 
  RepayEvent 
} from '../services/blockscoutService';
import { fetchPythUpdateData } from '../services/pythService';
import { SpinnerIcon } from '../components/Icons'; 

// --- HELPERS ---

const formatCurrency = (value: number) => {
  if (isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD', 
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
};

const formatEth = (wei: bigint) => {
  if (wei === 0n) return '0.0000000000 ETH';
  const decimal = formatUnits(wei, 18);
  const [intPart, fracPart = '0'] = decimal.split('.');
  const normalizedFrac = `${fracPart}${'0'.repeat(10)}`.slice(0, 10);
  return `${Number(intPart).toLocaleString('en-US')}.${normalizedFrac} ETH`;
};

// Standardize timestamp to 3-hour buckets
const getBucketTimestamp = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  date.setMinutes(0, 0, 0);
  const hours = Math.floor(date.getHours() / 3) * 3;
  date.setHours(hours);
  return date.getTime();
};

const formatBucketDate = (timestampMs: number): string => {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:00`;
};

const formatXAxisTick = (tick: string) => {
  try {
    const [datePart, timePart] = tick.split(' ');
    const [, month, day] = datePart.split('-');
    return `${month}/${day} ${timePart}`;
  } catch (e) { return tick; }
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-700/80 backdrop-blur-sm border border-gray-600 rounded-lg p-3 text-sm">
        <p className="font-bold text-gray-200 mb-1">{label}</p>
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
  const [fundingData, setFundingData] = useState<FundingEvent[]>([]);
  const [borrowData, setBorrowData] = useState<BorrowEvent[]>([]);
  const [repayData, setRepayData] = useState<RepayEvent[]>([]);
  const [ethPrice, setEthPrice] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProtocolData = async () => {
      setIsLoading(true);
      setError(null);

      const [fundingRes, borrowRes, repayRes, priceRes] = await Promise.allSettled([
        fetchAllHistoricalFunding(),
        fetchAllHistoricalBorrows(),
        fetchAllHistoricalRepayments(),
        fetchPythUpdateData(),
      ]);

      if (fundingRes.status === 'fulfilled') setFundingData(fundingRes.value);
      if (borrowRes.status === 'fulfilled') setBorrowData(borrowRes.value);
      if (repayRes.status === 'fulfilled') setRepayData(repayRes.value);
      
      if (priceRes.status === 'fulfilled') {
        setEthPrice(priceRes.value.scaledPrice);
      } else {
        setEthPrice(0n);
      }

      if (fundingRes.status === 'rejected' && borrowRes.status === 'rejected') {
        setError('Could not load protocol history.');
      }

      setIsLoading(false);
    };

    fetchProtocolData();
  }, []);

  // 1. KPI Calculation
  const kpiData = useMemo(() => {
    if (isLoading || error || !ethPrice) {
      return { tvl: 0, totalBorrows: 0, totalRepaid: 0, netDebt: 0, totalEthWei: 0n, totalOrders: 0 };
    }

    const totalCollateralWei = fundingData.reduce((acc, event) => acc + event.amountWei, 0n);
    const tvl = parseFloat(formatUnits(totalCollateralWei * ethPrice, 36));
    const totalBorrows = borrowData.reduce((acc, event) => acc + parseFloat(formatUnits(event.amountUsd, 6)), 0);
    const totalRepaid = repayData.reduce((acc, event) => acc + parseFloat(formatUnits(event.amountUsd, 6)), 0);
    const totalOrders = new Set(fundingData.map(e => e.timestamp)).size;

    return { 
      tvl, 
      totalBorrows, 
      totalRepaid,
      netDebt: totalBorrows - totalRepaid, 
      totalEthWei: totalCollateralWei, 
      totalOrders 
    };
  }, [isLoading, error, fundingData, borrowData, repayData, ethPrice]);

  // 2. TVL Chart Data (Filled Timeline)
  const accumulatedTvlData = useMemo(() => {
    if (fundingData.length === 0 || !ethPrice) return [];

    // 1. Map changes to specific 3h buckets
    const bucketChanges: Record<string, bigint> = {};
    let minTs = getBucketTimestamp(fundingData[0].timestamp);
    const maxTs = getBucketTimestamp(Date.now() / 1000);

    fundingData.forEach(event => {
      const bucketTs = getBucketTimestamp(event.timestamp);
      const bucketKey = formatBucketDate(bucketTs);
      bucketChanges[bucketKey] = (bucketChanges[bucketKey] || 0n) + event.amountWei;
      if (bucketTs < minTs) minTs = bucketTs;
    });

    // 2. Iterate from Start to Now, carrying over the running total
    const dataPoints = [];
    let runningTotalWei = 0n;
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

    for (let ts = minTs; ts <= maxTs; ts += THREE_HOURS_MS) {
      const bucketKey = formatBucketDate(ts);
      // Apply any changes that happened in this specific bucket
      if (bucketChanges[bucketKey]) {
        runningTotalWei += bucketChanges[bucketKey];
      }
      
      const accumulatedUsdValue = parseFloat(formatUnits(runningTotalWei * ethPrice, 36));
      dataPoints.push({
        date: bucketKey,
        tvl: accumulatedUsdValue
      });
    }

    return dataPoints;
  }, [fundingData, ethPrice]);

  // 3. Net Debt Chart Data (Filled Timeline)
  const accumulatedNetDebtData = useMemo(() => {
    if (borrowData.length === 0 && repayData.length === 0) return [];

    const timeline = [
      ...borrowData.map(e => ({ timestamp: e.timestamp, amount: parseFloat(formatUnits(e.amountUsd, 6)) })),
      ...repayData.map(e => ({ timestamp: e.timestamp, amount: -parseFloat(formatUnits(e.amountUsd, 6)) }))
    ].sort((a, b) => a.timestamp - b.timestamp);

    const bucketChanges: Record<string, number> = {};
    let minTs = getBucketTimestamp(timeline[0].timestamp);
    const maxTs = getBucketTimestamp(Date.now() / 1000);

    timeline.forEach(event => {
      const bucketTs = getBucketTimestamp(event.timestamp);
      const bucketKey = formatBucketDate(bucketTs);
      bucketChanges[bucketKey] = (bucketChanges[bucketKey] || 0) + event.amount;
    });

    const dataPoints = [];
    let runningNetDebt = 0;
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

    for (let ts = minTs; ts <= maxTs; ts += THREE_HOURS_MS) {
      const bucketKey = formatBucketDate(ts);
      if (bucketChanges[bucketKey]) {
        runningNetDebt += bucketChanges[bucketKey];
      }
      
      const displayValue = Math.max(0, runningNetDebt);
      dataPoints.push({
        date: bucketKey,
        debt: displayValue
      });
    }

    return dataPoints;
  }, [borrowData, repayData]);

  return (
    <div className="space-y-12 animate-fade-in pb-12">
      {/* --- HERO --- */}
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

      {/* --- KPI CARDS --- */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6 text-center">
        {isLoading ? (
            <div className="col-span-full text-gray-400 py-8">Loading protocol stats...</div>
        ) : error ? (
            <div className="col-span-full text-red-400 py-8">{error}</div>
        ) : (
            <>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Total Value Locked</p>
                  <p className="text-2xl lg:text-3xl font-bold text-white mt-1">{formatCurrency(kpiData.tvl)}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Total Borrow Volume</p>
                  <p className="text-2xl lg:text-3xl font-bold text-cyan-400 mt-1">{formatCurrency(kpiData.totalBorrows)}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Total Repaid</p>
                  <p className="text-2xl lg:text-3xl font-bold text-green-400 mt-1">{formatCurrency(kpiData.totalRepaid)}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Active Outstanding Debt</p>
                  <p className="text-2xl lg:text-3xl font-bold text-yellow-400 mt-1">{formatCurrency(kpiData.netDebt)}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700/50">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Total Orders</p>
                  <p className="text-2xl lg:text-3xl font-bold text-white mt-1">{kpiData.totalOrders}</p>
                </div>
            </>
        )}
      </section>

      {/* --- CHARTS --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* CHART 1: TVL */}
        <section className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700/30">
          <h2 className="text-xl font-semibold mb-4 text-white">Protocol Growth (TVL)</h2>
          {isLoading ? (
            <div className="h-[300px] flex justify-center items-center gap-2 text-gray-400"><SpinnerIcon /><span>Loading Data...</span></div>
          ) : accumulatedTvlData.length === 0 ? (
            <div className="h-[300px] flex justify-center items-center text-gray-400">No activity detected.</div>
          ) : (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <AreaChart data={accumulatedTvlData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" opacity={0.5} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#9ca3af" 
                    tick={{ fontSize: 12 }} 
                    tickMargin={10} 
                    tickFormatter={formatXAxisTick} 
                    minTickGap={30}
                  />
                  <YAxis 
                    stroke="#9ca3af" 
                    tickFormatter={(value) => formatCurrency(value)} 
                    tick={{ fontSize: 12 }} 
                    width={60} 
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {/* type="stepAfter" makes it look like a solid timeline state change, "monotone" is smoother */}
                  <Area type="stepAfter" dataKey="tvl" name="TVL" stroke="#2dd4bf" strokeWidth={2} fill="url(#colorTvl)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* CHART 2: NET DEBT */}
        <section className="bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-700/30">
          <h2 className="text-xl font-semibold mb-4 text-white">Active Outstanding Debt</h2>
          {isLoading ? (
            <div className="h-[300px] flex justify-center items-center gap-2 text-gray-400"><SpinnerIcon /><span>Loading Data...</span></div>
          ) : accumulatedNetDebtData.length === 0 ? (
            <div className="h-[300px] flex justify-center items-center text-gray-400">No borrowing activity.</div>
          ) : (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <AreaChart data={accumulatedNetDebtData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorDebt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" opacity={0.5} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#9ca3af" 
                    tick={{ fontSize: 12 }} 
                    tickMargin={10} 
                    tickFormatter={formatXAxisTick}
                    minTickGap={30}
                  />
                  <YAxis 
                    stroke="#9ca3af" 
                    tickFormatter={(value) => formatCurrency(value)} 
                    tick={{ fontSize: 12 }} 
                    width={60} 
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="stepAfter" dataKey="debt" name="Active Debt" stroke="#fbbf24" strokeWidth={2} fill="url(#colorDebt)" />
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