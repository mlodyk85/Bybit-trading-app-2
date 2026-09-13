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
 * Universal signing function for Bybit API V5 GET requests.
 * Signature payload format: timestamp + apiKey + recvWindow + queryString
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
