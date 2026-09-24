import BackgroundService from 'react-native-background-actions';

type TradingEngine = 'happy-hour' | 'smart';

const activeEngines = new Set<TradingEngine>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const keepAliveTask = async ({ delay }: { delay: number }) => {
  while (BackgroundService.isRunning()) {
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

async function syncService(): Promise<void> {
  if (activeEngines.size > 0) {
    const names = Array.from(activeEngines).map((item) => item === 'happy-hour' ? 'Happy Hour' : 'SMART').join(' + ');
    if (!BackgroundService.isRunning()) {
      await BackgroundService.start(keepAliveTask, {
        ...options,
        taskDesc: `${names} pracuje w tle`,
      });
    } else {
      await BackgroundService.updateNotification({ taskDesc: `${names} pracuje w tle` });
    }
    return;
  }
  if (BackgroundService.isRunning()) await BackgroundService.stop();
}

export async function activateTradingEngine(engine: TradingEngine): Promise<void> {
  activeEngines.add(engine);
  try {
    await syncService();
  } catch (error) {
    activeEngines.delete(engine);
    throw error;
  }
}

export async function deactivateTradingEngine(engine: TradingEngine): Promise<void> {
  activeEngines.delete(engine);
  await syncService();
}

export function isTradingForegroundServiceRunning(): boolean {
  return BackgroundService.isRunning();
}
