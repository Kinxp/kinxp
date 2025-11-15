// src/services/chainService.ts

import { ethers } from 'ethers';
import {
  ETH_COLLATERAL_OAPP_ADDR, ETH_COLLATERAL_ABI,
  HEDERA_CREDIT_OAPP_ADDR, HEDERA_CREDIT_ABI,
  LIQUIDITY_POOL_ADDR, LIQUIDITY_POOL_ABI,
  UNDERLYING_TOKEN_ADDR, LP_TOKEN_ADDR, REWARD_TOKEN_ADDR,
  ETH_CHAIN_ID, HEDERA_CHAIN_ID, POLLING_INTERVAL,
  HEDERA_BLOCKSCOUT_API_URL, SEPOLIA_BLOCKSCOUT_API_URL
} from '../config';

// Network configuration
const NETWORKS = {
  ethereum: {
    chainId: ETH_CHAIN_ID,
    name: 'Ethereum',
    rpcUrl: 'https://sepolia.infura.io/v3/YOUR-INFURA-KEY', // Replace with your Infura key
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      collateral: ETH_COLLATERAL_OAPP_ADDR,
      liquidityPool: LIQUIDITY_POOL_ADDR,
      underlyingToken: UNDERLYING_TOKEN_ADDR,
      lpToken: LP_TOKEN_ADDR,
      rewardToken: REWARD_TOKEN_ADDR,
      abi: ETH_COLLATERAL_ABI
    }
  },
  hedera: {
    chainId: HEDERA_CHAIN_ID,
    name: 'Hedera',
    rpcUrl: 'https://testnet.hashio.io/api',
    explorerUrl: 'https://hashscan.io/testnet',
    nativeCurrency: {
      name: 'HBAR',
      symbol: 'HBAR',
      decimals: 18,
    },
    contracts: {
      credit: HEDERA_CREDIT_OAPP_ADDR,
      abi: HEDERA_CREDIT_ABI
    }
  }
} as const;

type NetworkName = keyof typeof NETWORKS;

interface NetworkConnections {
  provider: ethers.BrowserProvider | ethers.JsonRpcProvider;
  signer: ethers.Signer;
  contract?: ethers.Contract;
  liquidityPool?: ethers.Contract;
  isConnected: boolean;
  chainId: string;
}

// Store connections for each network
const connections: Record<NetworkName, NetworkConnections> = {
  ethereum: {
    provider: null as any,
    signer: null as any,
    contract: null as any,
    liquidityPool: null as any,
    isConnected: false,
    chainId: `0x${ETH_CHAIN_ID.toString(16)}`
  },
  hedera: {
    provider: null as any,
    signer: null as any,
    contract: null as any,
    isConnected: false,
    chainId: `0x${HEDERA_CHAIN_ID.toString(16)}`
  }
};

// Contract instances
let ethCollateralContract: ethers.Contract | null = null;
let hederaCreditContract: ethers.Contract | null = null;

// Active network state
let activeNetwork: NetworkName | null = null;

/**
 * Error class for network-related errors
 */
class NetworkError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Helper to check if a network is supported
 */
function isNetworkSupported(chainId: string): NetworkName | null {
  const chainIdNum = parseInt(chainId, 16);
  return chainIdNum === ETH_CHAIN_ID ? 'ethereum' :
         chainIdNum === HEDERA_CHAIN_ID ? 'hedera' : null;
}

/**
 * Helper to get the network name from chainId
 */
function getNetworkName(chainId: string | number): NetworkName {
  const networkName = Object.entries(NETWORKS).find(
    ([_, network]) => network.chainId === (typeof chainId === 'string' ? parseInt(chainId, 16) : chainId)
  )?.[0] as NetworkName | undefined;
  
  if (!networkName) {
    throw new NetworkError(`Unsupported chainId: ${chainId}`);
  }
  return networkName;
}

/**
 * Connect to a specific network
 */
export async function connectNetwork(networkName: NetworkName): Promise<{
  address: string;
  network: NetworkName;
  chainId: string;
}> {
  if (typeof window.ethereum === 'undefined') {
    throw new NetworkError('Web3 wallet not found. Please install MetaMask or another Web3 wallet.');
  }

  const network = NETWORKS[networkName];
  const connection = connections[networkName];

  try {
    // Request account access if needed
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    
    // Check if the correct network is already connected
    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    
    if (currentChainId !== network.chainId) {
      try {
        // Try to switch to the correct network
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${network.chainId.toString(16)}` }],
        });
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: `0x${network.chainId.toString(16)}`,
                chainName: network.name,
                nativeCurrency: network.nativeCurrency,
                rpcUrls: [network.rpcUrl],
                blockExplorerUrls: [network.explorerUrl],
              }],
            });
          } catch (addError) {
            throw new NetworkError(
              `Failed to add ${network.name} network to your wallet. ` +
              'Please add it manually in your wallet settings.',
              'NETWORK_ADD_FAILED'
            );
          }
        } else {
          throw new NetworkError(
            `Failed to switch to ${network.name} network. ` +
            'Please switch manually in your wallet.',
            'NETWORK_SWITCH_FAILED'
          );
        }
      }
    }

    // Set up the provider and signer
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const chainId = await signer.getChainId();

    // Update connection state
    connection.provider = provider;
    connection.signer = signer;
    connection.isConnected = true;
    connection.chainId = `0x${chainId.toString(16)}`;

    // Initialize contracts if we have a signer
    if (signer) {
      const contracts = NETWORKS[networkName].contracts as any;
      
      // Main contract with explicit ABI
      const mainContractAbi = [
        // Common ERC20 functions
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function totalSupply() view returns (uint256)',
        'function balanceOf(address) view returns (uint256)',
        'function transfer(address to, uint256 value) returns (bool)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function transferFrom(address from, address to, uint256 value) returns (bool)'
      ];
      
      connections[networkName].contract = new ethers.Contract(
        contracts.collateral || contracts.credit,
        mainContractAbi,
        signer
      );
      
      // Liquidity Pool contract if available
      if (contracts.liquidityPool) {
        connections[networkName].liquidityPool = new ethers.Contract(
          contracts.liquidityPool,
          [
            'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
            'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
            'function claimRewards() returns (uint256)',
            'function totalAssets() view returns (uint256)',
            'function totalSupply() view returns (uint256)',
            'function rewardRate() view returns (uint256)',
            'function asset() view returns (address)',
            'function rewardsToken() view returns (address)'
          ],
          signer
        );
      }
    }

    activeNetwork = networkName;
    console.log(`Connected to ${network.name} at address:`, address);

    return {
      address,
      network: networkName,
      chainId: connection.chainId
    };
  } catch (error: any) {
    console.error(`Error connecting to ${networkName}:`, error);
    
    if (error.code === 4001) {
      throw new NetworkError('Connection request was rejected by user.', 'USER_REJECTED');
    }
    
    throw new NetworkError(
      error.message || `Failed to connect to ${networkName}`,
      error.code || 'CONNECTION_ERROR'
    );
  }
}

/**
 * Disconnect from the current network
 */
export async function disconnectNetwork(networkName: NetworkName): Promise<void> {
  const connection = connections[networkName];
  
  if (connection) {
    // Reset connection state
    connection.isConnected = false;
    // Don't clear provider/signer as they might be needed for reconnection
    
    if (networkName === activeNetwork) {
      activeNetwork = null;
    }
    
    console.log(`Disconnected from ${networkName}`);
  }
}

/**
 * Get the current connection status for a network
 */
export function getConnectionStatus(networkName: NetworkName) {
  return {
    isConnected: connections[networkName]?.isConnected || false,
    address: connections[networkName]?.signer?.address,
    chainId: connections[networkName]?.chainId,
    network: NETWORKS[networkName].name
  };
}

/**
 * Get the active network
 */
export function getActiveNetwork(): NetworkName | null {
  return activeNetwork;
}

/**
 * Get the contract instance for a network
 */
export function getContract(networkName: NetworkName): ethers.Contract | null {
  return connections[networkName]?.contract || null;
}

// Set up event listeners for network changes
if (typeof window !== 'undefined' && window.ethereum) {
  window.ethereum.on('chainChanged', (chainId: string) => {
    const networkName = isNetworkSupported(chainId);
    if (networkName) {
      console.log(`Switched to ${networkName} network`);
      // Update active network
      activeNetwork = networkName;
      // Update connection state
      connections[networkName].chainId = chainId;
      // Emit an event or update your app's state here
      window.dispatchEvent(new Event('networkChanged'));
    } else {
      console.warn('Unsupported network detected:', chainId);
      activeNetwork = null;
    }
  });

  window.ethereum.on('accountsChanged', (accounts: string[]) => {
    console.log('Accounts changed:', accounts);
    // Update the signer in all connections
    Object.entries(connections).forEach(async ([networkName, connection]) => {
      if (connection.provider && 'getSigner' in connection.provider) {
        try {
          const signer = await connection.provider.getSigner();
          connection.signer = signer;
          
          // Update contract instances with new signer
          if (networkName === 'ethereum' && ethCollateralContract) {
            ethCollateralContract = ethCollateralContract.connect(signer) as ethers.Contract;
          } else if (networkName === 'hedera' && hederaCreditContract) {
            hederaCreditContract = hederaCreditContract.connect(signer) as ethers.Contract;
          }
          
          console.log(`Updated signer for ${networkName}:`, await signer.getAddress());
        } catch (error) {
          console.error(`Failed to update signer for ${networkName}:`, error);
          connection.isConnected = false;
        }
      }
    });
    
    // Emit an event or update your app's state here
    window.dispatchEvent(new Event('accountsChanged'));
  });
}

/**
 * Ensure the user is connected to the specified network
 * @param networkName The target network name ('ethereum' or 'hedera')
 * @returns The connected account address
 */
async function ensureNetwork(networkName: NetworkName): Promise<string> {
  if (!connections[networkName]?.isConnected) {
    const result = await connectNetwork(networkName);
    return result.address;
  }
  
  // Verify the network is still correct
  const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
  const targetChainId = `0x${NETWORKS[networkName].chainId.toString(16)}`;
  
  if (currentChainId !== targetChainId) {
    // If not on the correct network, reconnect
    const result = await connectNetwork(networkName);
    return result.address;
  }
  
  // Return the connected address
  const signer = connections[networkName].signer;
  return signer?.getAddress() || '';
}

// --- Ethereum Actions ---

export async function createOrderIdOnEthereum(): Promise<string> {
  if (!connections || !ethContract) throw new Error("Wallet not connected.");
  await ensureNetwork('ethereum');
  
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
    await ensureNetwork('ethereum');

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
    await ensureNetwork('ethereum');
    const tx = await ethContract.withdraw(orderId);
    await tx.wait();
    return tx.hash;
}

// --- Hedera Actions ---
export async function borrowFromHedera(orderId: string, borrowAmount: string): Promise<string> {
    if (!connections || !hederaContract) throw new Error("Wallet not connected.");
    await ensureNetwork('hedera');
    
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
    await ensureNetwork('hedera');

    const amountInSmallestUnit = ethers.parseUnits(repayAmount, 6); // 6 decimals
    const nativeFee = await hederaContract.quoteRepayFee(orderId);
    
    // You would first need an `approve` transaction for the hUSD token here
    // For simplicity, we'll skip that and go straight to the repay call
    
    const tx = await hederaContract.repay(orderId, amountInSmallestUnit, true, { value: nativeFee });
    await tx.wait();
    return tx.hash;
}

// --- Liquidity Pool Functions ---

export async function depositToLiquidityPool(amount: string, receiver: string): Promise<string> {
  const networkName = 'ethereum';
  const { signer } = connections[networkName];
  
  // Get the underlying token contract
  const tokenContract = new ethers.Contract(
    UNDERLYING_TOKEN_ADDR,
    [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)'
    ],
    signer
  );

  // Approve the liquidity pool to spend tokens
  const allowance = await tokenContract.allowance(await signer.getAddress(), LIQUIDITY_POOL_ADDR);
  if (allowance.lt(amount)) {
    const approveTx = await tokenContract.approve(LIQUIDITY_POOL_ADDR, ethers.MaxUint256);
    await approveTx.wait();
  }

  // Deposit to the liquidity pool with explicit ABI
  const liquidityPool = new ethers.Contract(
    LIQUIDITY_POOL_ADDR, 
    [
      'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
      'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
      'function claimRewards() returns (uint256)',
      'function totalAssets() view returns (uint256)',
      'function totalSupply() view returns (uint256)',
      'function rewardRate() view returns (uint256)',
      'function asset() view returns (address)',
      'function rewardsToken() view returns (address)'
    ],
    signer
  );
  const tx = await liquidityPool.deposit(amount, receiver);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function withdrawFromLiquidityPool(assets: string, receiver: string, owner: string): Promise<string> {
  const networkName = 'ethereum';
  const { signer } = connections[networkName];
  
  const liquidityPool = new ethers.Contract(
    LIQUIDITY_POOL_ADDR,
    ['function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)'],
    signer
  );
  const tx = await liquidityPool.withdraw(assets, receiver, owner);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function claimRewards(): Promise<string> {
  const networkName = 'ethereum';
  const { signer } = connections[networkName];
  
  const liquidityPool = new ethers.Contract(
    LIQUIDITY_POOL_ADDR,
    ['function claimRewards() returns (uint256)'],
    signer
  );
  const tx = await liquidityPool.claimRewards();
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function getLiquidityPoolInfo() {
  const networkName = 'ethereum';
  const connection = connections[networkName];
  
  if (!connection.liquidityPool) {
    throw new Error('Liquidity pool contract not initialized');
  }
  
  const [
    totalAssets,
    totalSupply,
    rewardRate,
    assetAddress,
    rewardsTokenAddress
  ] = await Promise.all([
    connection.liquidityPool.totalAssets(),
    connection.liquidityPool.totalSupply(),
    connection.liquidityPool.rewardRate(),
    connection.liquidityPool.asset(),
    connection.liquidityPool.rewardsToken()
  ]);
  
  return {
    totalAssets: totalAssets.toString(),
    totalSupply: totalSupply.toString(),
    rewardRate: rewardRate.toString(),
    assetAddress,
    rewardsTokenAddress
  };
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