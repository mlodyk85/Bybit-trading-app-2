import * as SecureStore from 'expo-secure-store';

export type TradingRunState = {
  happyHour: boolean;
  smart: boolean;
};

const KEY = 'trading-run-state-v1';
const DEFAULT_STATE: TradingRunState = { happyHour: false, smart: false };

export async function loadTradingRunState(): Promise<TradingRunState> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<TradingRunState>;
    return {
      happyHour: parsed.happyHour === true,
      smart: parsed.smart === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function setTradingRunRequested(engine: 'happy-hour' | 'smart', requested: boolean): Promise<void> {
  const current = await loadTradingRunState();
  const next: TradingRunState = engine === 'happy-hour'
    ? { ...current, happyHour: requested }
    : { ...current, smart: requested };
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
}
