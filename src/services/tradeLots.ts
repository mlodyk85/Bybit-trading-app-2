import * as SecureStore from 'expo-secure-store';

const KEY = 'trading.tradeLots.v1';
export type TradeLotState = 'holding' | 'sell_order_open' | 'sold';
export interface TradeLot {
  id: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  costUsdt: number;
  createdAt: number;
  state: TradeLotState;
  sellOrderId?: string;
  sellTargetPrice?: number;
}

export async function loadTradeLots(): Promise<TradeLot[]> {
  try { const raw = await SecureStore.getItemAsync(KEY); const parsed = raw ? JSON.parse(raw) as TradeLot[] : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
export async function saveTradeLots(lots: TradeLot[]): Promise<void> { await SecureStore.setItemAsync(KEY, JSON.stringify(lots)); }
export async function addTradeLot(lot: TradeLot): Promise<TradeLot[]> { const lots = await loadTradeLots(); const next = [...lots.filter((x) => x.id !== lot.id), lot]; await saveTradeLots(next); return next; }
export async function updateTradeLot(id: string, patch: Partial<TradeLot>): Promise<TradeLot[]> { const lots = await loadTradeLots(); const next = lots.map((lot) => lot.id === id ? { ...lot, ...patch } : lot); await saveTradeLots(next); return next; }
