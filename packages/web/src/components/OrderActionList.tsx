import React, { useState } from 'react';
import { formatUnits } from 'viem';
import { AppState, OrderStatus, UserOrderSummary } from '../types';
import { useAppContext } from '../context/AppContext';

// We assume these services and configs exist
import { fetchOrderTransactions } from "../services/blockscoutService";
import { explainTransaction } from "../services/api";
import { CHAIN_EXPLORERS, ETH_CHAIN_ID, HEDERA_CHAIN_ID } from "../config";

// --- Props ---
interface OrderActionListProps {
  title: string;
  orders: UserOrderSummary[];
  selectedOrderId: `0x${string}` | null;
  onSelectOrder: (orderId: `0x${string}`) => void;
  actionText: string;
}

// --- Types and constants ---
interface ExplainItem {
  chainId: number;
  label: string;
  txHash: `0x${string}`;
  summary?: string;
  aiAnalysis?: string;
  explanation?: string;
  timestamp?: string;
}

interface ExplainState {
  open: boolean;
  loading: boolean;
  error: string | null;
  items: ExplainItem[];
}

// ========== MODIFICATION START ==========
// A set of all states that represent a pending on-chain or cross-chain action.
// During these states, user actions on the list should be disabled.
const BUSY_STATES = new Set([
  AppState.ORDER_CREATING,
  AppState.FUNDING_IN_PROGRESS,
  AppState.BORROWING_IN_PROGRESS,
  AppState.RETURNING_FUNDS,
  AppState.REPAYING_IN_PROGRESS,
  AppState.WITHDRAWING_IN_PROGRESS,
  AppState.CROSSING_TO_HEDERA,
  AppState.CROSSING_TO_ETHEREUM,
]);
// ========== MODIFICATION END ==========


const statusStyles: Record<OrderStatus, string> = {
  Created: "bg-gray-700/40 text-gray-200 border-gray-600/60",
  Funded: "bg-blue-600/20 text-blue-300 border-blue-500/30",
  ReadyToWithdraw: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  Withdrawn: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
  Liquidated: "bg-red-700/20 text-red-300 border-red-500/40",
};

// --- Helper functions ---
function formatEth(amountWei: bigint): string {
  if (amountWei === 0n) return "0";
  const eth = parseFloat(formatUnits(amountWei, 18));
  if (Number.isNaN(eth)) return "0";
  if (eth >= 1) return eth.toFixed(4).replace(/\.0+$/, "").replace(/\.([1-9]*?)0+$/, ".$1");
  return eth.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function shorten(id: string, chars = 6): string {
  if (id.length <= chars * 2) return id;
  return `${id.slice(0, chars + 2)}…${id.slice(-chars)}`;
}

const OrderActionList: React.FC<OrderActionListProps> = ({ title, orders, selectedOrderId, onSelectOrder, actionText }) => {
  const [explainState, setExplainState] = useState<Record<string, ExplainState>>({});
  
  // Get the global app state from the context
  const { appState } = useAppContext();

  // ========== MODIFICATION START ==========
  // Check if the current app state is one of the busy states.
  const isAppBusy = BUSY_STATES.has(appState);
  // ========== MODIFICATION END ==========

  const handleExplain = async (orderId: `0x${string}`) => {
    // ... (rest of the handleExplain function is unchanged)
    const current = explainState[orderId];
    if (current?.open && !current.loading) {
      setExplainState(prev => ({ ...prev, [orderId]: { ...prev[orderId], open: false } }));
      return;
    }

    setExplainState(prev => ({ ...prev, [orderId]: { open: true, loading: true, error: null, items: prev[orderId]?.items ?? [] } }));

    try {
      const txs = await fetchOrderTransactions(orderId);
      if (!txs.length) {
          setExplainState(prev => ({ ...prev, [orderId]: { ...prev[orderId], loading: false, items: [] } }));
          return;
      }

      const supportedTxs = txs.filter(tx => tx.chainId === ETH_CHAIN_ID);
      const unsupportedTxs = txs.filter(tx => tx.chainId !== ETH_CHAIN_ID);

      const supportedExplanations = await Promise.all(
        supportedTxs.map(async tx => {
          try {
            const explanation = await explainTransaction(tx.chainId, tx.txHash);
            return { ...tx, ...explanation } as ExplainItem;
          } catch (err: any) {
            return { ...tx, explanation: err?.message ?? "Unable to generate explanation." } as ExplainItem;
          }
        })
      );
      
      const placeholderExplanations = unsupportedTxs.map(tx => ({ ...tx, explanation: "AI explanations for Hedera are not yet available." } as ExplainItem));

      setExplainState(prev => ({ ...prev, [orderId]: { open: true, loading: false, error: null, items: [...supportedExplanations, ...placeholderExplanations] } }));
    } catch (err: any) {
      setExplainState(prev => ({ ...prev, [orderId]: { open: true, loading: false, error: err?.message ?? "Could not fetch transactions.", items: [] } }));
    }
  };

  if (orders.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <h3 className="text-md font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="space-y-3">
        {orders.map(order => {
          const explain = explainState[order.orderId];
          const isSelected = selectedOrderId === order.orderId;

          return (
            <div key={order.orderId} className={`bg-gray-900/60 border rounded-xl px-4 py-3 space-y-3 transition-all ${isSelected ? 'border-cyan-500 ring-2 ring-cyan-500/50' : 'border-gray-700/40'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-gray-200">{shorten(order.orderId)}</p>
                  <p className="text-xs text-gray-400">{formatEth(order.amountWei)} ETH</p>
                </div>
                <div>
                  <span className={`inline-block text-xs font-medium px-3 py-1 rounded-full border ${statusStyles[order.status]}`}>
                    {order.status.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExplain(order.orderId)}
                    // ========== MODIFICATION START ==========
                    disabled={explain?.loading || isAppBusy}
                    // ========== MODIFICATION END ==========
                    className="text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400 text-gray-100 px-3 py-1.5 rounded-md transition-colors"
                  >
                    {explain?.loading ? "Analyzing..." : (explain?.open ? "Hide Explain" : "✦ Explain")}
                  </button>
                  <button
                    onClick={() => onSelectOrder(order.orderId)}
                    // ========== MODIFICATION START ==========
                    disabled={isAppBusy}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-sm py-1.5 px-3 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    // ========== MODIFICATION END ==========
                  >
                    {actionText}
                  </button>
                </div>
              </div>

              {/* ... (rest of the JSX is unchanged) ... */}
              {explain?.open && !explain.loading && (
                <div className="text-xs space-y-2 bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-3">
                  {explain.error && <p className="text-red-300">{explain.error}</p>}
                  {explain.items.length === 0 && !explain.error && <p className="text-gray-400">No related transactions found for this order yet.</p>}
                  {explain.items.map(item => {
                    const explorerUrl = CHAIN_EXPLORERS[item.chainId] ? `${CHAIN_EXPLORERS[item.chainId]}${item.txHash}` : undefined;
                    const chainLabel = item.chainId === ETH_CHAIN_ID ? "Sepolia" : "Hedera";
                    const narrative = item.aiAnalysis ?? item.summary ?? item.explanation;

                    return (
                      <div key={item.txHash} className="space-y-1 border border-gray-700/40 rounded-md px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-100">{item.label}</span>
                          <div className="flex items-center gap-2 text-gray-400">
                            <span>{chainLabel}</span>
                            {explorerUrl && <a href={explorerUrl} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200">View Tx</a>}
                          </div>
                        </div>
                        {narrative && <p className="text-indigo-200">✦ AI: <span className="text-gray-300 italic">{narrative}</span></p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderActionList;