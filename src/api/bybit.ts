import { buildQueryString, signBybitRequest } from './signing';
import {
  ApiCredentials,
  BybitApiResponse,
  Position,
  PositionListResult,
  WalletAccountResult,
  WalletBalanceResult,
} from './types';

const BYBIT_BASE_URL = 'https://api.bybit.com';
const RECV_WINDOW = 5000;

export class BybitError extends Error {
  code: number | string;

  constructor(message: string, code: number | string) {
    super(message);
    this.name = 'BybitError';
    this.code = code;
  }
}

/**
 * Maps Bybit error codes and network failures to user-friendly Polish messages.
 * NEVER exposes the API Secret or sensitive information.
 */
export function mapBybitErrorMessage(code: number | string, defaultMsg?: string): string {
  const numericCode = typeof code === 'number' ? code : parseInt(String(code), 10);

  switch (numericCode) {
    case 10003: // Invalid API key
    case 10004: // Error sign
    case 33004: // API key is invalid
      return 'Nieprawidłowy klucz API lub podpis.';
    case 10002: // Request expired
      return 'Ważność znacznika czasu wygasła.';
    case 10005: // Permission denied
    case 33009: // No IP permission or action permission
      return 'Klucz API nie ma wymaganych uprawnień.';
    case 10006: // Too many visits
    case 429:
      return 'Przekroczono limit zapytań API. Spróbuj ponownej próby za chwilę.';
    case 10016: // System error / maintenance
    case 10027: // System busy
      return 'Trwają prace konserwacyjne Bybit lub serwer jest zajęty.';
    default:
      if (defaultMsg) {
        return defaultMsg;
      }
      return 'Błąd komunikacji z Bybit (Kod: ' + code + ').';
  }
}

/**
 * Universal function for signed GET requests to Bybit V5 API.
 */
export async function bybitGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
  credentials: ApiCredentials
): Promise<T> {
  const { apiKey, apiSecret } = credentials;

  if (!apiKey || !apiSecret) {
    throw new BybitError('Brak zapisanych kluczy API.', 'NO_KEYS');
  }

  const queryString = buildQueryString(params);
  const timestamp = Date.now();
  const signature = signBybitRequest({
    apiKey,
    apiSecret,
    timestamp,
    recvWindow: RECV_WINDOW,
    queryString,
  });

  const url = queryString ? `${BYBIT_BASE_URL}${path}?${queryString}` : `${BYBIT_BASE_URL}${path}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 sec timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': String(timestamp),
        'X-BAPI-SIGN': signature,
        'X-BAPI-RECV-WINDOW': String(RECV_WINDOW),
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 429) {
        throw new BybitError('Przekroczono limit zapytań API.', 429);
      }
      throw new BybitError(`Błąd sieci (HTTP ${response.status})`, response.status);
    }

    const json: BybitApiResponse<T> = await response.json();

    if (json.retCode !== 0) {
      const friendlyMsg = mapBybitErrorMessage(json.retCode, json.retMsg);
      throw new BybitError(friendlyMsg, json.retCode);
    }

    return json.result;
  } catch (error: unknown) {
    if (error instanceof BybitError) {
      throw error;
    }
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new BybitError('Nie udało się połączyć z Bybit (Timeout). Sprawdź połączenie.', 'TIMEOUT');
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Network request failed') || message.includes('Failed to fetch')) {
      throw new BybitError('Nie udało się połączyć z Bybit. Sprawdź połączenie z internetem.', 'NETWORK_ERROR');
    }
    throw new BybitError(message || 'Wystąpił nieznany błąd podczas połączenia.', 'UNKNOWN');
  }
}

/**
 * Fetch Unified Trading Account wallet balance
 */
export async function fetchWalletBalance(credentials: ApiCredentials): Promise<WalletAccountResult | null> {
  const result = await bybitGet<WalletBalanceResult>(
    '/v5/account/wallet-balance',
    { accountType: 'UNIFIED' },
    credentials
  );

  if (result && result.list && result.list.length > 0) {
    return result.list[0];
  }
  return null;
}

/**
 * Fetch open linear positions (USDT perpetual / USDC futures)
 */
export async function fetchLinearPositions(credentials: ApiCredentials): Promise<Position[]> {
  const result = await bybitGet<PositionListResult>(
    '/v5/position/list',
    { category: 'linear', settleCoin: 'USDT' },
    credentials
  );

  const rawPositions = result?.list || [];
  // Filter only active open positions (size > 0)
  return rawPositions.filter((p) => parseFloat(p.size) > 0);
}

/**
 * Fetch open inverse positions
 */
export async function fetchInversePositions(credentials: ApiCredentials): Promise<Position[]> {
  const result = await bybitGet<PositionListResult>(
    '/v5/position/list',
    { category: 'inverse' },
    credentials
  );

  const rawPositions = result?.list || [];
  // Filter only active open positions (size > 0)
  return rawPositions.filter((p) => parseFloat(p.size) > 0);
}

/**
 * Test API connection and credentials validity
 */
export async function testBybitConnection(credentials: ApiCredentials): Promise<boolean> {
  await fetchWalletBalance(credentials);
  return true;
}
