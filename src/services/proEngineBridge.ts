import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const URL_KEY = 'PRO_ENGINE_URL';
const TOKEN_KEY = 'PRO_ENGINE_TOKEN';
const memory: Record<string, string> = {};

export type ProEngineCommand = 'START' | 'STOP' | 'CLOSE_ALL' | 'CLOSE_PROFITABLE' | 'RESET_DAY';

export interface ProEngineConfig {
  url: string;
  token: string;
}

export interface ProEnginePosition {
  symbol: string;
  qty: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  openedAt: number;
  targetPct: number;
  stopPct: number;
  setup: string;
  aiConfidence?: number;
}

export interface ProEngineStatus {
  service: string;
  running: boolean;
  dayLocked: boolean;
  day: string;
  dailyTarget: number;
  dailyLossLimit: number;
  realizedToday: number;
  unrealized: number;
  tradesToday: number;
  winsToday: number;
  lossesToday: number;
  openPositions: ProEnginePosition[];
  maxOpen: number;
  reservePct: number;
  stakePct: number;
  lastAction: string;
  ai?: {
    mode: string;
    minConfidence: number;
    tradesLearned: number;
    winsLearned: number;
    lossesLearned: number;
    rollingReward: number;
    lastUpdateAt: number;
    lastDecision?: {
      symbol: string;
      confidence: number;
      threshold: number;
      setup: string;
      at: number;
      accepted: boolean;
    } | null;
    topWeights?: Array<{ name: string; weight: number }>;
  };
  account?: {
    equity: number;
    balance: number;
    freeUsdt: number;
  };
}

async function secureAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try { return await SecureStore.isAvailableAsync(); } catch { return false; }
}

function normalizeUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('Adres PRO Engine musi zaczynać się od http:// lub https://.');
  return url;
}

export async function saveProEngineConfig(config: ProEngineConfig): Promise<ProEngineConfig> {
  const normalized = { url: normalizeUrl(config.url), token: config.token.trim() };
  if (!normalized.token) throw new Error('Token PRO Engine jest wymagany.');
  if (await secureAvailable()) {
    await SecureStore.setItemAsync(URL_KEY, normalized.url);
    await SecureStore.setItemAsync(TOKEN_KEY, normalized.token);
  } else {
    memory[URL_KEY] = normalized.url;
    memory[TOKEN_KEY] = normalized.token;
  }
  return normalized;
}

export async function loadProEngineConfig(): Promise<ProEngineConfig | null> {
  try {
    if (await secureAvailable()) {
      const url = await SecureStore.getItemAsync(URL_KEY);
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      return url && token ? { url, token } : null;
    }
    return memory[URL_KEY] && memory[TOKEN_KEY] ? { url: memory[URL_KEY], token: memory[TOKEN_KEY] } : null;
  } catch {
    return null;
  }
}

export async function clearProEngineConfig(): Promise<void> {
  if (await secureAvailable()) {
    await SecureStore.deleteItemAsync(URL_KEY);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
  delete memory[URL_KEY];
  delete memory[TOKEN_KEY];
}

async function engineFetch(config: ProEngineConfig, path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    return await fetch(`${normalizeUrl(config.url)}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchProEngineStatus(config: ProEngineConfig): Promise<ProEngineStatus> {
  const response = await engineFetch(config, '/api/status');
  if (!response.ok) throw new Error(`PRO Engine HTTP ${response.status}`);
  return await response.json() as ProEngineStatus;
}

export async function sendProEngineCommand(config: ProEngineConfig, command: ProEngineCommand): Promise<void> {
  const response = await engineFetch(config, '/api/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
  if (!response.ok) throw new Error(`PRO Engine HTTP ${response.status}`);
}
