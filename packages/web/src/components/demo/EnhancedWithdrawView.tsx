import React from 'react';
import { formatUnits } from 'viem';

interface EnhancedWithdrawViewProps {
  orderId: `0x${string}`;
  totalCollateralWei: bigint;
  unlockedWei: bigint;
  onWithdraw: () => void;
  isProcessing?: boolean;
}

const EnhancedWithdrawView: React.FC<EnhancedWithdrawViewProps> = ({
  orderId,
  totalCollateralWei,
  unlockedWei,
  onWithdraw,
  isProcessing = false
}) => {
  const totalEth = formatUnits(totalCollateralWei, 18);
  const unlockedEth = formatUnits(unlockedWei, 18);
  const lockedEth = formatUnits(totalCollateralWei - unlockedWei, 18);
  const isFullyUnlocked = unlockedWei >= totalCollateralWei;

  return (
    <div className="bg-gray-800 rounded-2xl p-6 space-y-4 animate-fade-in">
      <div>
        <h3 className="text-xl font-bold text-gray-100">Withdraw Collateral</h3>
        <p className="text-sm text-gray-400 mt-1">
          {isFullyUnlocked 
            ? 'Your order is fully repaid. You can withdraw all collateral.'
            : 'You can withdraw the unlocked portion of your collateral from partial repayments.'}
        </p>
      </div>

      <div className="bg-gray-900/50 rounded-lg p-4 space-y-4">
        {/* Collateral Breakdown */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Total Collateral</span>
            <span className="text-lg font-mono text-gray-200">{totalEth} ETH</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Available to Withdraw</span>
            <span className="text-lg font-mono text-cyan-400">{unlockedEth} ETH</span>
          </div>

          {!isFullyUnlocked && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Still Locked</span>
              <span className="text-sm font-mono text-gray-500">{lockedEth} ETH</span>
            </div>
          )}

          {/* Visual Progress Bar */}
          {!isFullyUnlocked && (
            <div className="pt-2">
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-300"
                  style={{ width: `${(Number(unlockedEth) / Number(totalEth)) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Unlocked: {unlockedEth} ETH</span>
                <span>Locked: {lockedEth} ETH</span>
              </div>
            </div>
          )}
        </div>

        {isFullyUnlocked && (
          <div className="bg-green-600/10 border border-green-500/30 rounded-lg p-3">
            <p className="text-xs text-green-300">
              ✓ All collateral is unlocked. You can withdraw the full amount.
            </p>
          </div>
        )}

        {!isFullyUnlocked && (
          <div className="bg-amber-600/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-xs text-amber-300">
              ℹ️ Only the unlocked portion can be withdrawn. Repay more debt to unlock additional collateral.
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onWithdraw}
        disabled={unlockedWei === 0n || isProcessing}
        className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:cursor-not-allowed"
      >
        {isProcessing 
          ? 'Processing...' 
          : `Withdraw ${unlockedEth} ETH`}
      </button>

      <div className="bg-gray-900/50 rounded-lg p-3">
        <p className="text-xs text-gray-500">
          <span className="font-mono text-gray-400">{orderId.slice(0, 10)}...</span>
        </p>
      </div>
    </div>
  );
};

export default EnhancedWithdrawView;

