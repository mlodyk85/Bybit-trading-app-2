import { filterSymbolsByScope, MarketScope } from './marketScope';

const BYBIT_BASE_URL = 'https://api.bybit.com';

export type ScoreInterval = '1' | '5' | '15';

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

interface TickerRow {
  symbol: string;
  lastPrice: string;
  bid1Price?: string;
  ask1Price?: string;
  price24hPcnt?: string;
  turnover24h?: string;
}

interface TickerResult {
  list: TickerRow[];
}

interface KlineResult {
  list: string[][];
}

interface Candle {
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export interface SmartScoreResult {
  symbol: string;
  score: number;
  label: 'MOCNY' | 'DOBRY' | 'OBSERWUJ' | 'ODRZUĆ';
  lastPrice: number;
  change24hPct: number;
  spreadPct: number;
  turnover24h: number;
  momentum1mPct: number;
  momentum5mPct: number;
  momentum15mPct: number;
  greenConsistency: number;
  volumeRatio: number;
  volatilityPct: number;
  suggestedTrailArmPct: number;
  suggestedTrailDropPct: number;
  reasons: string[];
}

export interface SmartScoreScanOptions {
  limit?: number;
  scope?: MarketScope;
  customSymbols?: string[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

async function publicGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const query = Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${BYBIT_BASE_URL}${path}?${query}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json: BybitResponse<T> = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg || `Bybit ${json.retCode}`);
    return json.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKlines(symbol: string, interval: ScoreInterval): Promise<Candle[]> {
  const result = await publicGet<KlineResult>('/v5/market/kline', {
    category: 'spot', symbol, interval, limit: 30,
  });
  return (result.list || [])
    .map((row) => ({
      start: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), turnover: Number(row[6]),
    }))
    .filter((row) => [row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0))
    .sort((a, b) => a.start - b.start);
}

function momentum(candles: Candle[], lookback = 5): number {
  if (candles.length < 2) return 0;
  const last = candles[candles.length - 1].close;
  const base = candles[Math.max(0, candles.length - 1 - lookback)].close;
  return base > 0 ? ((last - base) / base) * 100 : 0;
}

function greenRatio(candles: Candle[], count = 8): number {
  const rows = candles.slice(-count);
  if (!rows.length) return 0.5;
  return rows.filter((row) => row.close >= row.open).length / rows.length;
}

function volumeRatio(candles: Candle[]): number {
  if (candles.length < 8) return 1;
  const recent = candles.slice(-3);
  const prior = candles.slice(-13, -3);
  const recentAvg = recent.reduce((sum, row) => sum + row.volume, 0) / Math.max(1, recent.length);
  const priorAvg = prior.reduce((sum, row) => sum + row.volume, 0) / Math.max(1, prior.length);
  return priorAvg > 0 ? recentAvg / priorAvg : 1;
}

function volatility(candles: Candle[]): number {
  const rows = candles.slice(-12);
  if (!rows.length) return 0.05;
  const avg = rows.reduce((sum, row) => sum + ((row.high - row.low) / row.close) * 100, 0) / rows.length;
  return Number.isFinite(avg) ? avg : 0.05;
}

async function analyzeTicker(ticker: TickerRow): Promise<SmartScoreResult | null> {
  const symbol = ticker.symbol;
  const lastPrice = Number(ticker.lastPrice);
  const bid = Number(ticker.bid1Price || 0);
  const ask = Number(ticker.ask1Price || 0);
  const turnover24h = Number(ticker.turnover24h || 0);
  const change24hPct = (Number(ticker.price24hPcnt || 0) || 0) * 100;
  if (!symbol.endsWith('USDT') || lastPrice <= 0 || bid <= 0 || ask <= 0) return null;
  const spreadPct = ((ask - bid) / lastPrice) * 100;

  const [m1Candles, m5Candles, m15Candles] = await Promise.all([
    fetchKlines(symbol, '1'), fetchKlines(symbol, '5'), fetchKlines(symbol, '15'),
  ]);
  if (m1Candles.length < 8 || m5Candles.length < 8 || m15Candles.length < 8) return null;

  const momentum1mPct = momentum(m1Candles, 5);
  const momentum5mPct = momentum(m5Candles, 5);
  const momentum15mPct = momentum(m15Candles, 5);
  const consistency = (greenRatio(m1Candles) + greenRatio(m5Candles) + greenRatio(m15Candles)) / 3;
  const volRatio = volumeRatio(m1Candles);
  const volPct = (volatility(m1Candles) + volatility(m5Candles) * 0.65) / 1.65;

  let score = 50;
  score += clamp(momentum1mPct * 8, -10, 12);
  score += clamp(momentum5mPct * 4, -10, 15);
  score += clamp(momentum15mPct * 2.2, -12, 18);
  score += clamp((consistency - 0.5) * 20, -10, 10);
  score += clamp((volRatio - 1) * 6, -4, 7);
  score += clamp(change24hPct * 0.5, -5, 5);
  score -= clamp(spreadPct * 22, 0, 10);

  const allPositive = momentum1mPct > 0 && momentum5mPct > 0 && momentum15mPct > 0;
  const allNegative = momentum1mPct < 0 && momentum5mPct < 0 && momentum15mPct < 0;
  if (allPositive) score += 8;
  if (allNegative) score -= 10;
  if (momentum1mPct > 1.2) score -= clamp((momentum1mPct - 1.2) * 12, 0, 14);
  if (momentum5mPct > 3.5) score -= clamp((momentum5mPct - 3.5) * 5, 0, 10);

  score = Math.round(clamp(score, 0, 100));
  const label: SmartScoreResult['label'] = score >= 80 ? 'MOCNY' : score >= 70 ? 'DOBRY' : score >= 60 ? 'OBSERWUJ' : 'ODRZUĆ';
  const reasons: string[] = [];
  if (allPositive) reasons.push('trend 1m/5m/15m zgodny');
  if (consistency >= 0.62) reasons.push('przewaga zielonych świec');
  if (volRatio >= 1.15) reasons.push(`wolumen x${volRatio.toFixed(2)}`);
  if (spreadPct <= 0.08) reasons.push('niski spread');
  if (momentum1mPct > 1.2) reasons.push('uwaga: mocne krótkie wybicie');
  if (!reasons.length) reasons.push('sygnał mieszany');

  return {
    symbol, score, label, lastPrice, change24hPct, spreadPct, turnover24h,
    momentum1mPct, momentum5mPct, momentum15mPct,
    greenConsistency: consistency, volumeRatio: volRatio, volatilityPct: volPct,
    suggestedTrailArmPct: clamp(volPct * 1.2, 0.05, 0.6),
    suggestedTrailDropPct: clamp(volPct * 0.6, 0.02, 0.3),
    reasons,
  };
}

export async function scanSmartScores(input: number | SmartScoreScanOptions = 12): Promise<SmartScoreResult[]> {
  const options: SmartScoreScanOptions = typeof input === 'number' ? { limit: input } : input;
  const limit = Math.max(5, Math.min(20, options.limit || 12));
  const scope: MarketScope = options.scope || 'safe';
  const customSymbols = options.customSymbols || [];

  const result = await publicGet<TickerResult>('/v5/market/tickers', { category: 'spot' });
  const stablePrefixes = ['USDC', 'USDE', 'DAI', 'FDUSD', 'TUSD', 'USDP', 'PYUSD'];
  const scopedRows = filterSymbolsByScope(
    (result.list || []).filter((row) => row.symbol.endsWith('USDT') && !stablePrefixes.some((coin) => row.symbol.startsWith(coin))),
    { scope, customSymbols }
  );

  const shortlist = scopedRows
    .map((row) => ({ row, turnover: Number(row.turnover24h || 0), last: Number(row.lastPrice), bid: Number(row.bid1Price || 0), ask: Number(row.ask1Price || 0) }))
    .filter((item) => item.turnover >= 500000 && item.last > 0 && item.bid > 0 && item.ask > 0 && ((item.ask - item.bid) / item.last) * 100 <= 0.35)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, limit);

  const output: SmartScoreResult[] = [];
  for (let i = 0; i < shortlist.length; i += 4) {
    const batch = shortlist.slice(i, i + 4);
    const results = await Promise.all(batch.map(async ({ row }) => {
      try { return await analyzeTicker(row); } catch { return null; }
    }));
    for (const item of results) if (item) output.push(item);
  }
  return output.sort((a, b) => b.score - a.score);
}
