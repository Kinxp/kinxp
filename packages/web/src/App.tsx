// App.tsx

import React from 'react';
import { AppProvider } from './context/AppContext';
import DashboardPage from './pages/DashboardPage';
import Header from './components/Header';
import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <AppProvider>
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
          <DashboardPage />
        </main>
      </div>
    </AppProvider>
  );
}

export default App;