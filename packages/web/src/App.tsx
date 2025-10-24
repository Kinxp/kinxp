// App.tsx

import React from 'react';
import { AppProvider } from './context/AppContext';
import MainPage from './pages/MainPage';
import Header from './components/Header';

function App() {
  return (
    // Wrap the entire application in our new context provider
    <AppProvider>
      <div className="bg-gray-900 min-h-screen text-white font-sans">
        <Header />
        <main className="container mx-auto p-4 sm:p-8">
          <MainPage />
        </main>
      </div>
    </AppProvider>
  );
}

export default App;