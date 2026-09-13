import * as SecureStore from 'expo-secure-store';
import { ABSOLUTE_MAX_SPOT_ORDER_USDT, MAX_SPOT_ORDER_USDT } from '../api/bybit';

const MAX_ORDER_KEY = 'trading.maxOrderUsdt';

export async function loadMaxOrderUsdt(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(MAX_ORDER_KEY);
    const value = raw ? Number(raw) : NaN;
    if (Number.isFinite(value) && value > 0 && value <= ABSOLUTE_MAX_SPOT_ORDER_USDT) return value;
  } catch {
    // Domyślny limit pozostaje aktywny, gdy zapis ustawień jest niedostępny.
  }
  return MAX_SPOT_ORDER_USDT;
}

export async function saveMaxOrderUsdt(value: number): Promise<number> {
  if (!Number.isFinite(value) || value <= 0 || value > ABSOLUTE_MAX_SPOT_ORDER_USDT) {
    throw new Error(`Limit musi być większy od 0 i nie może przekraczać ${ABSOLUTE_MAX_SPOT_ORDER_USDT} USDT.`);
  }
  const normalized = Math.floor(value * 100) / 100;
  await SecureStore.setItemAsync(MAX_ORDER_KEY, String(normalized));
  return normalized;
}
