import CryptoES from 'crypto-es';
import { SignParams } from './types';

/**
 * Encodes params into a stable query string.
 * Keys are sorted alphabetically to ensure reproducible signatures.
 */
export function buildQueryString(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) {
    return '';
  }

  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .sort();

  return keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&');
}

/**
 * Signing function for Bybit API V5 GET requests.
 * Payload: timestamp + apiKey + recvWindow + queryString
 */
export function signBybitRequest({
  apiKey,
  apiSecret,
  timestamp,
  recvWindow,
  queryString,
}: SignParams): string {
  const payload = `${timestamp}${apiKey}${recvWindow}${queryString}`;
  return CryptoES.HmacSHA256(payload, apiSecret).toString(CryptoES.enc.Hex);
}

/**
 * Signing function for Bybit API V5 POST requests.
 * Payload: timestamp + apiKey + recvWindow + exact JSON body string
 */
export function signBybitPostBody(params: {
  apiKey: string;
  apiSecret: string;
  timestamp: number;
  recvWindow: number;
  bodyString: string;
}): string {
  const payload = `${params.timestamp}${params.apiKey}${params.recvWindow}${params.bodyString}`;
  return CryptoES.HmacSHA256(payload, params.apiSecret).toString(CryptoES.enc.Hex);
}
