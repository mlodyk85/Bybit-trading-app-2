import * as SecureStore from 'expo-secure-store';
import { MarketRegime, EntryStrategy } from './adaptiveTradingEngine';
import { isCoreSymbol } from './tradingPolicy';

const CONFIG_KEY = 'trading.aiAdvisor.config.v1';
const SHADOW_LOG_KEY = 'trading.aiAdvisor.shadow.v1';
const MAX_SHADOW_ROWS = 250;

export interface AiAdvisorConfig {
  enabled: boolean;
  endpointUrl: string;
  timeoutMs: number;
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

const DEFAULT_CONFIG: AiAdvisorConfig = { enabled: false, endpointUrl: '', timeoutMs: 4500 };

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

export function aiAdviceCanAuthorizeLiveTrade(snapshot: AiMarketSnapshot, advice: AiAdvice): boolean {
  // Build 180 is deliberately shadow-only. This function documents and tests the hard boundary.
  return false && !isCoreSymbol(snapshot.symbol) && advice.decision === 'BUY';
}

export async function loadAiAdvisorConfig(): Promise<AiAdvisorConfig> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AiAdvisorConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      endpointUrl: typeof parsed.endpointUrl === 'string' ? parsed.endpointUrl.trim() : '',
      timeoutMs: Math.max(1500, Math.min(10000, Number(parsed.timeoutMs) || DEFAULT_CONFIG.timeoutMs)),
    };
  } catch { return DEFAULT_CONFIG; }
}

export async function saveAiAdvisorConfig(config: AiAdvisorConfig): Promise<void> {
  const endpointUrl = config.endpointUrl.trim();
  if (config.enabled && !/^https:\/\//i.test(endpointUrl)) throw new Error('AI Advisor wymaga bezpiecznego adresu HTTPS.');
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify({
    enabled: config.enabled,
    endpointUrl,
    timeoutMs: Math.max(1500, Math.min(10000, config.timeoutMs)),
  }));
}

export async function requestAiAdvice(snapshot: AiMarketSnapshot, config: AiAdvisorConfig): Promise<AiAdvice | null> {
  if (!config.enabled || !config.endpointUrl || isCoreSymbol(snapshot.symbol)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, mode: 'shadow', snapshot }),
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
