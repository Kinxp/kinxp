// App.tsx

import React from 'react';
import { AppProvider } from './context/AppContext';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';

import DashboardPage from './pages/DashboardPage';
import AnalyticsPage from './pages/AnalyticsPage'; 
import HomePage from './pages/HomePage';
import FutureDemoPage from './pages/FutureDemoPage';
import LiquidityPage from './pages/LiquidityPage';

import Header from './components/Header';
import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <AppProvider>
      <Router>
      <div className="bg-gray-900 min-h-screen text-white font-sans">
        <Toaster 
            position="bottom-right"
            toastOptions={{
                style: {
                    background: '#1e293b', // slate-800
                    color: '#f8fafc', // slate-50
                    padding: '16px',
                    borderRadius: '8px',
                    maxWidth: '400px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                },
            }}
        />
        <Header />
        <main className="container mx-auto p-4 sm:p-8">
            {/* --- NEW: Route Definitions --- */}
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/liquidity" element={<LiquidityPage />} />
              <Route path="/demo" element={<FutureDemoPage />} />
            </Routes>
        </main>
      </div>
      </Router>
    </AppProvider>
  );
}

export default App;