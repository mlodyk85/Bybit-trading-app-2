import * as SecureStore from 'expo-secure-store';

export type TradingEngineId =
  | 'happy-hour'
  | 'assist'
  | 'aggressive'
  | 'rotation'
  | 'futures-basket'
  | 'gold'
  | 'shadow'
  | 'coin-builder';

export type TradingRunState = Record<TradingEngineId, boolean>;

const KEY = 'trading-run-state-v2';

const DEFAULT_STATE: TradingRunState = {
  'happy-hour': false,
  assist: false,
  aggressive: false,
  rotation: false,
  'futures-basket': false,
  gold: false,
  shadow: false,
  'coin-builder': false,
};

export async function loadTradingRunState(): Promise<TradingRunState> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<TradingRunState>;
    return {
      'happy-hour': parsed['happy-hour'] === true,
      assist: parsed.assist === true,
      aggressive: parsed.aggressive === true,
      rotation: parsed.rotation === true,
      'futures-basket': parsed['futures-basket'] === true,
      gold: parsed.gold === true,
      shadow: parsed.shadow === true,
      'coin-builder': parsed['coin-builder'] === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function setTradingRunRequested(engine: TradingEngineId, requested: boolean): Promise<void> {
  const current = await loadTradingRunState();
  const next: TradingRunState = { ...current, [engine]: requested };
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
}

export async function clearAllTradingRunRequests(): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(DEFAULT_STATE));
}
