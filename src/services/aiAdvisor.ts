import * as SecureStore from 'expo-secure-store';
import { MarketRegime, EntryStrategy } from './adaptiveTradingEngine';
import { isCoreSymbol } from './tradingPolicy';

const CONFIG_KEY = 'trading.aiAdvisor.config.v1';
const SHADOW_LOG_KEY = 'trading.aiAdvisor.shadow.v1';
const MAX_SHADOW_ROWS = 250;

export interface AiAdvisorConfig {
  enabled: boolean;
  mode: 'shadow' | 'auto';
  endpointUrl: string;
  timeoutMs: number;
  minConfidence: number;
}

export type AiDecision = 'BUY' | 'WAIT' | 'REDUCE_RISK' | 'VETO';

export interface AiMarketSnapshot {
  symbol: string;
  regime: MarketRegime;
  strategy: EntryStrategy;
  price: number;
  spreadPct: number;
  change24hPct: number;
  windowMomentumPct: number;
  shortMomentumPct: number;
  turnover24h: number;
  volatilityPct: number;
  estimatedRoundTripCostPct: number;
  openPositions: number;
  freeUsdtAfterReserve: number;
}

export interface AiAdvice {
  decision: AiDecision;
  confidence: number;
  expectedMovePct: number;
  riskMultiplier: number;
  tpMultiplier: number;
  trailingMultiplier: number;
  validForSeconds: number;
  reasons: string[];
  warnings: string[];
}

export interface AiShadowRecord {
  id: string;
  createdAt: number;
  snapshot: AiMarketSnapshot;
  advice: AiAdvice;
  localDecision: 'BUY' | 'WAIT';
  outcomePct?: number;
  evaluatedAt?: number;
}

const DEFAULT_CONFIG: AiAdvisorConfig = { enabled: false, mode: 'shadow', endpointUrl: '', timeoutMs: 4500, minConfidence: 0.72 };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

export function validateAiAdvice(value: unknown): AiAdvice | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<AiAdvice>;
  if (!['BUY', 'WAIT', 'REDUCE_RISK', 'VETO'].includes(String(row.decision))) return null;
  if (![row.confidence, row.expectedMovePct, row.riskMultiplier, row.tpMultiplier, row.trailingMultiplier, row.validForSeconds].every(finite)) return null;
  if (!stringArray(row.reasons) || !stringArray(row.warnings)) return null;
  if ((row.confidence as number) < 0 || (row.confidence as number) > 1) return null;
  if ((row.riskMultiplier as number) < 0 || (row.riskMultiplier as number) > 1) return null;
  if ((row.tpMultiplier as number) < 0.5 || (row.tpMultiplier as number) > 2) return null;
  if ((row.trailingMultiplier as number) < 0.5 || (row.trailingMultiplier as number) > 2) return null;
  if ((row.validForSeconds as number) < 1 || (row.validForSeconds as number) > 300) return null;
  return row as AiAdvice;
}

export function aiAdviceCanAuthorizeLiveTrade(snapshot: AiMarketSnapshot, advice: AiAdvice, minConfidence = 0.72): boolean {
  return !isCoreSymbol(snapshot.symbol)
    && advice.decision === 'BUY'
    && advice.confidence >= Math.max(0.5, Math.min(0.95, minConfidence))
    && advice.riskMultiplier > 0;
}

export async function loadAiAdvisorConfig(): Promise<AiAdvisorConfig> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AiAdvisorConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      mode: parsed.mode === 'auto' ? 'auto' : 'shadow',
      endpointUrl: typeof parsed.endpointUrl === 'string' ? parsed.endpointUrl.trim() : '',
      timeoutMs: Math.max(1500, Math.min(10000, Number(parsed.timeoutMs) || DEFAULT_CONFIG.timeoutMs)),
      minConfidence: Math.max(0.5, Math.min(0.95, Number(parsed.minConfidence) || DEFAULT_CONFIG.minConfidence)),
    };
  } catch { return DEFAULT_CONFIG; }
}

export async function saveAiAdvisorConfig(config: AiAdvisorConfig): Promise<void> {
  const mode = config.mode === 'auto' ? 'auto' : 'shadow';
  // SHADOW is always local/offline. Never validate or persist an endpoint for this mode.
  const endpointUrl = mode === 'auto' ? config.endpointUrl.trim() : '';
  if (config.enabled && mode === 'auto' && !/^https:\/\//i.test(endpointUrl)) {
    throw new Error('AUTO AI wymaga bezpiecznego adresu HTTPS.');
  }
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify({
    enabled: config.enabled,
    mode,
    endpointUrl,
    timeoutMs: Math.max(1500, Math.min(10000, config.timeoutMs)),
    minConfidence: Math.max(0.5, Math.min(0.95, config.minConfidence)),
  }));
}


function localShadowAdvice(snapshot: AiMarketSnapshot): AiAdvice {
  // Local SHADOW uses only market data already present on the phone.
  // It never authorizes a live trade; it exists for offline scoring, logging and comparison.
  const cost = Math.max(0, snapshot.estimatedRoundTripCostPct);
  const momentum = snapshot.windowMomentumPct;
  const shortMomentum = snapshot.shortMomentumPct;
  const spreadPenalty = Math.min(0.25, Math.max(0, snapshot.spreadPct) * 2);
  const liquidityBoost = snapshot.turnover24h >= 10_000_000 ? 0.08 : snapshot.turnover24h >= 1_000_000 ? 0.04 : 0;
  const rebound = momentum < 0 && shortMomentum > 0;
  const trend = momentum > cost && shortMomentum > 0;
  const riskHigh = snapshot.volatilityPct > 4 || snapshot.spreadPct > 0.35;

  let decision: AiDecision = 'WAIT';
  if (riskHigh) decision = 'REDUCE_RISK';
  else if (rebound || trend) decision = 'BUY';

  const edge = Math.max(0, shortMomentum - cost);
  const confidence = Math.max(0.5, Math.min(0.92,
    0.58
    + (rebound ? 0.10 : 0)
    + (trend ? 0.08 : 0)
    + liquidityBoost
    + Math.min(0.08, edge / 4)
    - spreadPenalty
  ));

  const expectedMovePct = Math.max(0, shortMomentum > 0 ? shortMomentum : Math.abs(momentum) * 0.35);
  const riskMultiplier = riskHigh ? 0.35 : confidence >= 0.78 ? 0.85 : confidence >= 0.68 ? 0.65 : 0.45;

  return {
    decision,
    confidence,
    expectedMovePct,
    riskMultiplier,
    tpMultiplier: confidence >= 0.8 ? 1.2 : 1,
    trailingMultiplier: riskHigh ? 0.8 : 1,
    validForSeconds: 20,
    reasons: [
      rebound ? 'Lokalne odbicie po spadku' : trend ? 'Dodatni krótkoterminowy momentum' : 'Brak przewagi wystarczającej do wejścia',
      `Koszt rundy ~${cost.toFixed(3)}%`,
      `Spread ${snapshot.spreadPct.toFixed(3)}%`,
    ],
    warnings: riskHigh ? ['Podwyższona zmienność lub spread'] : [],
  };
}

export async function requestAiAdvice(snapshot: AiMarketSnapshot, config: AiAdvisorConfig): Promise<AiAdvice | null> {
  if (!config.enabled || isCoreSymbol(snapshot.symbol)) return null;
  if (!config.endpointUrl) {
    return config.mode === 'shadow' ? localShadowAdvice(snapshot) : null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, mode: config.mode, snapshot }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return validateAiAdvice(await response.json());
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function appendAiShadowRecord(record: AiShadowRecord): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(SHADOW_LOG_KEY);
    const current = raw ? JSON.parse(raw) as AiShadowRecord[] : [];
    const next = [...(Array.isArray(current) ? current : []), record].slice(-MAX_SHADOW_ROWS);
    await SecureStore.setItemAsync(SHADOW_LOG_KEY, JSON.stringify(next));
  } catch { /* Shadow telemetry must never stop the trading loop. */ }
}

export async function loadAiShadowRecords(): Promise<AiShadowRecord[]> {
  try {
    const raw = await SecureStore.getItemAsync(SHADOW_LOG_KEY);
    const rows = raw ? JSON.parse(raw) as AiShadowRecord[] : [];
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
