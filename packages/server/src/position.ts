// src/position.ts
import { mcpRest as mcp } from "./mcp_rest.js";

export function weiToEthStr(wei: string | number | bigint): string {
  const b = BigInt(String(wei ?? "0"));
  const int = b / 1000000000000000000n;
  const frac = b % 1000000000000000000n;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return fracStr ? `${int}.${fracStr}` : `${int}`;
}

export function explorerBase(chainId: number) {
  const map: Record<number, string> = {
    1: "https://eth.blockscout.com",
    10: "https://optimism.blockscout.com",
    137: "https://polygon.blockscout.com",
    8453: "https://base.blockscout.com",
    42161: "https://arbitrum.blockscout.com",
  };
  return (map[chainId] || "https://blockscout.com").replace(/\/$/, "");
}

/**
 * Resolve collateral (ETH) size in ETH units.
 * - If collateralWei is given, use it.
 * - Else, if depositTxHash is provided, pull tx.value via MCP REST.
 */
export async function resolveCollateralEth(args: {
  chainId: number;
  collateralWei?: string;
  depositTxHash?: string; // kept for backward-compat; ignored on purpose
}): Promise<{ eth?: number; links: string[] }> {
  const { collateralWei } = args;
  const links: string[] = [];
  // We now compute position health purely from inputs. No MCP call here.
  if (collateralWei) {
    return { eth: Number(weiToEthStr(collateralWei)), links };
  }
  // If you want to accept "collateralEth" directly in the future, you can add it here.
  return { eth: undefined, links };
}
export function computeHealth(input: {
  collateralEth: number;
  ethUsd: number;
  debtUsd: number;
  targetLtv: number;
  maxLtv: number;
  liqLtv: number;
}) {
  const { collateralEth, ethUsd, debtUsd, targetLtv, maxLtv, liqLtv } = input;

  const collateralUsd = collateralEth * ethUsd;
  const ltv = collateralUsd > 0 ? debtUsd / collateralUsd : 0;

  const liqPrice =
    collateralEth > 0 && liqLtv > 0 ? debtUsd / (collateralEth * liqLtv) : Infinity;

  const distanceToLiquidationPct =     //TODO: check if this is correct 
    isFinite(liqPrice) && ethUsd > 0
      ? Math.max(0, ((ethUsd - liqPrice) / ethUsd) * 100)
      : 0;

  let riskLevel: "safe" | "watch" | "danger" = "safe";
  if (ltv >= maxLtv) riskLevel = "danger";
  else if (ltv >= targetLtv) riskLevel = "watch";

  return { collateralUsd, ltv, liqPrice, distanceToLiquidationPct, riskLevel };
}

export function computeAdvice(input: {
  collateralEth: number;
  ethUsd: number;
  debtUsd: number;
  targetLtv: number;
  maxLtv: number;
  liqLtv: number;
}) {
  const { collateralEth, ethUsd, debtUsd, targetLtv, maxLtv, liqLtv } = input;

  const { collateralUsd, ltv } = computeHealth({
    collateralEth,
    ethUsd,
    debtUsd,
    targetLtv,
    maxLtv,
    liqLtv,
  });

  const targetDebtUsd = targetLtv * collateralUsd;
  const maxDebtUsd = maxLtv * collateralUsd;

  let recommendedAction: "borrow" | "repay" | "hold" = "hold";
  let targetBorrowUsd = 0;
  let targetRepayUsd = 0;

  if (targetDebtUsd > debtUsd) {
    recommendedAction = "borrow";
    targetBorrowUsd = Math.max(
      0,
      Math.min(targetDebtUsd - debtUsd, maxDebtUsd - debtUsd)
    );
  } else if (targetDebtUsd < debtUsd) {
    recommendedAction = "repay";
    targetRepayUsd = Math.max(0, debtUsd - targetDebtUsd);
  }

  const maxAdditionalBorrowUsd = Math.max(0, maxDebtUsd - debtUsd);
  const postMaxLtvDebtUsd = maxDebtUsd;

  return {
    ltv,
    targetBorrowUsd,
    targetRepayUsd,
    recommendedAction,
    guardrails: { maxAdditionalBorrowUsd, postMaxLtvDebtUsd },
  };
}
