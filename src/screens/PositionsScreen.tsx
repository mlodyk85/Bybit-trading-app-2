import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Position, WalletAccountResult } from '../api/types';
import { PositionCard } from '../components/PositionCard';

interface PositionsScreenProps {
  positions: Position[];
  account: WalletAccountResult | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export const PositionsScreen: React.FC<PositionsScreenProps> = ({
  positions,
  account,
  isRefreshing,
  onRefresh,
}) => {
  const spotAssets = (account?.coin || [])
    .filter((coin) => coin.coin !== 'USDT' && Number(coin.walletBalance) > 0 && Number(coin.usdValue) > 0.01)
    .sort((a, b) => Number(b.usdValue) - Number(a.usdValue));

  return (
    <View style={styles.container}>
      <FlatList
        data={positions}
        keyExtractor={(item) => `${item.category}-${item.symbol}-${item.side}`}
        renderItem={({ item }) => <PositionCard position={item} />}
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
          <View>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.headerTitle}>Pozycje i aktywa</Text>
                <Text style={styles.headerSubtitle}>
                  Spot: {spotAssets.length} • Futures: {positions.length}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={onRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color="#F0B90B" />
                ) : (
                  <Text style={styles.refreshButtonText}>🔄 Odśwież</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Spot</Text>
            {spotAssets.length === 0 ? (
              <View style={styles.emptyContainerSmall}>
                <Text style={styles.emptySubtitle}>Brak aktywów Spot o wartości powyżej 0,01 USD.</Text>
              </View>
            ) : (
              spotAssets.map((coin) => (
                <View key={coin.coin} style={styles.spotCard}>
                  <View>
                    <Text style={styles.spotCoin}>{coin.coin}</Text>
                    <Text style={styles.spotLabel}>Saldo: {coin.walletBalance}</Text>
                  </View>
                  <View style={styles.spotRight}>
                    <Text style={styles.spotValue}>{Number(coin.usdValue).toFixed(2)} USD</Text>
                    <Text style={styles.spotLabel}>Dostępne: {coin.free || coin.walletBalance}</Text>
                  </View>
                </View>
              ))
            )}

            <Text style={[styles.sectionTitle, styles.derivativesTitle]}>Futures / pozycje otwarte</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Brak otwartych pozycji Futures</Text>
            <Text style={styles.emptySubtitle}>
              To nie oznacza braku aktywów Spot. Salda Spot są pokazane wyżej.
            </Text>
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
    marginBottom: 16,
    marginTop: 8,
  },
  headerTitle: {
    color: '#F0B90B',
    fontSize: 24,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  derivativesTitle: {
    marginTop: 18,
  },
  refreshButton: {
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333333',
  },
  refreshButtonText: {
    color: '#F0B90B',
    fontSize: 13,
    fontWeight: '600',
  },
  spotCard: {
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  spotCoin: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  spotValue: {
    color: '#F0B90B',
    fontSize: 16,
    fontWeight: '700',
  },
  spotLabel: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 4,
  },
  spotRight: {
    alignItems: 'flex-end',
  },
  emptyContainerSmall: {
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  emptyContainer: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#8E8E93',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
