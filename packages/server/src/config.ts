// src/config.ts

const explorerMap: Record<number, string> = {
  1: "https://eth.blockscout.com",
  10: "https://optimism.blockscout.com",
  137: "https://polygon.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
};

function readLtv(prefix: string, chainId: number, fallback: number): number {
  const scoped = process.env[`${prefix}_${chainId}`];
  const global = process.env[prefix];
  const value = scoped ?? global;
  const num = value !== undefined ? Number(value) : NaN;
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function explorerBase(chainId: number) {
  const override = process.env[`EXPLORER_BASE_${chainId}`] || process.env.EXPLORER_BASE;
  const base = override || explorerMap[chainId] || "https://blockscout.com";
  return base.replace(/\/$/, "");
}

export function resolveLtvForChain(chainId: number) {
  return {
    targetLtv: readLtv("TARGET_LTV", chainId, 0.6),
    maxLtv: readLtv("MAX_LTV", chainId, 0.8),
    liqLtv: readLtv("LIQ_LTV", chainId, 0.85),
  };
}
