import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { fetchSpotMarketSnapshot } from '../api/bybit';

const TASK_NAME = 'smart-position-background-monitor-v1';
const POSITIONS_KEY = 'smart-position-background-positions-v1';
const ANDROID_CHANNEL = 'smart-position-monitor';
const TRAIL_ARM_MOVE_PCT = 0.18;
const TRAIL_DROP_PCT = 0.07;

export interface BackgroundSmartPosition {
  id: string;
  symbol: string;
  qty: number;
  costUsdt: number;
  entryPrice: number;
  peakMovePct: number;
}

async function readPositions(): Promise<BackgroundSmartPosition[]> {
  try {
    const raw = await SecureStore.getItemAsync(POSITIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BackgroundSmartPosition[];
    return Array.isArray(parsed) ? parsed.filter((item) => item.symbol && item.qty > 0 && item.entryPrice > 0) : [];
  } catch {
    return [];
  }
}

async function writePositions(positions: BackgroundSmartPosition[]): Promise<void> {
  await SecureStore.setItemAsync(POSITIONS_KEY, JSON.stringify(positions));
}

async function notifySellReady(symbol: string, movePct: number, pnlUsdt: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `SMART AUTO • SELL READY • ${symbol}`,
      body: `Pozycja jest na plusie: +${movePct.toFixed(3)}% • PnL +${pnlUsdt.toFixed(4)} USDT. Otwórz aplikację, aby potwierdzić SELL.`,
      sound: 'default',
    },
    trigger: null,
  });
}

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      const positions = await readPositions();
      if (!positions.length) return BackgroundFetch.BackgroundFetchResult.NoData;

      const refreshed: BackgroundSmartPosition[] = [];
      let notified = false;

      for (const position of positions) {
        try {
          const snapshot = await fetchSpotMarketSnapshot(position.symbol);
          const executablePrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
          const movePct = ((executablePrice - position.entryPrice) / position.entryPrice) * 100;
          const pnlUsdt = executablePrice * position.qty - position.costUsdt;
          const peakMovePct = Math.max(position.peakMovePct || 0, movePct);
          const pullbackPct = peakMovePct - movePct;
          const sellReady = peakMovePct >= TRAIL_ARM_MOVE_PCT && pullbackPct >= TRAIL_DROP_PCT && movePct > 0 && pnlUsdt > 0;

          refreshed.push({ ...position, peakMovePct });
          if (sellReady) {
            await notifySellReady(position.symbol, movePct, pnlUsdt);
            notified = true;
          }
        } catch {
          refreshed.push(position);
        }
      }

      await writePositions(refreshed);
      return notified ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function syncBackgroundSmartPositions(positions: BackgroundSmartPosition[]): Promise<void> {
  const clean = positions.map((item) => ({
    id: item.id,
    symbol: item.symbol,
    qty: item.qty,
    costUsdt: item.costUsdt,
    entryPrice: item.entryPrice,
    peakMovePct: item.peakMovePct,
  }));
  await writePositions(clean);

  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (!clean.length) {
    if (registered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
    return;
  }

  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Smart Auto Position Monitor',
    importance: Notifications.AndroidImportance.HIGH,
  });

  if (!registered) {
    await BackgroundFetch.registerTaskAsync(TASK_NAME, {
      minimumInterval: 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
}
