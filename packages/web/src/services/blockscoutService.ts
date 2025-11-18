import { getPublicClient, multicall, readContract } from 'wagmi/actions';
import { decodeAbiParameters, pad, parseAbiItem, type AbiEvent } from 'viem';
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
  HEDERA_CREDIT_OAPP_ADDR,
  ORDER_FUNDED_TOPIC,
  WITHDRAWN_TOPIC,
  LIQUIDATED_TOPIC,
  HEDERA_CREDIT_ABI
} from '../config';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

const ORDER_CREATED_EVENT = parseAbiItem('event OrderCreated(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed user)') as AbiEvent;
const HEDERA_ORDER_OPENED_EVENT = parseAbiItem('event HederaOrderOpened(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed borrower, uint256 collateralWei)') as AbiEvent;
const HEDERA_BORROWED_EVENT = parseAbiItem('event Borrowed(bytes32 indexed orderId, bytes32 indexed reserveId, address indexed borrower, uint64 grossAmount, uint64 netAmount, uint64 originationFee, uint32 borrowRateBps)') as AbiEvent;
const HEDERA_REPAY_EVENT = parseAbiItem('event RepayApplied(bytes32 indexed orderId, bytes32 indexed reserveId, uint64 repayBurnAmount, uint256 remainingDebtRay, bool fullyRepaid)') as AbiEvent;

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

async function buildTimestampCache(
  chainId: typeof ETH_CHAIN_ID | typeof HEDERA_CHAIN_ID,
  blockNumbers: (bigint | undefined)[]
): Promise<Map<bigint, number>> {
  const client = getPublicClient(wagmiConfig, { chainId });
  const cache = new Map<bigint, number>();

  const unique = Array.from(new Set(blockNumbers.filter((value): value is bigint => typeof value === 'bigint')));
  await Promise.all(
    unique.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        cache.set(blockNumber, Number(block.timestamp));
      } catch (err) {
        console.warn(`Failed to fetch timestamp for block ${blockNumber}`, err);
      }
    })
  );

  return cache;
}

type HederaLogResult = {
  args: Record<string, unknown>;
  transactionHash: `0x${string}`;
  blockNumber?: bigint;
  timestamp: number;
};

async function fetchHederaLogs(
  event: AbiEvent,
  args?: Record<string, unknown>
): Promise<HederaLogResult[]> {
  const client = getPublicClient(wagmiConfig, { chainId: HEDERA_CHAIN_ID });
  let logs: Awaited<ReturnType<typeof client.getLogs>> = [];
  try {
    let fromBlock: bigint = 0n;
    try {
      const latest = await client.getBlockNumber();
      const lookback = 200_000n; // ~a few days of Hedera blocks
      fromBlock = latest > lookback ? latest - lookback : 0n;
    } catch (blockErr) {
      console.warn('Unable to determine Hedera latest block, defaulting to fromBlock=0', blockErr);
    }
    logs = await client.getLogs({
      address: HEDERA_CREDIT_OAPP_ADDR,
      event,
      args,
      fromBlock,
      toBlock: 'latest',
    });
  } catch (error) {
    console.warn('Hedera RPC getLogs failed, returning empty result', error);
    return [];
  }

  const timestampCache = await buildTimestampCache(
    HEDERA_CHAIN_ID,
    logs.map((log) => (typeof log.blockNumber === 'bigint' ? log.blockNumber : undefined))
  );

  return logs.map((log) => {
    const blockNumber = log.blockNumber ?? 0n;
    const timestamp = timestampCache.get(blockNumber) ?? Math.floor(Date.now() / 1000);
    return {
      args: (log as typeof log & { args: Record<string, unknown> }).args ?? {},
      transactionHash: (log.transactionHash ?? '0x') as `0x${string}`,
      blockNumber,
      timestamp,
    };
  });
}

async function fetchOrderIdsForUser(userAddress: `0x${string}`): Promise<`0x${string}`[]> {
  const userTopic = pad(userAddress, { size: 32 }).toLowerCase();
  let logs: any[] = [];

  try {
    logs = await fetchBlockscoutLogs(SEPOLIA_BLOCKSCOUT_API_URL, {
      module: 'logs',
      action: 'getLogs',
      address: ETH_COLLATERAL_OAPP_ADDR,
      topic0: ORDER_CREATED_TOPIC,
      fromBlock: '0',
      toBlock: 'latest',
    });
  } catch (error) {
    console.warn('Blockscout order lookup failed, falling back to on-chain logs', error);
  }

  const orderIds: `0x${string}`[] = [];
  const seen = new Set<string>();

  for (const log of logs) {
    const topics: unknown = log?.topics;
    if (!Array.isArray(topics)) continue;

    const [ , orderTopic, , userTopicFromLog ] = topics as (string | undefined)[];
    if (!orderTopic || !userTopicFromLog) continue;
    if (userTopicFromLog.toLowerCase() !== userTopic) continue;

    const normalizedOrder = orderTopic.toLowerCase();
    if (seen.has(normalizedOrder)) continue;

    seen.add(normalizedOrder);
    orderIds.push(orderTopic as `0x${string}`);
  }

  if (orderIds.length === 0) {
    try {
      const client = getPublicClient(wagmiConfig, { chainId: ETH_CHAIN_ID });
      const chainLogs = await client.getLogs({
        address: ETH_COLLATERAL_OAPP_ADDR,
        event: ORDER_CREATED_EVENT,
        args: { user: userAddress },
        fromBlock: 0n,
        toBlock: 'latest',
      });

      for (const log of chainLogs) {
        const args = (log as { args?: Record<string, unknown> }).args;
        const orderIdArg = typeof args?.orderId === 'string' ? args.orderId : undefined;
        if (!orderIdArg) continue;
        const normalizedOrder = orderIdArg.toLowerCase();
        if (seen.has(normalizedOrder)) continue;
        seen.add(normalizedOrder);
        orderIds.push(orderIdArg as `0x${string}`);
      }
    } catch (onChainError) {
      console.error('On-chain order log fallback failed', onChainError);
    }
  }

  return orderIds;
}

async function loadOrderSummaries(orderIds: `0x${string}`[]): Promise<UserOrderSummary[]> {
  if (orderIds.length === 0) return [];

  // Step 1: Fetch all order statuses from Ethereum. This is fast and efficient.
  const ethContracts = orderIds.map(orderId => ({
    address: ETH_COLLATERAL_OAPP_ADDR,
    abi: ETH_COLLATERAL_ABI,
    functionName: 'orders',
    args: [orderId],
  }));

  const ethResults = await multicall(wagmiConfig, {
    chainId: ETH_CHAIN_ID,
    contracts: ethContracts,
    allowFailure: true,
  });

  // Step 2: Sequentially process each order to determine its status and fetch Hedera data ONLY WHEN NEEDED.
  const summaries: UserOrderSummary[] = [];

  for (let index = 0; index < orderIds.length; index++) {
    const orderId = orderIds[index];
    const ethCallResult = ethResults[index];
    
    if (ethCallResult.status !== 'success' || !ethCallResult.result) continue;

    const tuple = ethCallResult.result as unknown;
    if (!Array.isArray(tuple)) continue;

    const [
      owner,
      reserveId,
      amountWei,
      unlockedWei,
      funded,
      repaid,
      liquidated,
    ] = tuple as [
      `0x${string}`,
      `0x${string}`,
      bigint,
      bigint,
      boolean,
      boolean,
      boolean,
    ];

    if (!owner || owner === ZERO_ADDRESS) continue;

    const normalizedReserveId = reserveId && reserveId !== ZERO_BYTES32 ? reserveId : undefined;

    let status: OrderStatus = 'Created';
    let borrowedUsd: bigint = 0n;
    let hederaReady = false;

    // --- THIS IS THE CORRECTED LOGIC ---
    if (liquidated) {
      status = 'Liquidated';
    } else if (repaid && !funded) {
      status = 'Withdrawn';
    } else if (repaid && funded) {
      status = 'ReadyToWithdraw';
    } else if (funded) {
      // ONLY if an order is funded do we need to make the expensive call to Hedera.
      try {
        const hederaOrder = await readContract(wagmiConfig, {
          address: HEDERA_CREDIT_OAPP_ADDR,
          abi: HEDERA_CREDIT_ABI,
          functionName: 'horders',
          args: [orderId],
          chainId: HEDERA_CHAIN_ID,
        }) as unknown as [
          `0x${string}`,
          bigint,
          bigint,
          boolean,
        ];

        const hederaCollateral = hederaOrder?.[1] ?? 0n;
        borrowedUsd = hederaOrder?.[2] ?? 0n;
        hederaReady = hederaCollateral > 0n;

        // Now, determine the sub-status for a funded order without calling non-existent functions
        if (borrowedUsd > 0n) {
          status = 'Borrowed';
        } else if (repaid) {
          status = unlockedWei > 0n ? 'ReadyToWithdraw' : 'Withdrawn';
        } else if (unlockedWei > 0n) {
          status = 'PendingRepayConfirmation';
        } else {
          status = 'Funded';
        }
      } catch (error) {
        // If the Hedera call fails (e.g., rate limit), we can gracefully fall back.
        console.warn(`Could not fetch Hedera state for order ${orderId.slice(0,10)}. Defaulting to 'Funded'.`, error);
        status = repaid ? 'ReadyToWithdraw' : 'Funded';
      }
    } else {
      status = 'Created';
    }

    if (status === 'ReadyToWithdraw' && (unlockedWei ?? 0n) === 0n) {
      status = amountWei === 0n ? 'Withdrawn' : 'Funded';
    }

    summaries.push({
      orderId: orderId,
      amountWei,
      status,
      reserveId: normalizedReserveId,
      unlockedWei,
      borrowedUsd,
      hederaReady,
    });
  }

  return summaries;
}



export async function fetchAllUserOrders(userAddress: `0x${string}`): Promise<UserOrderSummary[]> {
  const orderIds = await fetchOrderIdsForUser(userAddress);
  if (orderIds.length === 0) return [];
  return loadOrderSummaries(orderIds);
}

export async function fetchOrderSummary(orderId: `0x${string}`): Promise<UserOrderSummary | null> {
  try {
    const tuple = await readContract(wagmiConfig, {
      address: ETH_COLLATERAL_OAPP_ADDR,
      abi: ETH_COLLATERAL_ABI,
      functionName: 'orders',
      args: [orderId],
      chainId: ETH_CHAIN_ID,
    }) as [ `0x${string}`, `0x${string}`, bigint, bigint, boolean, boolean, boolean ];

    const [ owner, reserveId, amountWei, unlockedWei, funded, repaid, liquidated ] = tuple;
    if (!owner || owner === ZERO_ADDRESS) return null;

    const normalizedReserveId = reserveId && reserveId !== ZERO_BYTES32 ? reserveId : undefined;
    let status: OrderStatus = 'Created';
    let borrowedUsd: bigint = 0n;
    let hederaReady = false;

    if (liquidated) {
      status = 'Liquidated';
    } else if (repaid && !funded) {
      status = 'Withdrawn';
    } else if (repaid && funded) {
      status = 'ReadyToWithdraw';
    } else if (funded) {
      try {
        const hederaOrder = await readContract(wagmiConfig, {
          address: HEDERA_CREDIT_OAPP_ADDR,
          abi: HEDERA_CREDIT_ABI,
          functionName: 'horders',
          args: [orderId],
          chainId: HEDERA_CHAIN_ID,
        }) as [ `0x${string}`, bigint, bigint, boolean ];

        const hederaCollateral = hederaOrder?.[1] ?? 0n;
        borrowedUsd = hederaOrder?.[2] ?? 0n;
        hederaReady = hederaCollateral > 0n;

        if (borrowedUsd > 0n) {
          status = 'Borrowed';
        } else if (repaid) {
          status = unlockedWei > 0n ? 'ReadyToWithdraw' : 'Withdrawn';
        } else if (unlockedWei > 0n) {
          status = 'PendingRepayConfirmation';
        } else {
          status = 'Funded';
        }
      } catch (err) {
        console.warn(`Failed to refresh Hedera data for ${orderId}`, err);
        status = repaid ? 'ReadyToWithdraw' : 'Funded';
      }
    } else {
      status = 'Created';
    }

    if (status === 'ReadyToWithdraw' && (unlockedWei ?? 0n) === 0n) {
      status = amountWei === 0n ? 'Withdrawn' : 'Funded';
    }

    return {
      orderId,
      amountWei,
      status,
      reserveId: normalizedReserveId,
      unlockedWei,
      borrowedUsd,
      hederaReady,
    };
  } catch (error) {
    console.error(`Failed to fetch order summary for ${orderId}`, error);
    return null;
  }
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
    // NEW: Withdrawn (closed by withdrawal)
    {
      chainId: ETH_CHAIN_ID,
      label: 'Ethereum (Sepolia) - Withdrawn',
      baseUrl: SEPOLIA_BLOCKSCOUT_API_URL,
      address: ETH_COLLATERAL_OAPP_ADDR,
      topic0: WITHDRAWN_TOPIC,
      extraParams: { topic1: orderId, topic0_1_opr: 'and' },
    },
    // NEW: Liquidated (closed by liquidation)
    {
      chainId: ETH_CHAIN_ID,
      label: 'Ethereum (Sepolia) - Liquidated',
      baseUrl: SEPOLIA_BLOCKSCOUT_API_URL,
      address: ETH_COLLATERAL_OAPP_ADDR,
      topic0: LIQUIDATED_TOPIC,
      extraParams: { topic1: orderId, topic0_1_opr: 'and' },
    },
    {
      chainId: HEDERA_CHAIN_ID,
      label: 'Hedera Testnet - Order Opened',
      event: HEDERA_ORDER_OPENED_EVENT,
    },
    {
      chainId: HEDERA_CHAIN_ID,
      label: 'Hedera Testnet - Repaid',
      event: HEDERA_REPAY_EVENT,
    },
  ];

  const collected: OrderTransactionInfo[] = [];
  let hederaLogsFound = false;
  let hederaError = false;

  for (const query of queries) {
    try {
      if (query.chainId === HEDERA_CHAIN_ID) {
        if (!query.event) {
          console.warn(`Skipping Hedera query without event definition: ${query.label}`);
          continue;
        }
        const hederaLogs = await fetchHederaLogs(query.event, { orderId });
        if (!hederaLogs.length) continue;
        hederaLogsFound = true;

        for (const log of hederaLogs) {
          collected.push({
            chainId: query.chainId,
            label: query.label,
            txHash: log.transactionHash,
            timestamp: `0x${log.timestamp.toString(16)}`,
          });
        }
      } else {
        if (!query.baseUrl) {
          console.warn(`Skipping Blockscout query without baseUrl: ${query.label}`);
          continue;
        }
        const params: Record<string, string> = {
          module: 'logs',
          action: 'getLogs',
          address: query.address!,
          topic0: query.topic0!,
          fromBlock: '0',
          toBlock: 'latest',
          ...query.extraParams,
        };

        const logs = await fetchBlockscoutLogs(query.baseUrl, params);
        if (!logs.length) continue;

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
    const logs = await fetchHederaLogs(HEDERA_ORDER_OPENED_EVENT, { orderId });
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

export interface FundingEvent {
  amountWei: bigint;
  timestamp: number; // Unix timestamp
}

/**
 * Fetches all historical OrderFunded events for a specific user from the Sepolia network.
 * @param userAddress The user's wallet address.
 * @returns A promise that resolves to an array of funding events.
 */
export async function fetchHistoricalFunding(userAddress: `0x${string}`): Promise<FundingEvent[]> {
  const paddedUserAddress = `0x${userAddress.substring(2).padStart(64, '0')}`;

  const logs = await fetchBlockscoutLogs(SEPOLIA_BLOCKSCOUT_API_URL, {
    module: 'logs',
    action: 'getLogs',
    address: ETH_COLLATERAL_OAPP_ADDR,
    topic0: ORDER_FUNDED_TOPIC,
    topic3: paddedUserAddress, // `user` is the third indexed topic in the OrderFunded event
    topic0_3_opr: 'and',
    fromBlock: '0',
    toBlock: 'latest',
  });

  // Parse the raw logs into a clean array of events
  const fundingEvents: FundingEvent[] = logs.map(log => {
    // The `amountWei` is the first non-indexed value in the log's data field
    const [amountWei] = decodeAbiParameters([{ type: 'uint256', name: 'amountWei' }], log.data);
    return {
      amountWei: amountWei as bigint,
      timestamp: parseInt(log.timeStamp, 16),
    };
  });

  // Sort by date, oldest first, which is important for accumulation
  return fundingEvents.sort((a, b) => a.timestamp - b.timestamp);
}

export interface BorrowEvent {
  amountUsd: bigint; // This will be a bigint with 6 decimals
  timestamp: number; // Unix timestamp
}

/**
 * Fetches all historical Borrowed events for a specific user from the Hedera network.
 * @param userAddress The user's wallet address.
 * @returns A promise that resolves to an array of borrow events.
 */
export async function fetchHistoricalBorrows(userAddress: `0x${string}`): Promise<BorrowEvent[]> {
  const logs = await fetchHederaLogs(HEDERA_BORROWED_EVENT, { borrower: userAddress });

  const borrowEvents: BorrowEvent[] = logs.map(({ args, timestamp }) => {
    const grossAmount = (args?.grossAmount as bigint | undefined) ?? 0n;
    const netAmount = (args?.netAmount as bigint | undefined) ?? grossAmount;
    return {
      amountUsd: netAmount,
      timestamp,
    };
  });

  return borrowEvents.sort((a, b) => a.timestamp - b.timestamp);
}


/**
 * Fetches ALL historical OrderFunded events across the entire protocol.
 * @returns A promise that resolves to an array of all funding events.
 */
export async function fetchAllHistoricalFunding(): Promise<FundingEvent[]> {
  const logs = await fetchBlockscoutLogs(SEPOLIA_BLOCKSCOUT_API_URL, {
    module: 'logs',
    action: 'getLogs',
    address: ETH_COLLATERAL_OAPP_ADDR,
    topic0: ORDER_FUNDED_TOPIC,
    fromBlock: '0',
    toBlock: 'latest',
  });
  const fundingEvents: FundingEvent[] = logs.map(log => {
    const [amountWei] = decodeAbiParameters([{ type: 'uint256', name: 'amountWei' }], log.data);
    return {
      amountWei: amountWei as bigint,
      timestamp: parseInt(log.timeStamp, 16),
    };
  });

  return fundingEvents.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetches ALL historical Borrowed events across the entire protocol.
 * @returns A promise that resolves to an array of all borrow events.
 */
export async function fetchAllHistoricalBorrows(): Promise<BorrowEvent[]> {
  const logs = await fetchHederaLogs(HEDERA_BORROWED_EVENT);

  const borrowEvents: BorrowEvent[] = logs.map(({ args, timestamp }) => {
    const grossAmount = (args?.grossAmount as bigint | undefined) ?? 0n;
    const netAmount = (args?.netAmount as bigint | undefined) ?? grossAmount;
    return {
      amountUsd: netAmount,
      timestamp,
    };
  });

  return borrowEvents.sort((a, b) => a.timestamp - b.timestamp);
}
