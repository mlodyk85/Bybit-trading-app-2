import * as SecureStore from 'expo-secure-store';

const KEY = 'trading-engine-state-v2';

export type EngineMode = 'happy-hour' | 'smart';

export interface EngineTelemetry {
  enabled: boolean;
  mode: EngineMode;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
  lastScanAt: number | null;
  scans: number;
  candidates: number;
  buys: number;
  sells: number;
  rejected: number;
  lastDecision: string;
  lastError: string;
}

const initial = (mode: EngineMode): EngineTelemetry => ({
  enabled: false,
  mode,
  startedAt: null,
  lastHeartbeatAt: null,
  lastScanAt: null,
  scans: 0,
  candidates: 0,
  buys: 0,
  sells: 0,
  rejected: 0,
  lastDecision: 'Silnik nieuruchomiony',
  lastError: '',
});

export async function loadEngineTelemetry(mode: EngineMode): Promise<EngineTelemetry> {
  try {
    const raw = await SecureStore.getItemAsync(KEY + ':' + mode);
    if (!raw) return initial(mode);
    return { ...initial(mode), ...(JSON.parse(raw) as Partial<EngineTelemetry>), mode };
  } catch {
    return initial(mode);
  }
}

export async function saveEngineTelemetry(value: EngineTelemetry): Promise<void> {
  await SecureStore.setItemAsync(KEY + ':' + value.mode, JSON.stringify(value));
}

export async function patchEngineTelemetry(
  mode: EngineMode,
  patch: Partial<EngineTelemetry>
): Promise<EngineTelemetry> {
  const current = await loadEngineTelemetry(mode);
  const next: EngineTelemetry = {
    ...current,
    ...patch,
    mode,
    lastHeartbeatAt: Date.now(),
  };
  await saveEngineTelemetry(next);
  return next;
}

export async function recordScan(mode: EngineMode, candidates: number, decision: string): Promise<EngineTelemetry> {
  const current = await loadEngineTelemetry(mode);
  return patchEngineTelemetry(mode, {
    scans: current.scans + 1,
    candidates: current.candidates + Math.max(0, candidates),
    lastScanAt: Date.now(),
    lastDecision: decision,
  });
}

export async function recordOrder(mode: EngineMode, side: 'Buy' | 'Sell', decision: string): Promise<EngineTelemetry> {
  const current = await loadEngineTelemetry(mode);
  return patchEngineTelemetry(mode, {
    buys: current.buys + (side === 'Buy' ? 1 : 0),
    sells: current.sells + (side === 'Sell' ? 1 : 0),
    lastDecision: decision,
    lastError: '',
  });
}

export async function recordReject(mode: EngineMode, reason: string): Promise<EngineTelemetry> {
  const current = await loadEngineTelemetry(mode);
  return patchEngineTelemetry(mode, {
    rejected: current.rejected + 1,
    lastDecision: reason,
  });
}

export async function recordEngineError(mode: EngineMode, error: string): Promise<EngineTelemetry> {
  return patchEngineTelemetry(mode, { lastError: error, lastDecision: 'Błąd silnika: ' + error });
}

export async function setEngineEnabled(mode: EngineMode, enabled: boolean): Promise<EngineTelemetry> {
  return patchEngineTelemetry(mode, {
    enabled,
    startedAt: enabled ? Date.now() : null,
    lastDecision: enabled ? 'Silnik uruchomiony' : 'Silnik zatrzymany',
    lastError: '',
  });
}
