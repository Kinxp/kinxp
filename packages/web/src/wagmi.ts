// src/wagmi.ts
import { http, createConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { hederaTestnet } from './chains'; // Import our custom chain

export const config = createConfig({
  chains: [sepolia, hederaTestnet],
  transports: {
    [sepolia.id]: http(),
    [hederaTestnet.id]: http(),
  },
});