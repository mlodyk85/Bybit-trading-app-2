import { buildQueryString, signBybitPostBody, signBybitRequest } from './signing';
import {
  ApiCredentials,
  BybitApiResponse,
  CreateSpotOrderResult,
  ExecutionListResult,
  Position,
  PositionListResult,
  SpotExecution,
  TradeAck,
  WalletAccountResult,
  WalletBalanceResult,
} from './types';

const BYBIT_BASE_URL = 'https://api.bybit.com';
const RECV_WINDOW = 5000;
export const MAX_SPOT_ORDER_USDT = 10;

interface SpotInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
}

interface SpotInstrumentResult {
  category: string;
  list: SpotInstrument[];
  nextPageCursor?: string;
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
  if (!credentials.apiKey || !credentials.apiSecret) {
    throw new BybitError('Brak zapisanych kluczy API.', 'NO_KEYS');
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 429) {
      throw new BybitError('Przekroczono limit zapytań API.', 429);
    }
    throw new BybitError(`Błąd sieci (HTTP ${response.status})`, response.status);
  }

  const json: BybitApiResponse<T> = await response.json();
  if (json.retCode !== 0) {
    throw new BybitError(mapBybitErrorMessage(json.retCode, json.retMsg), json.retCode);
  }
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

async function bybitPublicGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
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
  const signature = signBybitRequest({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    timestamp,
    recvWindow: RECV_WINDOW,
    queryString,
  });
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
  const signature = signBybitPostBody({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    timestamp,
    recvWindow: RECV_WINDOW,
    bodyString,
  });
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
  const result = await bybitPublicGet<SpotInstrumentResult>(
    '/v5/market/instruments-info',
    { category: 'spot' }
  );

  return (result?.list || [])
    .filter((item) => item.quoteCoin === 'USDT' && item.status === 'Trading')
    .map((item) => item.symbol)
    .sort((a, b) => a.localeCompare(b));
}

export async function fetchWalletBalance(credentials: ApiCredentials): Promise<WalletAccountResult | null> {
  const result = await bybitGet<WalletBalanceResult>(
    '/v5/account/wallet-balance',
    { accountType: 'UNIFIED' },
    credentials
  );
  return result?.list?.[0] || null;
}

export async function fetchLinearPositions(credentials: ApiCredentials): Promise<Position[]> {
  const result = await bybitGet<PositionListResult>(
    '/v5/position/list',
    { category: 'linear', settleCoin: 'USDT' },
    credentials
  );
  return (result?.list || []).filter((p) => parseFloat(p.size) > 0);
}

export async function fetchInversePositions(credentials: ApiCredentials): Promise<Position[]> {
  const result = await bybitGet<PositionListResult>(
    '/v5/position/list',
    { category: 'inverse' },
    credentials
  );
  return (result?.list || []).filter((p) => parseFloat(p.size) > 0);
}

export async function testBybitConnection(credentials: ApiCredentials): Promise<boolean> {
  await fetchWalletBalance(credentials);
  return true;
}

export function normalizeSpotQuoteAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_SPOT_ORDER_USDT) {
    throw new BybitError(`Maksymalna wartość pojedynczej transakcji to ${MAX_SPOT_ORDER_USDT} USDT.`, 'LIMIT');
  }

  const truncated = Math.floor((value + Number.EPSILON) * 100) / 100;
  if (truncated <= 0 || truncated > MAX_SPOT_ORDER_USDT) {
    throw new BybitError(`Maksymalna wartość pojedynczej transakcji to ${MAX_SPOT_ORDER_USDT} USDT.`, 'LIMIT');
  }
  return truncated;
}

export async function placeSpotMarketOrder(
  credentials: ApiCredentials,
  symbolInput: string,
  side: 'Buy' | 'Sell',
  quoteAmountUsdt: number
): Promise<TradeAck> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) {
    throw new BybitError('Obsługiwane są pary Spot zakończone na USDT, np. BTCUSDT.', 'INVALID_SYMBOL');
  }

  const safeQuoteAmount = normalizeSpotQuoteAmount(quoteAmountUsdt);
  const qty = safeQuoteAmount.toFixed(2);
  if (Number(qty) > MAX_SPOT_ORDER_USDT) {
    throw new BybitError('Zlecenie zablokowane przez twardy limit bezpieczeństwa.', 'LIMIT_GUARD');
  }

  const orderLinkId = `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 36);
  const startedAt = Date.now();
  const result = await bybitPost<CreateSpotOrderResult>(
    '/v5/order/create',
    {
      category: 'spot',
      symbol,
      side,
      orderType: 'Market',
      qty,
      marketUnit: 'quoteCoin',
      isLeverage: 0,
      orderFilter: 'Order',
      orderLinkId,
    },
    credentials
  );

  return {
    ...result,
    requestLatencyMs: Date.now() - startedAt,
    symbol,
    side,
    quoteAmountUsdt: safeQuoteAmount,
  };
}

export async function fetchSpotExecutions(
  credentials: ApiCredentials,
  limit = 50
): Promise<SpotExecution[]> {
  const result = await bybitGet<ExecutionListResult>(
    '/v5/execution/list',
    { category: 'spot', limit: Math.max(1, Math.min(100, limit)) },
    credentials
  );
  return result?.list || [];
}
