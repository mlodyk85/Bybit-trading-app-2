import * as SecureStore from 'expo-secure-store';

export type MarketScope = 'safe' | 'full' | 'custom';

export interface MarketScopeConfig {
  scope: MarketScope;
  customSymbols: string[];
}

export const TOP_SAFE_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'SUIUSDT', 'BNBUSDT',
  'LTCUSDT', 'BCHUSDT', 'DOTUSDT', 'TRXUSDT', 'NEARUSDT',
];

const KEY = 'smart-market-scope-v1';
const DEFAULT_CONFIG: MarketScopeConfig = { scope: 'safe', customSymbols: [] };

const cleanSymbols = (symbols: string[]) => Array.from(new Set(
  symbols
    .map((value) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter((value) => value.endsWith('USDT') && value.length >= 6 && value.length <= 30)
));

export async function loadMarketScopeConfig(): Promise<MarketScopeConfig> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<MarketScopeConfig>;
    const scope: MarketScope = parsed.scope === 'full' || parsed.scope === 'custom' ? parsed.scope : 'safe';
    return { scope, customSymbols: cleanSymbols(Array.isArray(parsed.customSymbols) ? parsed.customSymbols : []) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveMarketScopeConfig(config: MarketScopeConfig): Promise<MarketScopeConfig> {
  const next: MarketScopeConfig = {
    scope: config.scope === 'full' || config.scope === 'custom' ? config.scope : 'safe',
    customSymbols: cleanSymbols(config.customSymbols || []),
  };
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  return next;
}

export function filterSymbolsByScope<T extends { symbol: string }>(rows: T[], config: MarketScopeConfig): T[] {
  if (config.scope === 'full') return rows;
  const allowed = new Set(config.scope === 'custom' && config.customSymbols.length ? config.customSymbols : TOP_SAFE_SYMBOLS);
  return rows.filter((row) => allowed.has(row.symbol.toUpperCase()));
}
