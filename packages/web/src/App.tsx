// App.tsx

import React from 'react';
import { AppProvider } from './context/AppContext';
import { HashRouter as Router, Routes, Route, NavLink } from 'react-router-dom';

import DashboardPage from './pages/DashboardPage';
import AnalyticsPage from './pages/AnalyticsPage'; // We will create this next
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
        <nav className="container mx-auto px-4 sm:px-8 mb-6">
          <div className="flex items-center gap-4 border-b border-gray-700/50 pb-2">
            <NavLink 
              to="/" 
              className={({ isActive }) => 
                `px-3 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700/50'}`
              }
            >
              Dashboard
            </NavLink>
            <NavLink 
              to="/analytics" 
              className={({ isActive }) => 
                `px-3 py-2 text-sm font-medium rounded-md ${isActive ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700/50'}`
              }
            >
              Analytics
            </NavLink>
          </div>
        </nav>
        <main className="container mx-auto p-4 sm:p-8">
            {/* --- NEW: Route Definitions --- */}
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
            </Routes>
        </main>
      </div>
      </Router>
    </AppProvider>
  );
}

export default App;