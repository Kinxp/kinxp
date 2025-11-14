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
            position="top-right"
            toastOptions={{
                style: {
                    background: '#2d3748', // gray-800
                    color: '#e2e8f0', // gray-300
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