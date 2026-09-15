import { ApiCredentials, BybitApiResponse, CreateSpotOrderResult } from './types';
import { buildQueryString, signBybitPostBody, signBybitRequest } from './signing';

const BASE = 'https://api.bybit.com';
const RECV_WINDOW = 5000;

interface InstrumentInfo {
  symbol: string;
  priceFilter?: { tickSize?: string };
  lotSizeFilter?: { qtyStep?: string; basePrecision?: string; minOrderQty?: string; minOrderAmt?: string };
}
interface InstrumentResult { list: InstrumentInfo[]; }
export interface SpotOrderStatus { orderId: string; orderLinkId: string; symbol: string; side: string; orderType: string; orderStatus: string; qty: string; price: string; avgPrice: string; cumExecQty: string; cumExecValue: string; }
interface OpenOrdersResult { list: SpotOrderStatus[]; }

async function publicGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = buildQueryString(params);
  const response = await fetch(`${BASE}${path}?${query}`);
  const json = await response.json() as BybitApiResponse<T>;
  if (!response.ok || json.retCode !== 0) throw new Error(json.retMsg || `Bybit HTTP ${response.status}`);
  return json.result;
}

async function signedPost<T>(path: string, body: Record<string, unknown>, credentials: ApiCredentials): Promise<T> {
  const timestamp = Date.now();
  const bodyString = JSON.stringify(body);
  const sign = signBybitPostBody({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, timestamp, recvWindow: RECV_WINDOW, bodyString });
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': credentials.apiKey, 'X-BAPI-SIGN': sign, 'X-BAPI-TIMESTAMP': String(timestamp), 'X-BAPI-RECV-WINDOW': String(RECV_WINDOW) }, body: bodyString });
  const json = await response.json() as BybitApiResponse<T>;
  if (!response.ok || json.retCode !== 0) throw new Error(json.retMsg || `Bybit HTTP ${response.status}`);
  return json.result;
}

async function signedGet<T>(path: string, params: Record<string, string>, credentials: ApiCredentials): Promise<T> {
  const timestamp = Date.now();
  const queryString = buildQueryString(params);
  const sign = signBybitRequest({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, timestamp, recvWindow: RECV_WINDOW, queryString });
  const response = await fetch(`${BASE}${path}?${queryString}`, { headers: { 'X-BAPI-API-KEY': credentials.apiKey, 'X-BAPI-SIGN': sign, 'X-BAPI-TIMESTAMP': String(timestamp), 'X-BAPI-RECV-WINDOW': String(RECV_WINDOW) } });
  const json = await response.json() as BybitApiResponse<T>;
  if (!response.ok || json.retCode !== 0) throw new Error(json.retMsg || `Bybit HTTP ${response.status}`);
  return json.result;
}

function decimals(stepText: string): number { const dot = stepText.indexOf('.'); return dot < 0 ? 0 : stepText.replace(/0+$/, '').length - dot - 1; }
function floorStep(value: number, step: number, precision: number): number { if (!(step > 0)) return value; const stepped = Math.floor((value + Number.EPSILON) / step) * step; return Math.floor((stepped + Number.EPSILON) * 10 ** precision) / 10 ** precision; }
function ceilStep(value: number, step: number, precision: number): number { if (!(step > 0)) return value; const stepped = Math.ceil((value - Number.EPSILON) / step) * step; return Math.ceil((stepped - Number.EPSILON) * 10 ** precision) / 10 ** precision; }

async function instrument(symbol: string): Promise<InstrumentInfo> {
  const result = await publicGet<InstrumentResult>('/v5/market/instruments-info', { category: 'spot', symbol });
  const found = result.list?.[0];
  if (!found) throw new Error(`Brak parametrów Spot dla ${symbol}.`);
  return found;
}

/** Wystawia LIMIT SELL wyłącznie na przekazaną partię bazowego coina. Nigdy nie pobiera całego salda portfela. */
export async function placeProtectedSpotLimitSell(credentials: ApiCredentials, symbolInput: string, lotQtyInput: number, minimumPriceInput: number): Promise<CreateSpotOrderResult> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) throw new Error('Nieprawidłowa para Spot/USDT.');
  if (!(lotQtyInput > 0) || !(minimumPriceInput > 0)) throw new Error('Nieprawidłowa ilość lub cena LIMIT SELL.');
  const info = await instrument(symbol);
  const qtyStepText = info.lotSizeFilter?.qtyStep || info.lotSizeFilter?.basePrecision || '0.00000001';
  const tickText = info.priceFilter?.tickSize || '0.00000001';
  const qtyPrecision = Math.min(12, decimals(qtyStepText));
  const pricePrecision = Math.min(12, decimals(tickText));
  const qty = floorStep(lotQtyInput, Number(qtyStepText), qtyPrecision);
  const price = ceilStep(minimumPriceInput, Number(tickText), pricePrecision);
  const minQty = Number(info.lotSizeFilter?.minOrderQty || 0);
  const minAmt = Number(info.lotSizeFilter?.minOrderAmt || 0);
  if (!(qty > 0) || (minQty > 0 && qty < minQty)) throw new Error('Partia jest mniejsza niż minimalna ilość Bybit.');
  if (minAmt > 0 && qty * price < minAmt) throw new Error('Partia jest mniejsza niż minimalna wartość zlecenia Bybit.');
  const orderLinkId = `lot-s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 36);
  return signedPost<CreateSpotOrderResult>('/v5/order/create', { category: 'spot', symbol, side: 'Sell', orderType: 'Limit', qty: qty.toFixed(qtyPrecision), price: price.toFixed(pricePrecision), timeInForce: 'GTC', isLeverage: 0, orderFilter: 'Order', orderLinkId }, credentials);
}

/** Sprawdza order na giełdzie. GTC pozostaje na Bybit również po zamknięciu aplikacji. */
export async function fetchProtectedSpotOrder(credentials: ApiCredentials, symbol: string, orderId: string): Promise<SpotOrderStatus | null> {
  const open = await signedGet<OpenOrdersResult>('/v5/order/realtime', { category: 'spot', symbol: symbol.toUpperCase(), orderId }, credentials);
  if (open.list?.[0]) return open.list[0];
  const history = await signedGet<OpenOrdersResult>('/v5/order/history', { category: 'spot', symbol: symbol.toUpperCase(), orderId, limit: '20' }, credentials);
  return history.list?.[0] || null;
}
