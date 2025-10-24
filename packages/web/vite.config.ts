// vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // Standard plugin for React projects
import tailwindcss from '@tailwindcss/vite'; // Your existing Tailwind plugin

export default defineConfig({
  // The plugins array now contains both react() and tailwindcss()
  plugins: [
    react(),
    tailwindcss(),
  ],

  // The new server configuration for the proxy
  server: {
    proxy: {
      // Any request from your app to a path starting with "/blockscout-api"
      // will be forwarded to the Blockscout server.
      '/blockscout-api': {
        // This is the real, correct Blockscout API server for Hedera Testnet
        target: 'https://hedera.cloud.blockscout.com',
        
        // This is required for the target server to accept the request
        changeOrigin: true,
        
        // This removes the "/blockscout-api" prefix before sending the request,
        // so the final request will be to "https://hedera.cloud.blockscout.com/api?..."
        rewrite: (path) => path.replace(/^\/blockscout-api/, ''),
      },
    }
  }
});