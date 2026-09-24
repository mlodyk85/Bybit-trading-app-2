import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchInversePositions,
  fetchLinearPositions,
  fetchWalletBalance,
  testBybitConnection,
} from '../api/bybit';
import {
  ApiCredentials,
  ConnectionState,
  Position,
  WalletAccountResult,
} from '../api/types';
import {
  deleteCredentials,
  getCredentials,
  saveCredentials,
} from '../storage/secureStorage';

export type AutoRefreshInterval = 15 | 30 | 60;

export interface UseBybitAccountReturn {
  credentials: ApiCredentials | null;
  account: WalletAccountResult | null;
  positions: Position[];
  connectionState: ConnectionState;
  errorMessage: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  lastRefreshTime: Date | null;
  autoRefreshEnabled: boolean;
  autoRefreshInterval: AutoRefreshInterval;
  setAutoRefreshEnabled: (enabled: boolean) => void;
  setAutoRefreshInterval: (interval: AutoRefreshInterval) => void;
  connect: (apiKey: string, apiSecret: string, remember?: boolean) => Promise<boolean>;
  testConnection: (apiKey: string, apiSecret: string) => Promise<{ success: boolean; message: string }>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useBybitAccount(): UseBybitAccountReturn {
  const [credentials, setCredentials] = useState<ApiCredentials | null>(null);
  const [account, setAccount] = useState<WalletAccountResult | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState<boolean>(true);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<AutoRefreshInterval>(15);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load credentials on startup
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      const saved = await getCredentials();
      if (saved && saved.apiKey && saved.apiSecret) {
        setCredentials(saved);
      } else {
        setConnectionState('disconnected');
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const fetchData = useCallback(
    async (creds: ApiCredentials, isManual = false) => {
      if (isManual) {
        setIsRefreshing(true);
      }
      setErrorMessage(null);

      try {
        const [walletResult, linearPos, inversePos] = await Promise.all([
          fetchWalletBalance(creds),
          fetchLinearPositions(creds),
          fetchInversePositions(creds),
        ]);

        setAccount(walletResult);
        setPositions([...linearPos, ...inversePos]);
        setConnectionState('connected');
        setLastRefreshTime(new Date());
      } catch (err: unknown) {
        setConnectionState('error');
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg || 'Błąd komunikacji z Bybit.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  // Trigger initial fetch when credentials are established
  useEffect(() => {
    if (credentials) {
      fetchData(credentials);
    }
  }, [credentials, fetchData]);

  // Setup auto-refresh timer
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (autoRefreshEnabled && credentials && connectionState === 'connected') {
      intervalRef.current = setInterval(() => {
        fetchData(credentials);
      }, autoRefreshInterval * 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefreshEnabled, autoRefreshInterval, credentials, connectionState, fetchData]);

  const connect = async (apiKey: string, apiSecret: string, remember = true): Promise<boolean> => {
    setIsLoading(true);
    setErrorMessage(null);
    setConnectionState('connecting');

    const creds: ApiCredentials = { apiKey, apiSecret };

    try {
      await saveCredentials(apiKey, apiSecret, remember);
      setCredentials(creds);
      await fetchData(creds);
      return true;
    } catch (err: unknown) {
      setConnectionState('error');
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || 'Nie udało się nawiązać połączenia.');
      setIsLoading(false);
      return false;
    }
  };

  const testConnection = async (
    apiKey: string,
    apiSecret: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      await testBybitConnection({ apiKey, apiSecret });
      return { success: true, message: 'Połączenie z Bybit udane! Klucz API działa poprawnie.' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: msg || 'Test połączenia nie powiódł się.',
      };
    }
  };

  const disconnect = async (): Promise<void> => {
    await deleteCredentials();
    setCredentials(null);
    setAccount(null);
    setPositions([]);
    setConnectionState('disconnected');
    setErrorMessage(null);
  };

  const refresh = async (): Promise<void> => {
    if (credentials) {
      await fetchData(credentials, true);
    }
  };

  return {
    credentials,
    account,
    positions,
    connectionState,
    errorMessage,
    isLoading,
    isRefreshing,
    lastRefreshTime,
    autoRefreshEnabled,
    autoRefreshInterval,
    setAutoRefreshEnabled,
    setAutoRefreshInterval,
    connect,
    testConnection,
    disconnect,
    refresh,
  };
}
