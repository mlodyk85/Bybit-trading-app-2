export const COIN_BUILDER_SYMBOLS = [
  'XRPUSDT',
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'PEPEUSDT',
  'FLOKIUSDT',
  'VELOUSDT',
] as const;

export type CoinBuilderSymbol = typeof COIN_BUILDER_SYMBOLS[number];

export interface CoinBuilderState {
  symbol: CoinBuilderSymbol;
  enabled: boolean;
  sharePct: number;
  baselineQty: number;
  workingQty: number;
  accumulatedQty: number;
  phase: 'WATCH' | 'SELL_GTC' | 'WAIT_REBUY' | 'BUY_GTC';
  sellOrderId?: string;
  buyOrderId?: string;
  lastSellPrice?: number;
  targetBuyPrice?: number;
}

export const DEFAULT_COIN_BUILDER_SHARE_PCT = 5;
export const COIN_BUILDER_MIN_NET_GAIN_PCT = 0.03;
export const COIN_BUILDER_REBUY_DROP_PCT = 0.45;

/**
 * Coin Builder never measures success in USDT. A completed cycle is successful only
 * when the quantity of the selected base coin increases after all execution fees.
 */
export function coinGainPct(beforeQty: number, afterQty: number): number {
  if (!Number.isFinite(beforeQty) || beforeQty <= 0 || !Number.isFinite(afterQty)) return 0;
  return ((afterQty - beforeQty) / beforeQty) * 100;
}

export function rebuyTargetPrice(
  netSellUsdt: number,
  soldQty: number,
  buyFeeRate: number,
  minCoinGainPct = COIN_BUILDER_MIN_NET_GAIN_PCT,
): number {
  if (netSellUsdt <= 0 || soldQty <= 0) return 0;
  const wantedQty = soldQty * (1 + minCoinGainPct / 100);
  // If BUY fee is charged in base coin, gross quantity must cover it as well.
  const grossWantedQty = wantedQty / Math.max(1e-9, 1 - buyFeeRate);
  return netSellUsdt / grossWantedQty;
}


export const CORE_ACCUMULATION_SYMBOLS = new Set<string>(COIN_BUILDER_SYMBOLS);
export const CORE_USDT_RESERVE_PCT = 35;
export const CORE_DIP_MIN_PCT = -1.25;
export const CORE_DIP_MAX_PCT = -8.0;
export const CORE_REBOUND_CONFIRM_PCT = 0.10;

export function isCoreAccumulationSymbol(symbol: string): boolean {
  return CORE_ACCUMULATION_SYMBOLS.has(symbol.trim().toUpperCase());
}

export function accumulationBudgetUsdt(freeUsdt: number, realizedProfitUsdt: number): number {
  if (!Number.isFinite(freeUsdt) || freeUsdt <= 0 || !Number.isFinite(realizedProfitUsdt) || realizedProfitUsdt <= 0) return 0;
  const reserve = freeUsdt * (CORE_USDT_RESERVE_PCT / 100);
  return Math.max(0, Math.min(realizedProfitUsdt, freeUsdt - reserve));
}
