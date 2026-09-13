import React from 'react';
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
import { ConnectionState, WalletAccountResult } from '../api/types';
import { AccountSummary } from '../components/AccountSummary';
import { AssetRow } from '../components/AssetRow';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { filterNonZeroAssets, formatTime } from '../utils/format';

interface PortfolioScreenProps {
  account: WalletAccountResult | null;
  connectionState: ConnectionState;
  errorMessage: string | null;
  isRefreshing: boolean;
  lastRefreshTime: Date | null;
  autoRefreshEnabled: boolean;
  onRefresh: () => void;
  onToggleAutoRefresh: (enabled: boolean) => void;
}

export const PortfolioScreen: React.FC<PortfolioScreenProps> = ({
  account,
  connectionState,
  errorMessage,
  isRefreshing,
  lastRefreshTime,
  autoRefreshEnabled,
  onRefresh,
  onToggleAutoRefresh,
}) => {
  const nonZeroAssets = filterNonZeroAssets(account?.coin);

  return (
    <View style={styles.container}>
      <FlatList
        data={nonZeroAssets}
        keyExtractor={(item) => item.coin}
        renderItem={({ item }) => <AssetRow asset={item} />}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#F0B90B"
            colors={['#F0B90B']}
          />
        }
        ListHeaderComponent={
          <>
            {/* Screen Title */}
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Bybit Portfolio</Text>
              <TouchableOpacity
                style={styles.refreshIconButton}
                onPress={onRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color="#F0B90B" />
                ) : (
                  <Text style={styles.refreshIconText}>🔄 Odśwież</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Connection Status Banner */}
            <ConnectionStatus state={connectionState} errorMessage={errorMessage} />

            {/* Account Summary Card */}
            <AccountSummary account={account} />

            {/* Refresh Controls Bar */}
            <View style={styles.refreshControlBar}>
              <Text style={styles.lastRefreshText}>
                Ostatnie odświeżenie: {formatTime(lastRefreshTime)}
              </Text>

              <View style={styles.autoRefreshGroup}>
                <Text style={styles.autoRefreshLabel}>Auto-refresh (15s)</Text>
                <Switch
                  value={autoRefreshEnabled}
                  onValueChange={onToggleAutoRefresh}
                  trackColor={{ false: '#333333', true: '#F0B90B' }}
                  thumbColor={autoRefreshEnabled ? '#FFFFFF' : '#888888'}
                  style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                />
              </View>
            </View>

            {/* Assets Section Header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Aktywa na koncie</Text>
              <Text style={styles.sectionSubtitle}>
                {nonZeroAssets.length} {nonZeroAssets.length === 1 ? 'aktywum' : 'aktywów'}
              </Text>
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Brak aktywów z dodatnim saldem.</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 30,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 8,
  },
  headerTitle: {
    color: '#F0B90B',
    fontSize: 24,
    fontWeight: '800',
  },
  refreshIconButton: {
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333333',
  },
  refreshIconText: {
    color: '#F0B90B',
    fontSize: 13,
    fontWeight: '600',
  },
  refreshControlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  lastRefreshText: {
    color: '#8E8E93',
    fontSize: 12,
  },
  autoRefreshGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  autoRefreshLabel: {
    color: '#CCCCCC',
    fontSize: 12,
    marginRight: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: '#8E8E93',
    fontSize: 12,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#8E8E93',
    fontSize: 14,
  },
});
