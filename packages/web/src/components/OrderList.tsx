import React, { useState } from "react";
import { formatUnits } from "viem";
import { OrderStatus, UserOrderSummary } from "../types";
import { fetchOrderTransactions } from "../services/blockscoutService";
import { explainTransaction } from "../services/api";
import { CHAIN_EXPLORERS, ETH_CHAIN_ID, HEDERA_CHAIN_ID } from "../config";

interface OrderListProps {
  orders: UserOrderSummary[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const statusStyles: Record<OrderStatus, string> = {
  Created: "bg-gray-700/40 text-gray-200 border-gray-600/60",
  Funded: "bg-blue-600/20 text-blue-300 border-blue-500/30",
  ReadyToWithdraw: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  Withdrawn: "bg-emerald-600/20 text-emerald-300 border-emerald-500/30",
  Liquidated: "bg-red-700/20 text-red-300 border-red-500/40",
};

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

const OrderList: React.FC<OrderListProps> = ({ orders, isLoading, error, onRefresh }) => {
  const [explainState, setExplainState] = useState<Record<string, ExplainState>>({});

  const handleExplain = async (orderId: `0x${string}`) => {
    const current = explainState[orderId];

    if (current && current.open && !current.loading) {
      setExplainState(prev => ({ ...prev, [orderId]: { ...prev[orderId], open: false } }));
      return;
    }

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
            console.error(`Failed to explain ${tx.txHash}`, err);
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
        explanation: "Hedera explanations are temporarily unavailable; mirroring Ethereum activity instead.",
      } as ExplainItem));

      const explanations = [...supportedExplanations, ...placeholderExplanations];
      setExplainState(prev => ({
        ...prev,
        [orderId]: { open: true, loading: false, error: null, items: explanations },
      }));
    } catch (err: any) {
      console.error("Failed to fetch order transactions", err);
      setExplainState(prev => ({
        ...prev,
        [orderId]: { open: true, loading: false, error: err?.message ?? "Could not fetch transactions.", items: [] },
      }));
    }
  };

  return (
    <section className="bg-gray-800/70 border border-gray-700/50 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-100">Your Orders</h3>
        <button
          onClick={onRefresh}
          className="text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {orders.length === 0 && !isLoading ? (
        <p className="text-sm text-gray-400">
          No orders found for this wallet yet. Open a position to see it listed here.
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map(order => {
            const explain = explainState[order.orderId];
            return (
              <div key={order.orderId} className="bg-gray-900/60 border border-gray-700/40 rounded-xl px-4 py-3 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Order ID</p>
                    <p className="font-mono text-sm text-gray-200">{shorten(order.orderId)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Collateral</p>
                    <p className="text-sm text-gray-100">{formatEth(order.amountWei)} ETH</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
                    <span className={`inline-block text-xs font-medium px-3 py-1 rounded-full border ${statusStyles[order.status]}`}>
                      {order.status.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                  </div>
                  <div className="flex flex-col items-start gap-2">
                    <button
                      onClick={() => handleExplain(order.orderId)}
                      disabled={explain?.loading}
                      className="text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400 text-gray-100 px-3 py-1.5 rounded-md transition-colors"
                    >
                      {explain?.open ? "Hide Explain" : "✦ Explain Tx"}
                    </button>
                    {explain?.loading && <span className="text-xs text-gray-400">Analyzing…</span>}
                  </div>
                </div>

                {explain?.open && (
                  <div className="text-xs space-y-2 bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-3">
                    {explain.error && <p className="text-red-300">{explain.error}</p>}
                    {!explain.loading && !explain.error && explain.items.length === 0 && (
                      <p className="text-gray-400">No related transactions found yet. Try again soon.</p>
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
                          {item.summary && <p className="text-gray-200">{item.summary}</p>}
                          {item.aiAnalysis && <p className="text-gray-400 italic">{item.aiAnalysis}</p>}
                          {item.explanation && item.explanation !== item.aiAnalysis && (
                            <p className="text-gray-400 italic">{item.explanation}</p>
                          )}
                          {(() => {
                            const narrative = item.aiAnalysis ?? item.summary ?? item.explanation;
                            return narrative ? (
                              <p className="text-indigo-200 text-xs">
                                ✦ Ollama AI: {narrative}
                              </p>
                            ) : null;
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default OrderList;
