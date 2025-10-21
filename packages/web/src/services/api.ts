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
      },
      body: JSON.stringify({ borrowId }), // Enviamos el ID en el cuerpo
    });

    if (!response.ok) {
      // Si el servidor responde con un error (ej. 404, 500)
      throw new Error(`API Error: ${response.statusText}`);
    }

    return await response.json() as LiquidationRiskResponse;
  } catch (error) {
    console.error("Failed to fetch liquidation risk:", error);
    // Re-lanzamos el error para que el componente que llama pueda manejarlo.
    throw error;
  }
};


// --- Funciones de Simulación (Mock) ---

// Esta función simula la respuesta del API con un retraso para imitar la latencia de red.
const mockLiquidationRisk = (borrowId: string): Promise<LiquidationRiskResponse> => {
  console.warn("--- USING MOCK API DATA ---");

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