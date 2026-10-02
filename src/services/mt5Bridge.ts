import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const URL_KEY = 'MT5_BRIDGE_URL';
const TOKEN_KEY = 'MT5_BRIDGE_TOKEN';
const memory: Record<string,string> = {};

export type Mt5Command = 'START' | 'STOP' | 'CLOSE_ALL' | 'RESET_DAY_LOCK';

export interface Mt5BridgeConfig {
  url: string;
  token: string;
}

export interface Mt5Status {
  agentId: string;
  updatedAt: string;
  symbol: string;
  enabled: boolean;
  dayLocked: boolean;
  equity: number;
  balance: number;
  freeMargin: number;
  margin: number;
  dailyRealized: number;
  basketPnl: number;
  positions: number;
  maxPositions: number;
  bid?: number;
  ask?: number;
  lastAction?: string;
}

async function secureAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try { return await SecureStore.isAvailableAsync(); } catch { return false; }
}

function normalizeUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) throw new Error('Adres MT5 Bridge musi zaczynać się od http:// lub https://.');
  return url;
}

export async function saveMt5BridgeConfig(config: Mt5BridgeConfig): Promise<Mt5BridgeConfig> {
  const normalized = { url: normalizeUrl(config.url), token: config.token.trim() };
  if (!normalized.token) throw new Error('Token MT5 Bridge jest wymagany.');
  if (await secureAvailable()) {
    await SecureStore.setItemAsync(URL_KEY, normalized.url);
    await SecureStore.setItemAsync(TOKEN_KEY, normalized.token);
  } else {
    memory[URL_KEY] = normalized.url;
    memory[TOKEN_KEY] = normalized.token;
  }
  return normalized;
}

export async function loadMt5BridgeConfig(): Promise<Mt5BridgeConfig | null> {
  try {
    if (await secureAvailable()) {
      const url = await SecureStore.getItemAsync(URL_KEY);
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      return url && token ? { url, token } : null;
    }
    return memory[URL_KEY] && memory[TOKEN_KEY] ? { url: memory[URL_KEY], token: memory[TOKEN_KEY] } : null;
  } catch { return null; }
}

export async function clearMt5BridgeConfig(): Promise<void> {
  if (await secureAvailable()) {
    await SecureStore.deleteItemAsync(URL_KEY);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
  delete memory[URL_KEY];
  delete memory[TOKEN_KEY];
}

async function bridgeFetch(config: Mt5BridgeConfig, path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
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

export async function fetchMt5Status(config: Mt5BridgeConfig): Promise<Mt5Status | null> {
  const response = await bridgeFetch(config, '/api/status');
  if (!response.ok) throw new Error(`MT5 Bridge HTTP ${response.status}`);
  const payload = await response.json() as { status?: Mt5Status | null };
  return payload.status || null;
}

export async function sendMt5Command(config: Mt5BridgeConfig, command: Mt5Command): Promise<void> {
  const response = await bridgeFetch(config, '/api/command', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
  if (!response.ok) throw new Error(`MT5 Bridge HTTP ${response.status}`);
}
