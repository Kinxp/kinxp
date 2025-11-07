import React, { useState } from 'react';
import { UserOrderSummary } from '../../types';
import { formatUnits } from 'viem';

import { fetchOrderTransactions } from "../../services/blockscoutService";
import { explainTransaction, TxExplanation } from "../../services/api";
import { CHAIN_EXPLORERS, ETH_CHAIN_ID, HEDERA_CHAIN_ID } from "../../config";

// ---------- helpers ----------
function formatEthFromWei(amountWei: bigint) {
  if (!amountWei) return '0';
  const eth = parseFloat(formatUnits(amountWei, 18));
  if (Number.isNaN(eth)) return '0';
  const s = (eth >= 1 ? eth.toFixed(4) : eth.toFixed(6))
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  return s === '' ? '0' : s;
}
function shorten(id: string) {
  if (!id) return '';
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
}
function statusClass(s: UserOrderSummary['status']) {
  switch (s) {
    case "Created": return "bg-gray-700/40 text-gray-200 border-gray-600/60";
    case "Funded": return "bg-blue-600/20 text-blue-300 border-blue-500/30";
    case "ReadyToWithdraw": return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "Withdrawn": return "bg-emerald-600/20 text-emerald-300 border-emerald-500/30";
    case "Liquidated": return "bg-red-700/20 text-red-300 border-red-500/40";
    case "Borrowed": return "bg-indigo-600/20 text-indigo-300 border-indigo-500/30";
    default: return "bg-gray-700/40 text-gray-200 border-gray-600/60";
  }
}
function n(x?: string) {
  const v = x ? Number(x) : NaN;
  return Number.isFinite(v) ? v : undefined;
}
function nonZero(v?: string) {
  const val = n(v);
  return val !== undefined && Math.abs(val) > 0 ? v : undefined;
}
type TokenXfer = NonNullable<TxExplanation["tokenTransfers"]>[number];

// pick the first non-zero ETH-looking amount among multiple sources
function pickEthAmount(it: ExplainItem): string | undefined {
  const fromToken = it.tokenTransfers?.find(
    t => typeof t?.symbol === 'string' && t.symbol.toUpperCase() === 'ETH'
  )?.amount;

  const candidates = [
    it.orderCollateralEth,     // from order summary (may be 0 for closed orders)
    it.valueEther,             // tx.value from MCP (deterministic)
    fromToken                  // ERC20-style ETH (rare)
  ];

  for (const c of candidates) {
    const nz = nonZero(c);
    if (nz) return trimTo8(nz);
  }
  return undefined;
}
function trimTo8(v: string) {
  if (!v.includes('.')) return v;
  const [wh, fr] = v.split('.');
  const t = fr.slice(0, 8).replace(/0+$/, '');
  return t ? `${wh}.${t}` : wh;
}
function chainLabelFromId(chainId: number) {
  if (chainId === ETH_CHAIN_ID) return "Ethereum · Sepolia";
  if (chainId === HEDERA_CHAIN_ID) return "Hedera · Testnet";
  return `Chain ${chainId}`;
}

// ---------- types ----------
type ExplainItem = {
  chainId: number;
  label: string;
  txHash: `0x${string}`;
  timestamp?: string;
  method?: string;
  from?: string;
  to?: string;
  valueEther?: string;          // from server (MCP deterministic)
  tokenTransfers?: TokenXfer[]; // from server (decoded logs)
  feeEther?: string;            // from server (gasUsed * gasPrice)
  orderCollateralEth?: string;  // from UI order list (may be 0 for closed orders)
};
type ExplainState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  items: ExplainItem[];
};

// ---------- narrative builders ----------
function oneLiner(it: ExplainItem): string {
  const l = it.label.toLowerCase();
  const gas = n(it.feeEther);
  const fundedAmt = pickEthAmount(it);

  if (l.includes("withdrawn")) return "Withdrew collateral on Ethereum (order closed).";
  if (l.includes("liquidated")) return "Order was liquidated on Ethereum; collateral sold to cover debt.";
  if (l.includes("funded")) {
    const gasNote = gas ? ` (gas ~${trimTo8(String(gas))} ETH)` : "";
    return `Funded collateral${fundedAmt ? `: ${fundedAmt} ETH` : ""}${gasNote}.`;
  }
  if (l.includes("mark repaid")) return "Repay confirmed on Ethereum; collateral unlocked.";
  if (l.includes("hedera") && l.includes("opened")) return "Order mirrored to Hedera (ready to borrow).";
  if (l.includes("hedera") && l.includes("repaid")) return "Debt repaid on Hedera.";

  const x = it.tokenTransfers?.[0];
  if (x?.symbol) return `Transferred ${trimTo8(x.amount)} ${x.symbol}.`;
  if (it.valueEther) return `Sent ${trimTo8(it.valueEther)} ETH${gas ? ` (gas ~${trimTo8(String(gas))} ETH)` : ""}.`;
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
      const amt = pickEthAmount(it);
      out.push(`You funded the order on Ethereum${amt ? ` with ${amt} ETH` : ""}.`);
    }
    if (!opened && l.includes("hedera") && l.includes("opened")) {
      opened = true;
      out.push("The order was mirrored to Hedera (bridge complete).");
    }
    if (!repaidHedera && l.includes("hedera") && l.includes("repaid")) {
      repaidHedera = true;
      out.push("You repaid your debt on Hedera.");
    }
    if (!unlockedEth && l.includes("mark repaid")) {
      unlockedEth = true;
      out.push("Ethereum marked the order repaid and unlocked your collateral.");
    }
    if (!withdrawn && l.includes("withdrawn")) {
      withdrawn = true;
      out.push("You withdrew your ETH on Ethereum (order closed).");
    }
    if (!liquidated && l.includes("liquidated")) {
      liquidated = true;
      out.push("The position was liquidated on Ethereum (order closed).");
    }
  }

  if (out.length === 0) out.push("We found related activity for this order on the explorer.");
  return out;
}

// ---------- component ----------
interface OrderInfoListProps {
  title: string;
  orders: UserOrderSummary[];
}

const OrderInfoList: React.FC<OrderInfoListProps> = ({ title, orders }) => {
  const [explainState, setExplainState] = useState<Record<string, ExplainState>>({});

  if (orders.length === 0) return null;

  const handleExplain = async (orderId: `0x${string}`) => {
    const current = explainState[orderId];

    // toggle close if already open and idle
    if (current?.open && !current.loading) {
      setExplainState(prev => ({ ...prev, [orderId]: { ...prev[orderId], open: false } }));
      return;
    }

    // attach the order's known collateral (may be 0 on closed orders)
    const order = orders.find(o => o.orderId === orderId);
    const orderCollateralEth = order ? formatEthFromWei(order.amountWei) : undefined;

    // open & start loading; DO NOT render stale items while loading
    setExplainState(prev => ({
      ...prev,
      [orderId]: { open: true, loading: true, error: null, items: [] },
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
            return { ...tx, ...ex, orderCollateralEth } as ExplainItem;
          } catch {
            // even if explain fails, still attach orderCollateralEth for fallback
            return { ...tx, orderCollateralEth } as ExplainItem;
          }
        })
      );

      // pass-through for other chains (no placeholders)
      const passthrough = otherTxs.map(tx => ({ ...tx, orderCollateralEth }) as ExplainItem);

      const items: ExplainItem[] = [...explainedEth, ...passthrough];
      setExplainState(prev => ({
        ...prev,
        [orderId]: { open: true, loading: false, error: null, items }
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
            <div key={order.orderId} className="bg-gray-900/70 border border-gray-700/60 rounded-lg p-3 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-gray-400">{shorten(order.orderId)}</p>
                  <p className="text-xs text-gray-500">{formatEthFromWei(order.amountWei)} ETH</p>
                </div>

                <span className={`text-xs font-medium px-3 py-1 rounded-full border ${statusClass(order.status)}`}>
                  {order.status}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExplain(order.orderId)}
                    disabled={!!explain?.loading}
                    className="text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-400 text-gray-100 px-3 py-1.5 rounded-md transition-colors"
                  >
                    {explain?.loading ? "Analyzing..." : (explain?.open ? "Hide Explain" : "Explain")}
                  </button>
                </div>
              </div>

              {/* Show NOTHING until analysis completes */}
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
                            const base = CHAIN_EXPLORERS[item.chainId];
                            const url = base ? `${base}${item.txHash}` : undefined;

                            return (
                              <div key={item.txHash} className="space-y-1 border border-gray-700/40 rounded-md px-3 py-2">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                                  <span className="font-semibold text-gray-100">{item.label}</span>
                                  <div className="flex items-center gap-2 text-gray-400">
                                    <span>{chainLabelFromId(item.chainId)}</span>
                                    {url && (
                                      <a href={url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200">
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
                      {/* No links section by design */}
                    </>
                  )}
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
