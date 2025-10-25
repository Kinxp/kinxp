import React, { useState } from "react";
import { formatUnits } from "viem";
import { OrderStatus, UserOrderSummary } from "../types";
import { fetchOrderTransactions } from "../services/blockscoutService";
import { explainTransaction, TxExplanation } from "../services/api";
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
function explorerUrl(chainId: number, txHash: string) {
  const base = CHAIN_EXPLORERS[chainId];
  return base ? `${base}${txHash}` : undefined;
}
function toNum(x?: string) {
  const n = x ? Number(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function fmtEthStr(s?: string): string | undefined {
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 1) return n.toFixed(4).replace(/\.0+$/, "").replace(/\.([1-9]*?)0+$/, ".$1");
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

type TokenXfer = NonNullable<TxExplanation["tokenTransfers"]>[number];
type ExplainItem = {
  chainId: number;
  label: string;
  txHash: `0x${string}`;
  timestamp?: string;
  method?: string;
  from?: string;
  to?: string;
  valueEther?: string;
  tokenTransfers?: TokenXfer[];
  feeEther?: string;
  links?: string[];
};

type ExplainState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  items: ExplainItem[];
};

function oneLiner(it: ExplainItem): string {
  const l = it.label.toLowerCase();
  const method = (it.method || "").toLowerCase();
  const gas = toNum(it.feeEther);

  if (l.includes("withdrawn")) return "Withdrew collateral on Ethereum (order closed).";
  if (l.includes("liquidated")) return "Order was liquidated on Ethereum; collateral sold to cover debt.";
  if (l.includes("funded") || method.includes("fundorder")) {
    const amt = fmtEthStr(it.valueEther);
    return `Funded collateral${amt ? `: ${amt} ETH` : ""}${gas ? ` (gas ~${gas} ETH)` : ""}.`;
  }
  if (l.includes("mark repaid")) return "Repay confirmed on Ethereum; collateral unlocked.";
  if (l.includes("hedera") && l.includes("opened")) return "Order mirrored to Hedera (ready to borrow).";
  if (l.includes("hedera") && l.includes("repaid")) return "Debt repaid on Hedera.";

  const x = it.tokenTransfers?.[0];
  if (x?.symbol) return `Transferred ${x.amount} ${x.symbol}.`;
  if (it.valueEther) return `Sent ${fmtEthStr(it.valueEther)} ETH${gas ? ` (gas ~${gas} ETH)` : ""}.`;
  if (it.method) return `${it.method} executed.`;
  return "Transaction executed.";
}

function buildSummary(items: ExplainItem[]): string[] {
  const sorted = [...items].sort((a, b) => {
    const ta = a.timestamp ? Number(a.timestamp) : 0;
    const tb = b.timestamp ? Number(b.timestamp) : 0;
    return ta - tb;
  });

  const out: string[] = [];
  let funded = false, opened = false, repaidHedera = false, unlockedEth = false, withdrawn = false, liquidated = false;

  for (const it of sorted) {
    const l = it.label.toLowerCase();
    if (!funded && l.includes("funded")) {
      funded = true;
      const amt = fmtEthStr(it.valueEther);
      out.push(`You funded the order on Ethereum${amt ? ` with ${amt} ETH` : ""}.`);
    }
    if (!opened && l.includes("hedera") && l.includes("opened")) out.push("The order was mirrored to Hedera (bridge complete)."), opened = true;
    if (!repaidHedera && l.includes("hedera") && l.includes("repaid")) out.push("You repaid your debt on Hedera."), repaidHedera = true;
    if (!unlockedEth && l.includes("mark repaid")) out.push("Ethereum marked the order repaid and unlocked your collateral."), unlockedEth = true;
    if (!withdrawn && l.includes("withdrawn")) out.push("You withdrew your ETH on Ethereum (order closed)."), withdrawn = true;
    if (!liquidated && l.includes("liquidated")) out.push("The position was liquidated on Ethereum (order closed)."), liquidated = true;
  }

  if (out.length === 0) out.push("We found related activity for this order on the explorer.");
  return out;
}

const OrderList: React.FC<OrderListProps> = ({ orders, isLoading, error, onRefresh }) => {
  const [explainState, setExplainState] = useState<Record<string, ExplainState>>({});

  const handleExplain = async (orderId: `0x${string}`) => {
    const current = explainState[orderId];

    if (current?.open && !current.loading) {
      setExplainState(prev => ({ ...prev, [orderId]: { ...prev[orderId], open: false } }));
      return;
    }

    // Keep panel closed while loading
    setExplainState(prev => ({
      ...prev,
      [orderId]: { open: false, loading: true, error: null, items: prev[orderId]?.items ?? [] },
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

      const ethTxs = txs.filter(tx => tx.chainId === ETH_CHAIN_ID);
      const otherTxs = txs.filter(tx => tx.chainId !== ETH_CHAIN_ID);

      const explainedEth = await Promise.all(
        ethTxs.map(async tx => {
          try {
            const ex = await explainTransaction(tx.chainId, tx.txHash);
            return { ...tx, ...ex } as ExplainItem;
          } catch {
            return { ...tx } as ExplainItem;
          }
        })
      );

      const items: ExplainItem[] = [...explainedEth, ...otherTxs];
      setExplainState(prev => ({
        ...prev,
        [orderId]: { open: true, loading: false, error: null, items },
      }));
    } catch (err: any) {
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
                      {explain?.loading ? "Analyzing…" : (explain?.open ? "Hide Explain" : "Explain")}
                    </button>
                  </div>
                </div>

                {/* Show panel ONLY when finished */}
                {explain?.open && !explain.loading && (
                  <div className="text-xs space-y-3 bg-gray-800/60 border border-gray-700/50 rounded-lg px-3 py-3">
                    {explain.error && <p className="text-red-300">{explain.error}</p>}
                    {!explain.error && (
                      <>
                        {/* Transactions */}
                        <div className="space-y-2">
                          <p className="text-gray-300 font-semibold">Transactions</p>
                          {[...explain.items]
                            .sort((a, b) => {
                              const ta = a.timestamp ? Number(a.timestamp) : 0;
                              const tb = b.timestamp ? Number(b.timestamp) : 0;
                              return ta - tb;
                            })
                            .map(item => {
                              const url = explorerUrl(item.chainId, item.txHash);
                              const chainLabel =
                                item.chainId === ETH_CHAIN_ID ? "Ethereum · Sepolia"
                                : item.chainId === HEDERA_CHAIN_ID ? "Hedera · Testnet"
                                : `Chain ${item.chainId}`;

                              return (
                                <div key={item.txHash} className="space-y-1 border border-gray-700/40 rounded-md px-3 py-2">
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                                    <span className="font-semibold text-gray-100">{item.label}</span>
                                    <div className="flex items-center gap-2 text-gray-400">
                                      <span>{chainLabel}</span>
                                      {url && (
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-indigo-300 hover:text-indigo-200"
                                        >
                                          View Tx
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-gray-200">{oneLiner(item)}</p>
                                </div>
                              );
                            })}
                        </div>

                        {/* Summary */}
                        <div className="border-t border-gray-700/50 my-2" />
                        <div className="space-y-1">
                          <p className="text-gray-300 font-semibold">Summary</p>
                          <ul className="list-disc list-inside space-y-1 text-gray-200">
                            {buildSummary(explain.items).map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>

                        {/* No "Links" section */}
                      </>
                    )}
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
