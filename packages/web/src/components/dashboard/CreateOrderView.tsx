import React, { useState } from 'react';

export interface CollateralOrderDebugInfo {
  orderId: `0x${string}`;
  status: string;
  collateralEth: string;
  borrowedUsd?: string | null;
  unlockedEth?: string | null;
  hederaCollateralEth?: string | null;
  hederaBorrowedUsd?: string | null;
}

interface CreateOrderViewProps {
  onSubmit: (amount: string) => void;
  isBlocked?: boolean;
  blockedReason?: string | null;
  activeOrders?: CollateralOrderDebugInfo[];
  onInspectOrder?: (orderId: `0x${string}`) => void;
  collateralLabel?: string;
}

const CreateOrderView: React.FC<CreateOrderViewProps> = ({
  onSubmit,
  isBlocked = false,
  blockedReason,
  activeOrders = [],
  onInspectOrder,
  collateralLabel = 'ETH collateral',
}) => {
  const [amount, setAmount] = useState('0.001');
  const hasActiveOrders = activeOrders.length > 0;

  const handleSubmit = () => {
    if (isBlocked) return;
    onSubmit(amount);
  };

  const buildDefaultBlockedCopy = () =>
    `Only one ${collateralLabel} position can exist at a time. Use the existing position to add collateral, borrow, repay, or withdraw before opening a new one.`;

  return (
    <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-4">
      <div>
        <h3 className="text-xl font-bold">Create a new position (Ethereum collateral)</h3>
        <p className="text-gray-400">Deposit Sepolia ETH to back your position.</p>
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={amount}
          placeholder="Amount of Sepolia ETH to deposit as collateral"
          disabled={isBlocked}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-md p-3 text-center text-white disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <p className="text-[11px] text-gray-500 italic text-left">Example: 0.001</p>
        <button
          onClick={handleSubmit}
          disabled={isBlocked}
          className={`w-full text-white font-bold py-3 px-4 rounded-lg transition ${
            isBlocked
              ? 'bg-gray-700 cursor-not-allowed'
              : 'bg-cyan-600 hover:bg-cyan-700'
          }`}
        >
          {isBlocked ? 'Position Locked' : 'Create Position'}
        </button>
      </div>

      {isBlocked && (
        <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-4 text-left space-y-2">
            <p className="text-sm font-semibold text-amber-200">
              {collateralLabel} position already exists
            </p>
          <p className="text-xs text-amber-100/90 leading-relaxed">
            {blockedReason ?? buildDefaultBlockedCopy()}
          </p>
          {onInspectOrder && hasActiveOrders && (
            <button
              onClick={() => onInspectOrder(activeOrders[0].orderId)}
              className="text-xs font-semibold text-amber-200 hover:text-amber-100 underline"
            >
              Jump to the active order
            </button>
          )}
        </div>
      )}

      <div className="bg-gray-900/60 border border-gray-700 rounded-2xl p-4 text-left space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-100">Collateral Monitor</p>
            <p className="text-xs text-gray-400">{collateralLabel}</p>
          </div>
          <span className="text-xs font-mono text-gray-500">
            {hasActiveOrders ? `${activeOrders.length} live` : 'No live orders'}
          </span>
        </div>

        {hasActiveOrders ? (
          <div className="space-y-3">
            {activeOrders.map((order) => (
              <div
                key={order.orderId}
                className="bg-gray-900/40 border border-gray-700/80 rounded-xl p-3 space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-mono text-gray-400">
                  <span>{order.orderId.slice(0, 12)}...</span>
                  <span className="text-cyan-300 font-semibold">{order.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Collateral</p>
                    <p className="text-sm font-semibold text-white">{order.collateralEth} ETH</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Borrowed</p>
                    <p className="text-sm font-semibold text-cyan-200">
                      {order.borrowedUsd ? `${order.borrowedUsd} hUSD` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-500">Unlocked</p>
                    <p className="text-sm font-semibold text-emerald-200">
                      {order.unlockedEth ? `${order.unlockedEth} ETH` : '—'}
                    </p>
                  </div>
                  <div className="flex items-end justify-end">
                    {onInspectOrder && (
                      <button
                        onClick={() => onInspectOrder(order.orderId)}
                        className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                      >
                        Manage
                      </button>
                    )}
                  </div>
                </div>
                {(order.hederaCollateralEth || order.hederaBorrowedUsd) && (
                  <div className="text-[10px] text-gray-500 space-y-1">
                    {order.hederaCollateralEth && (
                      <p>
                        Hedera collateral:{' '}
                        <span className="text-gray-200 font-semibold">{order.hederaCollateralEth} ETH</span>
                      </p>
                    )}
                    {order.hederaBorrowedUsd && (
                      <p>
                        Hedera debt:{' '}
                        <span className="text-cyan-200 font-semibold">{order.hederaBorrowedUsd} hUSD</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            No active orders for this collateral. Create one to lock ETH and start borrowing.
          </p>
        )}
      </div>
    </div>
  );
};

export default CreateOrderView;
