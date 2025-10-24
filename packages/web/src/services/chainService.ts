// src/services/chainService.ts

import { ethers } from 'ethers';
import {
  ETH_COLLATERAL_OAPP_ADDR, ETH_COLLATERAL_ABI,
  HEDERA_CREDIT_OAPP_ADDR, HEDERA_CREDIT_ABI,
  ETH_CHAIN_ID, HEDERA_CHAIN_ID, POLLING_INTERVAL
} from '../config';

// Define a type for our providers and signers for clarity
interface WalletConnections {
  ethProvider: ethers.BrowserProvider;
  ethSigner: ethers.Signer;
  hederaProvider: ethers.JsonRpcProvider;
  hederaSigner: ethers.Signer;
}

let connections: WalletConnections | null = null;
let ethContract: ethers.Contract;
let hederaContract: ethers.Contract;

// Function to connect to user's wallet (e.g., MetaMask)
export async function connectWallet(): Promise<string> {
    // 1. Check if window.ethereum exists immediately
    if (typeof window.ethereum === 'undefined') {
      // This is a critical error. The user likely doesn't have a wallet installed.
      console.error("Wallet provider (window.ethereum) not found.");
      throw new Error("Wallet not found. Please install a web3 wallet like MetaMask.");
    }
  
    try {
      // 2. Use the provider to request the connection. This is what triggers the MetaMask popup.
      const ethProvider = new ethers.BrowserProvider(window.ethereum, 'any');
      await ethProvider.send("eth_requestAccounts", []);
      
      // 3. If the above line succeeds, the wallet is connected. Now we get the signer.
      const ethSigner = await ethProvider.getSigner();
      const address = await ethSigner.getAddress();
      
      // 4. Set up Hedera provider with the now-connected signer's address
      const hederaProvider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
      
      // IMPORTANT: For Hedera JSON-RPC, you often need to create a new Wallet instance
      // with the private key to sign transactions, as `getSigner` might not work directly
      // for a different network. In a real app with MetaMask, you would request the user
      // to switch networks. For this script-like flow, we'll assume the same private key
      // can be used, which is NOT a real-world production pattern.
      // For now, we will connect the contract with the hederaProvider directly and let MetaMask
      // handle signing when the network is switched.
      const hederaSigner = ethSigner; // Simplification for now
  
      connections = { ethProvider, ethSigner, hederaProvider, hederaSigner };
  
      // Instantiate contracts
      ethContract = new ethers.Contract(ETH_COLLATERAL_OAPP_ADDR, ETH_COLLATERAL_ABI, ethSigner);
      hederaContract = new ethers.Contract(HEDERA_CREDIT_OAPP_ADDR, HEDERA_CREDIT_ABI, hederaSigner);
  
      console.log("Wallet connected successfully:", address);
      return address;
  
    } catch (error: any) {
      // 5. Catch any errors during the process
      console.error("Error connecting wallet:", error);
      if (error.code === 4001) {
        // EIP-1193 userRejectedRequest error
        throw new Error("Connection request rejected by user.");
      }
      // Re-throw a more generic error for other issues
      throw new Error(`Failed to connect wallet: ${error.message || 'An unknown error occurred.'}`);
    }
  }

// Helper to ensure the user is on the correct network
async function ensureNetwork(chainId: number) {
    // Use window.ethereum directly for robust network switching
    if (!window.ethereum) throw new Error("Wallet not found.");
    
    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    const targetChainId = ethers.hexlify(chainId);
  
    if (currentChainId !== targetChainId) {
      try {
        // This is the standard EIP-3326 method to switch chains
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        });
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
          // In a production app, you would add logic here to add the chain details.
          // For now, we'll just throw an informative error.
          throw new Error(`Network not found. Please add Chain ID ${chainId} (${targetChainId}) to your wallet.`);
        }
        throw switchError; // Re-throw other errors (e.g., user rejected the switch)
      }
    }
  }

// --- Ethereum Actions ---

export async function createOrderIdOnEthereum(): Promise<string> {
  if (!connections || !ethContract) throw new Error("Wallet not connected.");
  await ensureNetwork(ETH_CHAIN_ID);
  
  const tx = await ethContract.createOrderId();
  const receipt = await tx.wait();
  
  const event = receipt.logs
    .map((log: any) => { try { return ethContract.interface.parseLog(log); } catch { return null; } })
    .find((log: any) => log?.name === "OrderCreated");

  if (!event) throw new Error("OrderCreated event not found in transaction logs.");
  return event.args.orderId;
}

export async function fundOrderOnEthereum(orderId: string, amountEth: string): Promise<string> {
    if (!connections || !ethContract) throw new Error("Wallet not connected.");
    await ensureNetwork(ETH_CHAIN_ID);

    const amountWei = ethers.parseEther(amountEth);
    const userAddress = await connections.ethSigner.getAddress();
    
    // Quote the LayerZero fee
    const nativeFee = await ethContract.quoteOpenNativeFee(userAddress, amountWei);
    
    // Add a small buffer to the fee as in the script
    const totalValue = amountWei + nativeFee + (nativeFee / 10n);

    const tx = await ethContract.fundOrderWithNotify(orderId, amountWei, userAddress, { value: totalValue });
    await tx.wait();
    return tx.hash;
}

export async function withdrawEth(orderId: string): Promise<string> {
    if (!connections || !ethContract) throw new Error("Wallet not connected.");
    await ensureNetwork(ETH_CHAIN_ID);
    const tx = await ethContract.withdraw(orderId);
    await tx.wait();
    return tx.hash;
}

// --- Hedera Actions ---
export async function borrowFromHedera(orderId: string, borrowAmount: string): Promise<string> {
    if (!connections || !hederaContract) throw new Error("Wallet not connected.");
    await ensureNetwork(HEDERA_CHAIN_ID);
    
    // In a real app, you would fetch the Pyth data and calculate the borrow amount
    // For now, we'll use a placeholder amount and empty price data.
    const amountInSmallestUnit = ethers.parseUnits(borrowAmount, 6); // Assuming 6 decimals for hUSD
    
    // Placeholder for Pyth data and fees
    const priceUpdateData: any[] = []; // Empty for now
    const pythMaxAgeSec = 300;
    const estimatedFee = ethers.parseUnits("1", "gwei"); // Placeholder fee

    const tx = await hederaContract.borrow(orderId, amountInSmallestUnit, priceUpdateData, pythMaxAgeSec, { value: estimatedFee });
    await tx.wait();
    return tx.hash;
}

export async function repayOnHedera(orderId: string, repayAmount: string): Promise<string> {
    if (!connections || !hederaContract) throw new Error("Wallet not connected.");
    await ensureNetwork(HEDERA_CHAIN_ID);

    const amountInSmallestUnit = ethers.parseUnits(repayAmount, 6); // 6 decimals
    const nativeFee = await hederaContract.quoteRepayFee(orderId);
    
    // You would first need an `approve` transaction for the hUSD token here
    // For simplicity, we'll skip that and go straight to the repay call
    
    const tx = await hederaContract.repay(orderId, amountInSmallestUnit, true, { value: nativeFee });
    await tx.wait();
    return tx.hash;
}

// --- Polling Functions ---

export async function waitForHederaOrder(orderId: string, addLog: (log: string) => void): Promise<void> {
    addLog("Waiting for LayerZero message to arrive on Hedera...");
    for (let i = 0; i < 60; i++) { // Max 6 minutes
        try {
            const order = await hederaContract.horders(orderId);
            if (order && order.open) {
                addLog("✓ Order synced to Hedera!");
                return;
            }
        } catch (e) { /* ignore read errors from mirror nodes */ }
        addLog(`  [${i + 1}/60] Awaiting Hedera mirror...`);
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }
    throw new Error("Timed out waiting for Hedera order to be synced.");
}

export async function waitForEthereumRepayFlag(orderId: string, addLog: (log: string) => void): Promise<void> {
    addLog("Waiting for LayerZero message to arrive on Ethereum...");
    for (let i = 0; i < 40; i++) { // Max 4 minutes
        try {
            const order = await ethContract.orders(orderId);
            if (order && order.repaid) {
                addLog("✓ Ethereum order marked as repaid!");
                return;
            }
        } catch (e) { /* ignore read errors */ }
        addLog(`  [${i + 1}/40] Awaiting Ethereum repayment flag...`);
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }
    throw new Error("Timed out waiting for Ethereum repay flag.");
}