import { ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, Tooltip, Legend, XAxis, YAxis, CartesianGrid } from 'recharts';

// --- DEMO DATA & COMPONENTS ---

const FAKE_ACCUMULATED_DATA = [
    { date: '2024-01-10', 'Total Collateral Value': 1500 },
    { date: '2024-01-15', 'Total Collateral Value': 2200 },
    { date: '2024-01-20', 'Total Collateral Value': 1800 },
    { date: '2024-01-25', 'Total Collateral Value': 3500 },
    { date: '2024-01-30', 'Total Collateral Value': 4100 },
  ];
  
  const FAKE_PIE_DATA = [
    { name: 'Borrowed', value: 2 },
    { name: 'Ready to Withdraw', value: 1 },
    { name: 'Funded', value: 3 },
  ];
  
  const COLORS = {
    Funded: '#3b82f6',
    Borrowed: '#2dd4bf',
    ReadyToWithdraw: '#f59e0b',
  };
  
  const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(value);
  
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
  const DemoAnalyticsView = () => (
    <div className="relative space-y-8 animate-fade-in">
        {/* Blur overlay */}
        <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-[2px] z-10 rounded-2xl"></div>

        {/* --- DEMO CHARTS --- */}
        <div className="bg-gray-800 rounded-2xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-400">Total Collateral Value Over Time (USD)</h2>
            <div style={{ width: '100%', height: 400 }}>
                <ResponsiveContainer>
                    <AreaChart data={FAKE_ACCUMULATED_DATA} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                        <XAxis dataKey="date" stroke="#9ca3af" />
                        <YAxis stroke="#9ca3af" tickFormatter={(value) => formatCurrency(value)} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="Total Collateral Value" stroke="#10b981" fill="#10b981" fillOpacity={0.1} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
        <div className="bg-gray-800 rounded-2xl p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-400">Order Status Distribution</h2>
            <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                    <PieChart>
                        <Pie data={FAKE_PIE_DATA} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                            {FAKE_PIE_DATA.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[entry.name.replace(/\s/g, '') as keyof typeof COLORS]} />
                            ))}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#4b5563' }} />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    </div>
);
  
  export default DemoAnalyticsView;