import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { cancelSpotOrder, fetchSpotExecutions, fetchSpotOpenOrders } from '../api/bybit';
import { ApiCredentials, ConnectionState, SpotExecution, WalletAccountResult } from '../api/types';
import { AccountSummary } from '../components/AccountSummary';
import { AssetRow, AssetSmartAutoSeed } from '../components/AssetRow';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { filterNonZeroAssets, formatTime } from '../utils/format';
import { loadSellLockedSymbols, setCoinSellLocked } from '../services/tradingPreferences';

interface PortfolioScreenProps {
  credentials: ApiCredentials;
  account: WalletAccountResult | null;
  connectionState: ConnectionState;
  errorMessage: string | null;
  isRefreshing: boolean;
  lastRefreshTime: Date | null;
  autoRefreshEnabled: boolean;
  onRefresh: () => void;
  onToggleAutoRefresh: (enabled: boolean) => void;
  onOpenSmartAuto: (seed: AssetSmartAutoSeed) => void;
}

export const PortfolioScreen: React.FC<PortfolioScreenProps> = ({
  credentials,
  account,
  connectionState,
  errorMessage,
  isRefreshing,
  lastRefreshTime,
  autoRefreshEnabled,
  onRefresh,
  onToggleAutoRefresh,
  onOpenSmartAuto,
}) => {
  const nonZeroAssets = filterNonZeroAssets(account?.coin);
  const [executions, setExecutions] = useState<SpotExecution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sellLockedSymbols, setSellLockedSymbols] = useState<string[]>([]);

  const loadExecutions = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setExecutions(await fetchSpotExecutions(credentials, 100));
    } catch {
      // Portfel nadal działa, nawet gdy historia Spot jest chwilowo niedostępna.
    } finally {
      setHistoryLoading(false);
    }
  }, [credentials]);

  useEffect(() => { void loadExecutions(); }, [loadExecutions]);
  useEffect(() => { void loadSellLockedSymbols().then(setSellLockedSymbols); }, []);

  const toggleSellLock = useCallback(async (symbol: string, locked: boolean) => {
    const next = await setCoinSellLocked(symbol, locked);
    setSellLockedSymbols(next);

    if (locked) {
      try {
        const openOrders = await fetchSpotOpenOrders(credentials, 50);
        const targets = openOrders.filter((order) => order.symbol.toUpperCase() === symbol.toUpperCase() && order.side === 'Sell');
        for (const order of targets) {
          try { await cancelSpotOrder(credentials, order.symbol, order.orderId); }
          catch { /* Zlecenie mogło zostać wykonane/anulowane pomiędzy odczytem i anulowaniem. */ }
        }
      } catch {
        // Blokada lokalna pozostaje aktywna nawet przy chwilowym błędzie pobrania zleceń.
      }
    }
  }, [credentials]);

  const refreshAll = () => {
    onRefresh();
    void loadExecutions();
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={nonZeroAssets}
        keyExtractor={(item) => item.coin}
        renderItem={({ item }) => {
          const itemSymbol = `${item.coin.toUpperCase()}USDT`;
          return <AssetRow
            asset={item}
            executions={executions}
            onOpenTrade={onOpenSmartAuto}
            sellLocked={sellLockedSymbols.includes(itemSymbol)}
            onToggleSellLock={(symbol, locked) => void toggleSellLock(symbol, locked)}
          />;
        }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefreshing || historyLoading} onRefresh={refreshAll} tintColor="#F0B90B" colors={['#F0B90B']} />}
        ListHeaderComponent={<>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Portfel</Text>
            <TouchableOpacity style={styles.refreshIconButton} onPress={refreshAll} disabled={isRefreshing || historyLoading}>
              {isRefreshing || historyLoading ? <ActivityIndicator size="small" color="#F0B90B" /> : <Text style={styles.refreshIconText}>🔄 Odśwież</Text>}
            </TouchableOpacity>
          </View>
          <ConnectionStatus state={connectionState} errorMessage={errorMessage} />
          <AccountSummary account={account} />
          <View style={styles.refreshControlBar}>
            <Text style={styles.lastRefreshText}>Ostatnie odświeżenie: {formatTime(lastRefreshTime)}</Text>
            <View style={styles.autoRefreshGroup}><Text style={styles.autoRefreshLabel}>Auto-refresh</Text><Switch value={autoRefreshEnabled} onValueChange={onToggleAutoRefresh} trackColor={{ false: '#333333', true: '#F0B90B' }} thumbColor={autoRefreshEnabled ? '#FFFFFF' : '#888888'} style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }} /></View>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Smart Accumulate — każde aktywo</Text>
            <Text style={styles.infoText}>Każdy coin z portfela może być zarządzany niezależnie. Użyj „BLOKUJ SELL”, aby SMART nie mógł wystawiać ani wykonywać automatycznej sprzedaży wybranego coina. Blokada jest zapamiętywana po restarcie aplikacji.</Text>
          </View>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Aktywa na koncie</Text><Text style={styles.sectionSubtitle}>{nonZeroAssets.length} {nonZeroAssets.length === 1 ? 'aktywum' : 'aktywów'}</Text></View>
        </>}
        ListEmptyComponent={<View style={styles.emptyContainer}><Text style={styles.emptyText}>Brak aktywów z dodatnim saldem.</Text></View>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  scrollContent: { padding: 16, paddingBottom: 30 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 8 },
  headerTitle: { color: '#F0B90B', fontSize: 24, fontWeight: '800' },
  refreshIconButton: { backgroundColor: '#1E1E1E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#333333' },
  refreshIconText: { color: '#F0B90B', fontSize: 13, fontWeight: '600' },
  refreshControlBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8, borderWidth: 1, borderColor: '#2A2A2A' },
  lastRefreshText: { color: '#8E8E93', fontSize: 12 },
  autoRefreshGroup: { flexDirection: 'row', alignItems: 'center' },
  autoRefreshLabel: { color: '#CCCCCC', fontSize: 12, marginRight: 4 },
  infoBox: { backgroundColor: '#191919', borderWidth: 1, borderColor: '#F0B90B', borderRadius: 8, padding: 10, marginTop: 8 },
  infoTitle: { color: '#F0B90B', fontSize: 12, fontWeight: '800' },
  infoText: { color: '#B8B8BC', fontSize: 11, lineHeight: 16, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 },
  sectionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  sectionSubtitle: { color: '#8E8E93', fontSize: 12 },
  emptyContainer: { padding: 24, alignItems: 'center' },
  emptyText: { color: '#8E8E93', fontSize: 14 },
});