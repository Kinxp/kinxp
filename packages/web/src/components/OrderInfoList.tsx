import React, { useState } from 'react';
import { UserOrderSummary } from '../types';
import { formatUnits } from 'viem';

// NEW: bring in the same services/config used by the other lists
import { fetchOrderTransactions } from "../services/blockscoutService";
import { explainTransaction } from "../services/api";
import { CHAIN_EXPLORERS, ETH_CHAIN_ID, HEDERA_CHAIN_ID } from "../config";

interface OrderInfoListProps {
  title: string;
  orders: UserOrderSummary[];
}

// --- Helpers ---
function formatEth(amountWei: bigint) {
  if (!amountWei) return '0';
  const eth = parseFloat(formatUnits(amountWei, 18));
  return eth >= 1 ? eth.toFixed(4) : eth.toFixed(6);
}

function shorten(id: string) {
  if (!id) return '';
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
}

// --- Types used for Explain panel (aligned with other lists) ---
type ExplainItem = {
  chainId: number;
  label: string;
  txHash: `0x${string}`;
  summary?: string;
  aiAnalysis?: string;
  explanation?: string;
  timestamp?: string;
};

type ExplainState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  items: ExplainItem[];
};

const statusStyles: Record<UserOrderSummary['status'], string> = {
  Created: "bg-gray-700/40 text-gray-200 border-gray-600/60",
  Funded: "bg-blue-600/20 text-blue-300 border-blue-500/30",
  ReadyToWithdraw: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  Withdrawn: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
  Liquidated: "bg-red-700/20 text-red-300 border-red-500/40",
  Borrowed: "bg-indigo-600/20 text-indigo-300 border-indigo-500/30",
};

const OrderInfoList: React.FC<OrderInfoListProps> = ({ title, orders }) => {
  const [explainState, setExplainState] = useState<Record<string, ExplainState>>({});

  if (orders.length === 0) {
    return null;
  }

  // Toggle + fetch explain data per order (same behavior as other lists)
  const handleExplain = async (orderId: `0x${string}`) => {
    const current = explainState[orderId];

    // simple toggle to close
    if (current?.open && !current.loading) {
      setExplainState(prev => ({ ...prev, [orderId]: { ...prev[orderId], open: false } }));
      return;
    }

    // open + start loading
    setExplainState(prev => ({
      ...prev,
      [orderId]: { open: true, loading: true, error: null, items: prev[orderId]?.items ?? [] },
    }));

    try {
      const txs = await fetchOrderTransactions(orderId);

      if (!txs.length) {
        setExplainState(prev => ({
          ...prev,
          [orderId]: { open: true, loading: false, error: null, items: [] },
        }));
        return;
      }

      const supportedTxs = txs.filter(tx => tx.chainId === ETH_CHAIN_ID);
      const unsupportedTxs = txs.filter(tx => tx.chainId !== ETH_CHAIN_ID);

      const supportedExplanations = await Promise.all(
        supportedTxs.map(async tx => {
          try {
            const explanation = await explainTransaction(tx.chainId, tx.txHash);
            return {
              chainId: tx.chainId,
              label: tx.label,
              txHash: tx.txHash,
              timestamp: tx.timestamp,
              summary: explanation.summary,
              aiAnalysis: explanation.aiAnalysis,
              explanation: explanation.explanation,
            } as ExplainItem;
          } catch (err: any) {
            return {
              chainId: tx.chainId,
              label: tx.label,
              txHash: tx.txHash,
              timestamp: tx.timestamp,
              explanation: err?.message ?? "Unable to generate explanation.",
            } as ExplainItem;
          }
        })
      );

      const placeholderExplanations = unsupportedTxs.map(tx => ({
        chainId: tx.chainId,
        label: tx.label,
        txHash: tx.txHash,
        timestamp: tx.timestamp,
        explanation:
          tx.chainId === HEDERA_CHAIN_ID
            ? "Hedera explanations are temporarily unavailable; mirroring Ethereum activity instead."
            : "AI explanations are not available for this chain yet.",
      } as ExplainItem));

      setExplainState(prev => ({
        ...prev,
        [orderId]: {
          open: true,
          loading: false,
          error: null,
          items: [...supportedExplanations, ...placeholderExplanations],
        },
      }));
    } catch (err: any) {
      setExplainState(prev => ({
        ...prev,
        [orderId]: { open: true, loading: false, error: err?.message ?? "Could not fetch transactions.", items: [] },
      }));
    }
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <h3 className="text-md font-semibold text-gray-300 mb-3">{title}</h3>
      <div className="space-y-2">
        {orders.map(order => {
          const explain = explainState[order.orderId];

          return (
            <div
              key={order.orderId}
              className="bg-gray-900/70 border border-gray-700/60 rounded-lg p-3 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-gray-400">{shorten(order.orderId)}</p>
                  <p className="text-xs text-gray-500">{formatEth(order.amountWei)} ETH</p>
                </div>

                <span className={`text-xs font-medium px-3 py-1 rounded-full border ${statusStyles[order.status]}`}>
                  {order.status}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExplain(order.orderId)}
                    disabled={explain?.loading}
                    className="text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400 text-gray-100 px-3 py-1.5 rounded-md transition-colors"
                  >
                    {explain?.loading ? "Analyzing..." : (explain?.open ? "Hide Explain" : "✦ Explain")}
                  </button>
                </div>
              </div>

              {explain?.open && (
                <div className="text-xs space-y-2 bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-3">
                  {explain.error && <p className="text-red-300">{explain.error}</p>}
                  {!explain.loading && !explain.error && explain.items.length === 0 && (
                    <p className="text-gray-400">No related transactions found for this order.</p>
                  )}
                  {explain.items.map(item => {
                    const explorerBase = CHAIN_EXPLORERS[item.chainId];
                    const explorerUrl = explorerBase ? `${explorerBase}${item.txHash}` : undefined;
                    const chainLabel =
                      item.chainId === ETH_CHAIN_ID
                        ? "Ethereum · Sepolia"
                        : item.chainId === HEDERA_CHAIN_ID
                        ? "Hedera · Testnet"
                        : `Chain ${item.chainId}`;

                    const narrative = item.aiAnalysis ?? item.summary ?? item.explanation;

                    return (
                      <div key={`${item.txHash}-${item.label}`} className="space-y-1 border border-gray-700/40 rounded-md px-3 py-2">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <span className="font-semibold text-gray-100">{item.label}</span>
                          <div className="flex items-center gap-2 text-gray-400">
                            <span>{chainLabel}</span>
                            {explorerUrl && (
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-300 hover:text-indigo-200"
                              >
                                View Tx
                              </a>
                            )}
                          </div>
                        </div>
                        {narrative && <p className="text-indigo-200">✦ Ollama AI: <span className="italic text-gray-300">{narrative}</span></p>}
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

export default OrderInfoList;
