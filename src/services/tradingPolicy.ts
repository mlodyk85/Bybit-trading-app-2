export const CORE_SYMBOLS = Object.freeze([
  'XRPUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'VELOUSDT',
] as const);

const CORE_SET: ReadonlySet<string> = new Set(CORE_SYMBOLS);

export type TradingEngineOwner = 'happy-hour' | 'smart' | 'manual';

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** CORE is accumulation-only. No autonomous active-trading path may sell it. */
export function assertAutonomousSellAllowed(owner: TradingEngineOwner, symbol: string): void {
  if (owner !== 'manual' && CORE_SET.has(normalizeSymbol(symbol))) {
    throw new Error(`CORE_LOCK:${normalizeSymbol(symbol)}`);
  }
}

export function isCoreSymbol(symbol: string): boolean {
  return CORE_SET.has(normalizeSymbol(symbol));
}

export function filterHappyHourUniverse(symbols: string[]): string[] {
  return symbols.map(normalizeSymbol).filter((symbol) => !CORE_SET.has(symbol));
}

export interface EngineLifecycleState {
  happyHourRunning: boolean;
  smartRunning: boolean;
}

export function transitionEngine(
  state: EngineLifecycleState,
  engine: 'happy-hour' | 'smart',
  running: boolean,
): EngineLifecycleState {
  return engine === 'happy-hour'
    ? { ...state, happyHourRunning: running }
    : { ...state, smartRunning: running };
}
