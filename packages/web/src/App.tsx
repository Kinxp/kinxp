// App.tsx

import React from 'react';
import { AppProvider } from './context/AppContext';
import DashboardPage from './pages/DashboardPage';
import Header from './components/Header';

function App() {
  return (
    <AppProvider>
      <div className="bg-gray-900 min-h-screen text-white font-sans">
        <Header />
        <main className="container mx-auto p-4 sm:p-8">
          <DashboardPage />
        </main>
      </div>
    </AppProvider>
  );
}

export default App;