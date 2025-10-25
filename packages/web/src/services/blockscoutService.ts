import { multicall } from 'wagmi/actions';
import { pad } from 'viem';
import { config as wagmiConfig } from '../wagmi';
import { UserOrderSummary, OrderStatus } from '../types';

import {
  ETH_CHAIN_ID,
  HEDERA_CHAIN_ID,
  ETH_COLLATERAL_ABI,
  ETH_COLLATERAL_OAPP_ADDR,
  SEPOLIA_BLOCKSCOUT_API_URL,
  MARK_REPAID_TOPIC,
  ORDER_CREATED_TOPIC,
  HEDERA_BLOCKSCOUT_API_URL,
  HEDERA_CREDIT_OAPP_ADDR,
  HEDERA_ORDER_OPENED_TOPIC,
  ORDER_FUNDED_TOPIC,
  HEDERA_REPAID_TOPIC,
} from '../config';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function determineStatus(order: { funded: boolean; repaid: boolean; liquidated: boolean }): OrderStatus {
  if (order.liquidated) return 'Liquidated';
  if (order.repaid && !order.funded) return 'Withdrawn';
  if (order.repaid && order.funded) return 'ReadyToWithdraw';
  if (order.funded) return 'Funded';
  return 'Created';
}

async function fetchBlockscoutLogs(baseUrl: string, params: Record<string, string>): Promise<any[]> {
  const query = new URLSearchParams(params).toString();
  const url = `${baseUrl}?${query}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Blockscout request failed (${response.status}): ${response.statusText}`);
  }
  const data = await response.json();
  if (data.message !== 'OK' || !Array.isArray(data.result)) {
    return [];
  }
  return data.result;
}

async function fetchOrderIdsForUser(userAddress: `0x${string}`): Promise<`0x${string}`[]> {
  const logs = await fetchBlockscoutLogs(SEPOLIA_BLOCKSCOUT_API_URL, {
    module: 'logs',
    action: 'getLogs',
    address: ETH_COLLATERAL_OAPP_ADDR,
    topic0: ORDER_CREATED_TOPIC,
    topic2: pad(userAddress, { size: 32 }),
    topic0_2_opr: 'and',
    fromBlock: '0',
    toBlock: 'latest',
  });

  const orderIds: `0x${string}`[] = [];
  const seen = new Set<string>();

  for (const log of logs) {
    const raw = log?.topics?.[1];
    if (typeof raw !== 'string') continue;
    const normalized = raw.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    orderIds.push(raw as `0x${string}`);
  }

  return orderIds;
}

async function loadOrderSummaries(orderIds: `0x${string}`[]): Promise<UserOrderSummary[]> {
  if (orderIds.length === 0) return [];

  const contracts = orderIds.map(orderId => ({
    address: ETH_COLLATERAL_OAPP_ADDR,
    abi: ETH_COLLATERAL_ABI,
    functionName: 'orders',
    args: [orderId],
  }));

  const results = await multicall(wagmiConfig, {
    chainId: ETH_CHAIN_ID,
    contracts,
    allowFailure: true,
  });

  const summaries: UserOrderSummary[] = [];

  results.forEach((callResult, index) => {
    if (callResult.status !== 'success' || !callResult.result) return;

    const [owner, amountWei, funded, repaid, liquidated] = callResult.result as unknown as [
      `0x${string}`,
      bigint,
      boolean,
      boolean,
      boolean
    ];

    if (!owner || owner.toLowerCase() === ZERO_ADDRESS) return;

    summaries.push({
      orderId: orderIds[index],
      amountWei,
      status: determineStatus({ funded, repaid, liquidated }),
    });
  });

  return summaries;
}

export async function fetchAllUserOrders(userAddress: `0x${string}`): Promise<UserOrderSummary[]> {
  const orderIds = await fetchOrderIdsForUser(userAddress);
  if (orderIds.length === 0) return [];
  return loadOrderSummaries(orderIds);
}

export interface OrderTransactionInfo {
  chainId: number;
  label: string;
  txHash: `0x${string}`;
  timestamp?: string;
}

export async function fetchOrderTransactions(orderId: `0x${string}`): Promise<OrderTransactionInfo[]> {
  const queries = [
    {
      chainId: ETH_CHAIN_ID,
      label: 'Ethereum (Sepolia) - Order Funded',
      baseUrl: SEPOLIA_BLOCKSCOUT_API_URL,
      address: ETH_COLLATERAL_OAPP_ADDR,
      topic0: ORDER_FUNDED_TOPIC,
      extraParams: { topic1: orderId, topic0_1_opr: 'and' },
    },
    {
      chainId: ETH_CHAIN_ID,
      label: 'Ethereum (Sepolia) - Mark Repaid',
      baseUrl: SEPOLIA_BLOCKSCOUT_API_URL,
      address: ETH_COLLATERAL_OAPP_ADDR,
      topic0: MARK_REPAID_TOPIC,
      extraParams: { topic1: orderId, topic0_1_opr: 'and' },
    },
    {
      chainId: HEDERA_CHAIN_ID,
      label: 'Hedera Testnet - Order Opened',
      baseUrl: HEDERA_BLOCKSCOUT_API_URL,
      address: HEDERA_CREDIT_OAPP_ADDR,
      topic0: HEDERA_ORDER_OPENED_TOPIC,
      extraParams: { topic1: orderId, topic0_1_opr: 'and' },
    },
    {
      chainId: HEDERA_CHAIN_ID,
      label: 'Hedera Testnet - Repaid',
      baseUrl: HEDERA_BLOCKSCOUT_API_URL,
      address: HEDERA_CREDIT_OAPP_ADDR,
      topic0: HEDERA_REPAID_TOPIC,
      extraParams: { topic1: orderId, topic0_1_opr: 'and' },
    },
  ];

  const collected: OrderTransactionInfo[] = [];
  let hederaLogsFound = false;
  let hederaError = false;

  for (const query of queries) {
    const params: Record<string, string> = {
      module: 'logs',
      action: 'getLogs',
      address: query.address,
      topic0: query.topic0,
      fromBlock: '0',
      toBlock: 'latest',
      ...query.extraParams,
    };

    try {
      const logs = await fetchBlockscoutLogs(query.baseUrl, params);
      if (!logs.length) continue;

      if (query.chainId === HEDERA_CHAIN_ID) {
        hederaLogsFound = true;
      }

      for (const log of logs) {
        const txHash =
          log.transactionHash ||
          log.transaction_hash ||
          log.tx_hash ||
          log.hash;
        if (!txHash) continue;

        collected.push({
          chainId: query.chainId,
          label: query.label,
          txHash: txHash as `0x${string}`,
          timestamp: log.timeStamp || log.timestamp,
        });
      }
    } catch (error) {
      if (query.chainId === HEDERA_CHAIN_ID) {
        hederaError = true;
        console.warn('Hedera explain unavailable via Blockscout', error);
      } else {
        console.error(`Error fetching ${query.label}`, error);
      }
    }
  }

  if (hederaError && !hederaLogsFound) {
    collected.push({
      chainId: HEDERA_CHAIN_ID,
      label: 'Hedera Testnet - Explain unavailable',
      txHash: orderId,
    });
  }

  return collected;
}

export async function pollForHederaOrderOpened(orderId: `0x${string}`): Promise<boolean> {
  try {
    const logs = await fetchBlockscoutLogs(HEDERA_BLOCKSCOUT_API_URL, {
      module: 'logs',
      action: 'getLogs',
      address: HEDERA_CREDIT_OAPP_ADDR,
      topic0: HEDERA_ORDER_OPENED_TOPIC,
      topic1: orderId,
      topic0_1_opr: 'and',
      fromBlock: '0',
      toBlock: 'latest',
    });
    return logs.length > 0;
  } catch (error) {
    console.error('Error polling Hedera order opened:', error);
    return false;
  }
}

export async function pollForSepoliaRepayEvent(orderId: `0x${string}`): Promise<{ orderId: `0x${string}` } | null> {
  try {
    const logs = await fetchBlockscoutLogs(SEPOLIA_BLOCKSCOUT_API_URL, {
      module: 'logs',
      action: 'getLogs',
      address: ETH_COLLATERAL_OAPP_ADDR,
      topic0: MARK_REPAID_TOPIC,
      topic1: orderId,
      topic0_1_opr: 'and',
      fromBlock: '0',
      toBlock: 'latest',
    });

    if (!logs.length) {
      return null;
    }

    return { orderId: logs[0].topics[1] as `0x${string}` };
  } catch (error) {
    console.error('Error polling Sepolia repay event:', error);
    return null;
  }
}