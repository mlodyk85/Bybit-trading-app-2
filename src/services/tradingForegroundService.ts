import BackgroundService from 'react-native-background-actions';

type TradingEngine = 'happy-hour' | 'smart';

type BackgroundServiceLike = {
  isRunning?: () => boolean;
  start?: (task: (taskData?: { delay: number }) => Promise<void>, options: Record<string, unknown>) => Promise<void>;
  stop?: () => Promise<void>;
  updateNotification?: (options: Record<string, unknown>) => Promise<void>;
};

const service = (BackgroundService ?? null) as BackgroundServiceLike | null;
const activeEngines = new Set<TradingEngine>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function serviceAvailable(): boolean {
  return Boolean(
    service
    && typeof service.isRunning === 'function'
    && typeof service.start === 'function'
    && typeof service.stop === 'function'
  );
}

function serviceIsRunning(): boolean {
  if (!serviceAvailable()) return false;
  try {
    return Boolean(service?.isRunning?.());
  } catch {
    return false;
  }
}

const keepAliveTask = async (taskData?: { delay: number }) => {
  const delay = taskData?.delay ?? 15000;
  while (serviceIsRunning()) {
    await sleep(delay);
  }
};

const options = {
  taskName: 'BybitTrading',
  taskTitle: 'Bybit Trading — handel aktywny',
  taskDesc: 'Happy Hour / SMART pracuje w tle',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  parameters: { delay: 15000 },
};

async function syncService(): Promise<boolean> {
  // Some Expo/RN builds expose the JS package while its native module is null.
  // Treat that as "foreground helper unavailable" instead of throwing and breaking trading.
  if (!serviceAvailable()) return false;

  if (activeEngines.size > 0) {
    const names = Array.from(activeEngines).map((item) => item === 'happy-hour' ? 'Happy Hour' : 'SMART').join(' + ');
    if (!serviceIsRunning()) {
      await service?.start?.(keepAliveTask, {
        ...options,
        taskDesc: `${names} pracuje w tle`,
      });
    } else if (typeof service?.updateNotification === 'function') {
      await service.updateNotification({ taskDesc: `${names} pracuje w tle` });
    }
    return true;
  }

  if (serviceIsRunning()) await service?.stop?.();
  return true;
}

export async function activateTradingEngine(engine: TradingEngine): Promise<boolean> {
  activeEngines.add(engine);
  try {
    return await syncService();
  } catch {
    // The trading loop itself must remain alive in the app even if Android rejects
    // the foreground helper. Do not surface a fatal error for an optional helper.
    return false;
  }
}

export async function deactivateTradingEngine(engine: TradingEngine): Promise<boolean> {
  activeEngines.delete(engine);
  try {
    return await syncService();
  } catch {
    return false;
  }
}

export function isTradingForegroundServiceRunning(): boolean {
  return serviceIsRunning();
}

export function isTradingForegroundServiceAvailable(): boolean {
  return serviceAvailable();
}
