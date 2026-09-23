import { buildQueryString, signBybitPostBody, signBybitRequest } from './signing';
import { filterSymbolsByScope, loadMarketScopeConfig } from '../services/marketScope';
import {
  ApiCredentials,
  BybitApiResponse,
  CreateSpotOrderResult,
  ExecutionListResult,
  Position,
  PositionListResult,
  SpotExecution,
  SpotOpenOrder,
  SpotOpenOrderListResult,
  TradeAck,
  WalletAccountResult,
  WalletBalanceResult,
} from './types';

const BYBIT_BASE_URL = 'https://api.bybit.com';
const RECV_WINDOW = 5000;
export const MAX_SPOT_ORDER_USDT = 10;
export const ABSOLUTE_MAX_SPOT_ORDER_USDT = 1000;

interface SpotInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  lotSizeFilter?: {
    basePrecision?: string;
    qtyStep?: string;
    minOrderQty?: string;
    minOrderAmt?: string;
    maxOrderQty?: string;
  };
  priceFilter?: {
    tickSize?: string;
    minPrice?: string;
    maxPrice?: string;
  };
}

interface SpotInstrumentResult {
  category: string;
  list: SpotInstrument[];
  nextPageCursor?: string;
}

interface SpotTicker {
  symbol: string;
  lastPrice: string;
  bid1Price?: string;
  ask1Price?: string;
  price24hPcnt?: string;
  highPrice24h?: string;
  lowPrice24h?: string;
  turnover24h?: string;
  volume24h?: string;
}

interface SpotTickerResult {
  category: string;
  list: SpotTicker[];
}

export interface SpotMarketSnapshot {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  turnover24h: number;
}

export interface SpotMarketCandidate extends SpotMarketSnapshot {
  spreadPct: number;
}

export interface SpotFillSummary {
  orderId: string;
  symbol: string;
  side: string;
  baseQty: number;
  quoteValue: number;
  avgPrice: number;
  feeByCurrency: Record<string, number>;
}

export class BybitError extends Error {
  code: number | string;

  constructor(message: string, code: number | string) {
    super(message);
    this.name = 'BybitError';
    this.code = code;
  }
}

export function mapBybitErrorMessage(code: number | string, defaultMsg?: string): string {
  const numericCode = typeof code === 'number' ? code : parseInt(String(code), 10);
  switch (numericCode) {
    case 10003:
    case 10004:
    case 33004:
      return 'Nieprawidłowy klucz API lub podpis.';
    case 10002:
      return 'Ważność znacznika czasu wygasła. Sprawdź zegar telefonu.';
    case 10005:
    case 33009:
      return 'Klucz API nie ma wymaganych uprawnień.';
    case 10006:
    case 429:
      return 'Przekroczono limit zapytań API. Spróbuj ponownie za chwilę.';
    case 10016:
    case 10027:
      return 'Trwają prace konserwacyjne Bybit lub serwer jest zajęty.';
    default:
      return defaultMsg || `Błąd komunikacji z Bybit (Kod: ${code}).`;
  }
}

function validateCredentials(credentials: ApiCredentials): void {
  if (!credentials.apiKey || !credentials.apiSecret) throw new BybitError('Brak zapisanych kluczy API.', 'NO_KEYS');
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 429) throw new BybitError('Przekroczono limit zapytań API.', 429);
    throw new BybitError(`Błąd sieci (HTTP ${response.status})`, response.status);
  }
  const json: BybitApiResponse<T> = await response.json();
  if (json.retCode !== 0) throw new BybitError(mapBybitErrorMessage(json.retCode, json.retMsg), json.retCode);
  return json.result;
}

function normalizeNetworkError(error: unknown): never {
  if (error instanceof BybitError) throw error;
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    throw new BybitError('Nie udało się połączyć z Bybit (Timeout).', 'TIMEOUT');
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Network request failed') || message.includes('Failed to fetch')) {
    throw new BybitError('Nie udało się połączyć z Bybit. Sprawdź internet.', 'NETWORK_ERROR');
  }
  throw new BybitError(message || 'Wystąpił nieznany błąd połączenia.', 'UNKNOWN');
}

async function bybitPublicGet<T>(path: string, params: Record<string, string | number | boolean | undefined | null>): Promise<T> {
  const queryString = buildQueryString(params);
  const url = queryString ? `${BYBIT_BASE_URL}${path}?${queryString}` : `${BYBIT_BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return await parseResponse<T>(response);
  } catch (error: unknown) {
    return normalizeNetworkError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function bybitGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
  credentials: ApiCredentials
): Promise<T> {
  validateCredentials(credentials);
  const queryString = buildQueryString(params);
  const timestamp = Date.now();
  const signature = signBybitRequest({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, timestamp, recvWindow: RECV_WINDOW, queryString });
  const url = queryString ? `${BYBIT_BASE_URL}${path}?${queryString}` : `${BYBIT_BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': credentials.apiKey,
        'X-BAPI-TIMESTAMP': String(timestamp),
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': String(RECV_WINDOW),
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    return await parseResponse<T>(response);
  } catch (error: unknown) {
    return normalizeNetworkError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function bybitPost<T>(
  path: string,
  body: Record<string, string | number | boolean>,
  credentials: ApiCredentials
): Promise<T> {
  validateCredentials(credentials);
  const bodyString = JSON.stringify(body);
  const timestamp = Date.now();
  const signature = signBybitPostBody({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, timestamp, recvWindow: RECV_WINDOW, bodyString });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${BYBIT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'X-BAPI-API-KEY': credentials.apiKey,
        'X-BAPI-TIMESTAMP': String(timestamp),
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': String(RECV_WINDOW),
        'Content-Type': 'application/json',
      },
      body: bodyString,
      signal: controller.signal,
    });
    return await parseResponse<T>(response);
  } catch (error: unknown) {
    return normalizeNetworkError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchSpotUsdtSymbols(): Promise<string[]> {
  const result = await bybitPublicGet<SpotInstrumentResult>('/v5/market/instruments-info', { category: 'spot' });
  return (result?.list || [])
    .filter((item) => item.quoteCoin === 'USDT' && item.status === 'Trading')
    .map((item) => item.symbol)
    .sort((a, b) => a.localeCompare(b));
}

function tickerToSnapshot(ticker: SpotTicker): SpotMarketSnapshot | null {
  const lastPrice = Number(ticker.lastPrice);
  const bid = Number(ticker.bid1Price || 0);
  const ask = Number(ticker.ask1Price || 0);
  if (!ticker.symbol || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  return {
    symbol: ticker.symbol,
    lastPrice,
    bid,
    ask,
    change24hPct: (Number(ticker.price24hPcnt || 0) || 0) * 100,
    high24h: Number(ticker.highPrice24h || 0),
    low24h: Number(ticker.lowPrice24h || 0),
    turnover24h: Number(ticker.turnover24h || 0),
  };
}

export async function fetchSpotMarketSnapshot(symbolInput: string): Promise<SpotMarketSnapshot> {
  const symbol = symbolInput.trim().toUpperCase();
  const result = await bybitPublicGet<SpotTickerResult>('/v5/market/tickers', { category: 'spot', symbol });
  const snapshot = result?.list?.[0] ? tickerToSnapshot(result.list[0]) : null;
  if (!snapshot) throw new BybitError(`Nie udało się pobrać ceny ${symbol}.`, 'NO_PRICE');
  return snapshot;
}

export async function fetchSpotUsdtMarketCandidates(limit = 40): Promise<SpotMarketCandidate[]> {
  const result = await bybitPublicGet<SpotTickerResult>('/v5/market/tickers', { category: 'spot' });
  const stablePrefixes = ['USDC', 'USDE', 'DAI', 'FDUSD', 'TUSD', 'USDP', 'PYUSD'];
  const marketConfig = await loadMarketScopeConfig();
  const scopedTickers = filterSymbolsByScope(
    (result?.list || []).filter((ticker) => ticker.symbol.endsWith('USDT') && !stablePrefixes.some((coin) => ticker.symbol.startsWith(coin))),
    marketConfig
  );
  return scopedTickers
    .map((ticker) => {
      const snapshot = tickerToSnapshot(ticker);
      if (!snapshot || snapshot.bid <= 0 || snapshot.ask <= 0) return null;
      const spreadPct = ((snapshot.ask - snapshot.bid) / snapshot.lastPrice) * 100;
      return { ...snapshot, spreadPct } as SpotMarketCandidate;
    })
    .filter((item): item is SpotMarketCandidate => item !== null)
    .filter((item) => item.turnover24h >= 500000 && item.spreadPct >= 0 && item.spreadPct <= 0.5)
    .sort((a, b) => b.turnover24h - a.turnover24h)
    .slice(0, Math.max(5, Math.min(80, limit)));
}

export async function fetchSpotLastPrice(symbolInput: string): Promise<number> {
  return (await fetchSpotMarketSnapshot(symbolInput)).lastPrice;
}

async function fetchSpotInstrument(symbolInput: string): Promise<SpotInstrument> {
  const symbol = symbolInput.trim().toUpperCase();
  const result = await bybitPublicGet<SpotInstrumentResult>('/v5/market/instruments-info', { category: 'spot', symbol });
  const instrument = result?.list?.[0];
  if (!instrument) throw new BybitError(`Brak danych instrumentu ${symbol}.`, 'NO_INSTRUMENT');
  return instrument;
}

export async function fetchSpotMinOrderAmt(symbolInput: string): Promise<number> {
  const instrument = await fetchSpotInstrument(symbolInput);
  const minOrderAmt = Number(instrument.lotSizeFilter?.minOrderAmt || '0');
  return Number.isFinite(minOrderAmt) && minOrderAmt > 0 ? minOrderAmt : 0;
}

export async function fetchWalletBalance(credentials: ApiCredentials): Promise<WalletAccountResult | null> {
  const result = await bybitGet<WalletBalanceResult>('/v5/account/wallet-balance', { accountType: 'UNIFIED' }, credentials);
  return result?.list?.[0] || null;
}

export async function fetchLinearPositions(credentials: ApiCredentials): Promise<Position[]> {
  const result = await bybitGet<PositionListResult>('/v5/position/list', { category: 'linear', settleCoin: 'USDT' }, credentials);
  return (result?.list || []).filter((p) => parseFloat(p.size) > 0);
}

export async function fetchInversePositions(credentials: ApiCredentials): Promise<Position[]> {
  const result = await bybitGet<PositionListResult>('/v5/position/list', { category: 'inverse' }, credentials);
  return (result?.list || []).filter((p) => parseFloat(p.size) > 0);
}

export async function testBybitConnection(credentials: ApiCredentials): Promise<boolean> {
  await fetchWalletBalance(credentials);
  return true;
}

function normalizedLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return MAX_SPOT_ORDER_USDT;
  return Math.min(ABSOLUTE_MAX_SPOT_ORDER_USDT, Math.floor(limit * 100) / 100);
}

export function normalizeSpotQuoteAmount(value: number, maxOrderUsdt = MAX_SPOT_ORDER_USDT): number {
  const limit = normalizedLimit(maxOrderUsdt);
  if (!Number.isFinite(value) || value <= 0 || value > limit) {
    throw new BybitError(`Maksymalna wartość pojedynczej transakcji to ${limit} USDT.`, 'LIMIT');
  }
  const truncated = Math.floor((value + Number.EPSILON) * 100) / 100;
  if (truncated <= 0 || truncated > limit) {
    throw new BybitError(`Maksymalna wartość pojedynczej transakcji to ${limit} USDT.`, 'LIMIT');
  }
  return truncated;
}

export async function placeSpotMarketOrder(
  credentials: ApiCredentials,
  symbolInput: string,
  side: 'Buy' | 'Sell',
  quoteAmountUsdt: number,
  maxOrderUsdt = MAX_SPOT_ORDER_USDT
): Promise<TradeAck> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) {
    throw new BybitError('Obsługiwane są pary Spot zakończone na USDT, np. BTCUSDT.', 'INVALID_SYMBOL');
  }
  const limit = normalizedLimit(maxOrderUsdt);
  const safeQuoteAmount = normalizeSpotQuoteAmount(quoteAmountUsdt, limit);
  const qty = safeQuoteAmount.toFixed(2);
  if (Number(qty) > limit || Number(qty) > ABSOLUTE_MAX_SPOT_ORDER_USDT) {
    throw new BybitError('Zlecenie zablokowane przez limit bezpieczeństwa.', 'LIMIT_GUARD');
  }

  const orderLinkId = `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 36);
  const startedAt = Date.now();
  const result = await bybitPost<CreateSpotOrderResult>('/v5/order/create', {
    category: 'spot', symbol, side, orderType: 'Market', qty, marketUnit: 'quoteCoin', isLeverage: 0, orderFilter: 'Order', orderLinkId,
  }, credentials);

  return { ...result, requestLatencyMs: Date.now() - startedAt, symbol, side, quoteAmountUsdt: safeQuoteAmount };
}

function decimalPlaces(value?: string): number {
  if (!value) return 8;
  if (value.includes('e-')) return Number(value.split('e-')[1]) || 8;
  const dot = value.indexOf('.');
  return dot < 0 ? 0 : value.length - dot - 1;
}

export async function placeSpotMarketSellBase(
  credentials: ApiCredentials,
  symbolInput: string,
  baseQtyInput: number
): Promise<CreateSpotOrderResult> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!Number.isFinite(baseQtyInput) || baseQtyInput <= 0) throw new BybitError('Nieprawidłowa ilość aktywa do sprzedaży.', 'INVALID_QTY');

  const instrument = await fetchSpotInstrument(symbol);
  const stepText = instrument.lotSizeFilter?.qtyStep || instrument.lotSizeFilter?.basePrecision || '0.00000001';
  const step = Number(stepText);
  const precision = Math.min(12, decimalPlaces(stepText));
  const factor = 10 ** precision;
  const steppedQty = step > 0 ? Math.floor((baseQtyInput + Number.EPSILON) / step) * step : baseQtyInput;
  const baseQty = Math.floor((steppedQty + Number.EPSILON) * factor) / factor;
  const minQty = Number(instrument.lotSizeFilter?.minOrderQty || '0');
  if (baseQty <= 0 || (minQty > 0 && baseQty < minQty)) {
    throw new BybitError('Ilość po zaokrągleniu jest mniejsza niż minimum Bybit.', 'MIN_QTY');
  }

  const minOrderAmt = Number(instrument.lotSizeFilter?.minOrderAmt || '0');
  if (minOrderAmt > 0) {
    const snapshot = await fetchSpotMarketSnapshot(symbol);
    const executablePrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
    const estimatedValue = baseQty * executablePrice;
    if (estimatedValue + 1e-8 < minOrderAmt) {
      throw new BybitError(`Wartość pozycji ${estimatedValue.toFixed(2)} USDT jest poniżej minimum Bybit ${minOrderAmt.toFixed(2)} USDT.`, 'MIN_ORDER_AMT');
    }
  }

  const orderLinkId = `auto-s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 36);
  return await bybitPost<CreateSpotOrderResult>('/v5/order/create', {
    category: 'spot', symbol, side: 'Sell', orderType: 'Market', qty: baseQty.toFixed(precision), marketUnit: 'baseCoin', isLeverage: 0, orderFilter: 'Order', orderLinkId,
  }, credentials);
}

function roundUpToStep(value: number, stepText?: string): { value: number; precision: number } {
  const text = stepText || '0.00000001';
  const step = Number(text);
  const precision = Math.min(12, decimalPlaces(text));
  if (!Number.isFinite(value) || value <= 0) return { value: 0, precision };
  if (!Number.isFinite(step) || step <= 0) return { value, precision };
  const factor = 10 ** precision;
  const stepped = Math.ceil((value - Number.EPSILON) / step) * step;
  return { value: Math.ceil((stepped - Number.EPSILON) * factor) / factor, precision };
}

export async function placeSpotLimitSellBase(
  credentials: ApiCredentials,
  symbolInput: string,
  baseQtyInput: number,
  limitPriceInput: number
): Promise<CreateSpotOrderResult & { normalizedPrice: number; normalizedQty: number }> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!Number.isFinite(baseQtyInput) || baseQtyInput <= 0) throw new BybitError('Nieprawidłowa ilość aktywa do sprzedaży.', 'INVALID_QTY');
  if (!Number.isFinite(limitPriceInput) || limitPriceInput <= 0) throw new BybitError('Nieprawidłowa cena LIMIT SELL.', 'INVALID_PRICE');

  const instrument = await fetchSpotInstrument(symbol);
  const stepText = instrument.lotSizeFilter?.qtyStep || instrument.lotSizeFilter?.basePrecision || '0.00000001';
  const qtyStep = Number(stepText);
  const qtyPrecision = Math.min(12, decimalPlaces(stepText));
  const qtyFactor = 10 ** qtyPrecision;
  const steppedQty = qtyStep > 0 ? Math.floor((baseQtyInput + Number.EPSILON) / qtyStep) * qtyStep : baseQtyInput;
  const baseQty = Math.floor((steppedQty + Number.EPSILON) * qtyFactor) / qtyFactor;
  const minQty = Number(instrument.lotSizeFilter?.minOrderQty || '0');
  if (baseQty <= 0 || (minQty > 0 && baseQty < minQty)) {
    throw new BybitError('Ilość LIMIT SELL po zaokrągleniu jest mniejsza niż minimum Bybit.', 'MIN_QTY');
  }

  const rounded = roundUpToStep(limitPriceInput, instrument.priceFilter?.tickSize);
  const limitPrice = rounded.value;
  if (limitPrice <= 0) throw new BybitError('Cena LIMIT SELL po zaokrągleniu jest nieprawidłowa.', 'INVALID_PRICE');

  const minOrderAmt = Number(instrument.lotSizeFilter?.minOrderAmt || '0');
  if (minOrderAmt > 0 && baseQty * limitPrice + 1e-8 < minOrderAmt) {
    throw new BybitError(`Wartość LIMIT SELL ${(baseQty * limitPrice).toFixed(2)} USDT jest poniżej minimum Bybit ${minOrderAmt.toFixed(2)} USDT.`, 'MIN_ORDER_AMT');
  }

  const orderLinkId = `profit-s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 36);
  const result = await bybitPost<CreateSpotOrderResult>('/v5/order/create', {
    category: 'spot',
    symbol,
    side: 'Sell',
    orderType: 'Limit',
    qty: baseQty.toFixed(qtyPrecision),
    price: limitPrice.toFixed(rounded.precision),
    timeInForce: 'GTC',
    isLeverage: 0,
    orderFilter: 'Order',
    orderLinkId,
  }, credentials);
  return { ...result, normalizedPrice: limitPrice, normalizedQty: baseQty };
}

export async function cancelSpotOrder(
  credentials: ApiCredentials,
  symbolInput: string,
  orderId: string
): Promise<void> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol || !orderId) throw new BybitError('Brak symbolu lub orderId do anulowania zlecenia.', 'INVALID_ORDER');
  await bybitPost<Record<string, never>>('/v5/order/cancel', {
    category: 'spot',
    symbol,
    orderId,
    orderFilter: 'Order',
  }, credentials);
}

export async function fetchSpotOpenOrders(credentials: ApiCredentials, limit = 50): Promise<SpotOpenOrder[]> {
  const result = await bybitGet<SpotOpenOrderListResult>(
    '/v5/order/realtime',
    { category: 'spot', openOnly: 0, limit: Math.max(1, Math.min(50, limit)) },
    credentials
  );
  return (result?.list || []).filter((order) => !['Filled', 'Cancelled', 'Rejected', 'Deactivated'].includes(order.orderStatus));
}

export async function fetchSpotExecutions(credentials: ApiCredentials, limit = 50): Promise<SpotExecution[]> {
  const result = await bybitGet<ExecutionListResult>('/v5/execution/list', { category: 'spot', limit: Math.max(1, Math.min(100, limit)) }, credentials);
  return result?.list || [];
}

export async function fetchSpotOrderExecutions(credentials: ApiCredentials, orderId: string): Promise<SpotExecution[]> {
  const result = await bybitGet<ExecutionListResult>('/v5/execution/list', { category: 'spot', orderId, limit: 100 }, credentials);
  return result?.list || [];
}

export function summarizeSpotExecutions(rows: SpotExecution[]): SpotFillSummary | null {
  if (!rows.length) return null;
  let baseQty = 0;
  let quoteValue = 0;
  const feeByCurrency: Record<string, number> = {};
  for (const row of rows) {
    baseQty += Number(row.execQty) || 0;
    quoteValue += Number(row.execValue) || 0;
    const currency = row.feeCurrency || 'UNKNOWN';
    feeByCurrency[currency] = (feeByCurrency[currency] || 0) + (Number(row.execFee) || 0);
  }
  return {
    orderId: rows[0].orderId,
    symbol: rows[0].symbol,
    side: rows[0].side,
    baseQty,
    quoteValue,
    avgPrice: baseQty > 0 ? quoteValue / baseQty : 0,
    feeByCurrency,
  };
}

export async function waitForSpotFill(credentials: ApiCredentials, orderId: string, timeoutMs = 15000): Promise<SpotFillSummary> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await fetchSpotOrderExecutions(credentials, orderId);
    const summary = summarizeSpotExecutions(rows);
    if (summary && summary.baseQty > 0) return summary;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new BybitError('Bybit nie potwierdził wykonania zlecenia w wymaganym czasie.', 'FILL_TIMEOUT');
}
