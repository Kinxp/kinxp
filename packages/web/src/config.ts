// src/config.ts

// Leemos la variable de entorno VITE_API_BASE que definiste en tu archivo .env
// Si no está definida, usamos un valor por defecto para el desarrollo local.
export const API_BASE_URL = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

// Un simple interruptor para activar/desactivar el modo de simulación (mock).
// ¡Muy útil para el desarrollo del frontend!
export const USE_MOCK_API = true;