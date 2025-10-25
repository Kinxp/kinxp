// src/services/api.ts

import { API_BASE_URL, USE_MOCK_API } from '../config';

// 1. Definimos la forma de la respuesta que esperamos del endpoint de riesgo.
export interface LiquidationRiskResponse {
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  riskScore: number; // Un valor numérico, ej. de 0 a 100
  recommendation: string;
  details: {
    currentEthPrice: number;
    liquidationPrice: number;
  };
}

/**
 * Llama al endpoint de la IA para obtener el riesgo de liquidación de un préstamo.
 * @param borrowId - El ID único del préstamo o posición.
 * @returns Una promesa que se resuelve con los datos del análisis de riesgo.
 */
export const fetchLiquidationRisk = async (borrowId: string): Promise<LiquidationRiskResponse> => {
  console.log(`Fetching liquidation risk for borrow ID: ${borrowId}`);

  // --- MOCK LOGIC ---
  // Si USE_MOCK_API es true en config.ts, devolvemos datos falsos.
  if (USE_MOCK_API) {
    return mockLiquidationRisk(borrowId);
  }

  // --- REAL API CALL LOGIC ---
  try {
    const response = await fetch(`${API_BASE_URL}/ai/liquidation-risk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'bypass-tunnel-reminder': 'true'
      },
      body: JSON.stringify({ borrowId }),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return (await response.json()) as LiquidationRiskResponse;
  } catch (error) {
    console.error('Failed to fetch liquidation risk:', error);
    throw error;
  }
};

export interface TxExplanation {
  summary?: string;
  aiAnalysis?: string;
  explanation?: string;
  [key: string]: any;
}

// src/services/api.ts
// ...keep other imports...
import { API_BASE_URL, USE_MOCK_API } from '../config';

// Extend to match the server's structured JSON (and keep old fields optional for backward-compat)
export interface TxExplanation {
  method?: string;
  from?: string;
  to?: string;
  valueEther?: string;
  tokenTransfers?: { symbol: string; amount: string; from: string; to: string }[];
  feeEther?: string;
  risks?: string[];
  links?: string[];

  // legacy fields (still accepted if server sends them)
  summary?: string;
  aiAnalysis?: string;
  explanation?: string;

  [key: string]: any;
}

export const explainTransaction = async (
  chainId: number,
  txHash: `0x${string}`
): Promise<TxExplanation> => {
  if (!txHash) throw new Error('txHash is required');

  if (USE_MOCK_API) {
    // Minimal human-ish structured mock
    return {
      method: 'fundOrderWithNotify',
      from: '0xMockFrom',
      to: '0xMockTo',
      valueEther: '0.001',
      tokenTransfers: [{ symbol: 'ETH', amount: '0.001', from: '0xMockFrom', to: '0xMockTo' }],
      feeEther: '0.00042',
      risks: [],
      links: [],
      summary: `Mock explanation for ${txHash.slice(0, 12)}…`,
    };
  }

  const response = await fetch(`${API_BASE_URL}/ai/explain-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId, txHash }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Explain TX failed with status ${response.status}`);
  }

  // Server returns strict JSON keys (method, from, to, valueEther, tokenTransfers, feeEther, risks, links, …)
  return (await response.json()) as TxExplanation;
};

// --- Funciones de Simulación (Mock) ---

// Esta función simula la respuesta del API con un retraso para imitar la latencia de red.
const mockLiquidationRisk = (borrowId: string): Promise<LiquidationRiskResponse> => {
  console.warn('--- USING MOCK API DATA ---');

  // Simulamos diferentes escenarios de riesgo
  const mockScenarios: LiquidationRiskResponse[] = [
    {
      riskLevel: 'Low',
      riskScore: 15,
      recommendation: 'Your position is safe. No action is required at this time.',
      details: { currentEthPrice: 3300, liquidationPrice: 2150 },
    },
    {
      riskLevel: 'Medium',
      riskScore: 55,
      recommendation: 'Price fluctuations could place your position at risk. Consider monitoring the market closely.',
      details: { currentEthPrice: 2800, liquidationPrice: 2150 },
    },
    {
      riskLevel: 'High',
      riskScore: 85,
      recommendation: 'Your position is at high risk of liquidation. It is strongly recommended to add more collateral or repay a portion of your debt.',
      details: { currentEthPrice: 2300, liquidationPrice: 2150 },
    },
  ];

  // Devolvemos un escenario aleatorio para hacer la simulación más dinámica
  const randomScenario = mockScenarios[Math.floor(Math.random() * mockScenarios.length)];

  return new Promise(resolve => {
    setTimeout(() => {
      resolve(randomScenario);
    }, 1500); // Simulamos una espera de 1.5 segundos
  });
};
