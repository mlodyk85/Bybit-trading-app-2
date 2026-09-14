import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { scanSmartScores } from './smartScore';
import { loadMarketScopeConfig, MarketScopeConfig } from './marketScope';

const TASK_NAME = 'smart-market-background-monitor-v1';
const CONFIG_KEY = 'smart-background-monitor-config-v1';
const ANDROID_CHANNEL = 'smart-market-monitor';

export interface BackgroundMonitorConfig {
  enabled: boolean;
  minScore: number;
}

const defaultConfig: BackgroundMonitorConfig = { enabled: false, minScore: 80 };

async function readConfig(): Promise<BackgroundMonitorConfig> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw) as Partial<BackgroundMonitorConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      minScore: Math.max(60, Math.min(100, Number(parsed.minScore) || 80)),
    };
  } catch {
    return defaultConfig;
  }
}

async function notifyCandidate(symbol: string, score: number, details: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `SMART AUTO ${score}: ${symbol}`,
      body: `${details} • Otwórz aplikację, aby sprawdzić sygnał.`,
      sound: 'default',
    },
    trigger: null,
  });
}

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      const config = await readConfig();
      if (!config.enabled) return BackgroundFetch.BackgroundFetchResult.NoData;

      const marketConfig: MarketScopeConfig = await loadMarketScopeConfig();
      const rows = await scanSmartScores({ limit: 12, scope: marketConfig.scope, customSymbols: marketConfig.customSymbols });
      const best = rows[0];
      if (!best || best.score < config.minScore) return BackgroundFetch.BackgroundFetchResult.NoData;

      await notifyCandidate(
        best.symbol,
        best.score,
        `${best.label} • 1m ${best.momentum1mPct >= 0 ? '+' : ''}${best.momentum1mPct.toFixed(2)}% • 5m ${best.momentum5mPct >= 0 ? '+' : ''}${best.momentum5mPct.toFixed(2)}% • 15m ${best.momentum15mPct >= 0 ? '+' : ''}${best.momentum15mPct.toFixed(2)}%`
      );
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function getBackgroundMonitorConfig(): Promise<BackgroundMonitorConfig> {
  return await readConfig();
}

export async function enableBackgroundMarketMonitor(minScore = 80): Promise<void> {
  const score = Math.max(60, Math.min(100, Math.round(minScore || 80)));
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Brak zgody na powiadomienia.');

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Smart Auto — monitor rynku',
    importance: Notifications.AndroidImportance.HIGH,
  });

  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify({ enabled: true, minScore: score }));
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (registered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);

  await BackgroundFetch.registerTaskAsync(TASK_NAME, {
    minimumInterval: 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function disableBackgroundMarketMonitor(): Promise<void> {
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify({ enabled: false, minScore: 80 }));
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (registered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
}
