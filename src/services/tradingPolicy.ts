export const CORE_SYMBOLS = Object.freeze([
  'XRPUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'VELOUSDT',
] as const);

const CORE_SET: ReadonlySet<string> = new Set(CORE_SYMBOLS);

export type TradingEngineOwner = 'happy-hour' | 'smart' | 'liquid' | 'manual';

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * CORE protection:
 * - generic Happy Hour cannot sell CORE balances;
 * - SMART may sell only the working slice selected by its caller;
 * - LIQUID may sell only the exact lot it just bought;
 * - manual is always user-authorized.
 */
export function assertAutonomousSellAllowed(owner: TradingEngineOwner, symbol: string): void {
  if (owner === 'happy-hour' && CORE_SET.has(normalizeSymbol(symbol))) {
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
