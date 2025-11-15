import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { depositToLiquidityPool, withdrawFromLiquidityPool, claimRewards, getLiquidityPoolInfo } from '../services/chainService';
import { formatUnits, parseUnits } from 'ethers';
import { toast } from 'react-hot-toast';

// Components
import LiquidityStats from '../components/liquidity/LiquidityStats';
import LiquidityActions from '../components/liquidity/LiquidityActions';
import LiquidityPositions from '../components/liquidity/LiquidityPositions';
import Loader from '../components/common/Loader';

const LiquidityPage: React.FC = () => {
  const { isConnected, address, connectWallet } = useAppContext();
  const [isLoading, setIsLoading] = useState(true);
  const [poolInfo, setPoolInfo] = useState<any>(null);
  const [userPosition, setUserPosition] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();

  // Fetch pool and user data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const info = await getLiquidityPoolInfo();
        setPoolInfo(info);
        
        // TODO: Fetch user's position data
        // const position = await getUserLiquidityPosition(address);
        // setUserPosition(position);
        
      } catch (error) {
        console.error('Error fetching pool data:', error);
        toast.error('Failed to load pool data');
      } finally {
        setIsLoading(false);
      }
    };

    if (isConnected) {
      fetchData();
      const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [isConnected, address]);

  const handleDeposit = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!address) {
      toast.error('Wallet not connected');
      return;
    }

    try {
      setIsProcessing(true);
      const amountInWei = parseUnits(amount, 18); // Adjust decimals based on token
      const txHash = await depositToLiquidityPool(amountInWei.toString(), address);
      toast.success(`Deposit successful! Tx: ${txHash.slice(0, 10)}...`);
      setAmount('');
    } catch (error) {
      console.error('Deposit failed:', error);
      toast.error('Deposit failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!address) {
      toast.error('Wallet not connected');
      return;
    }

    try {
      setIsProcessing(true);
      const amountInWei = parseUnits(amount, 18); // Adjust decimals based on LP token
      const txHash = await withdrawFromLiquidityPool(amountInWei.toString(), address, address);
      toast.success(`Withdrawal successful! Tx: ${txHash.slice(0, 10)}...`);
      setAmount('');
    } catch (error) {
      console.error('Withdrawal failed:', error);
      toast.error('Withdrawal failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClaimRewards = async () => {
    try {
      setIsProcessing(true);
      const txHash = await claimRewards();
      toast.success(`Rewards claimed! Tx: ${txHash.slice(0, 10)}...`);
    } catch (error) {
      console.error('Claim rewards failed:', error);
      toast.error('Failed to claim rewards');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <h2 className="text-2xl font-bold mb-4">Connect your wallet to continue</h2>
        <button
          onClick={connectWallet}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Liquidity Pools</h1>
        <p className="text-gray-400">Provide liquidity and earn rewards</p>
      </div>

      {poolInfo && <LiquidityStats poolInfo={poolInfo} />}

      <div className="mt-8 bg-gray-800 rounded-xl p-6 shadow-lg">
        <div className="flex space-x-4 border-b border-gray-700 pb-4 mb-6">
          <button
            className={`px-4 py-2 font-medium rounded-lg transition-colors ${
              activeTab === 'deposit' 
                ? 'bg-blue-600 text-white' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            onClick={() => setActiveTab('deposit')}
          >
            Deposit
          </button>
          <button
            className={`px-4 py-2 font-medium rounded-lg transition-colors ${
              activeTab === 'withdraw' 
                ? 'bg-blue-600 text-white' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            onClick={() => setActiveTab('withdraw')}
          >
            Withdraw
          </button>
        </div>

        <LiquidityActions 
          activeTab={activeTab}
          amount={amount}
          setAmount={setAmount}
          onDeposit={handleDeposit}
          onWithdraw={handleWithdraw}
          onClaimRewards={handleClaimRewards}
          isProcessing={isProcessing}
          userPosition={userPosition}
        />
      </div>

      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4 text-white">Your Positions</h2>
        <LiquidityPositions 
          userPosition={userPosition} 
          onWithdraw={handleWithdraw}
          onClaimRewards={handleClaimRewards}
        />
      </div>
    </div>
  );
};

export default LiquidityPage;
