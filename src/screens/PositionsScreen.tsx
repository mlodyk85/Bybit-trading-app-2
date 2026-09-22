import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  fetchSpotExecutions,
  fetchSpotMarketSnapshot,
  fetchSpotOpenOrders,
} from '../api/bybit';
import {
  ApiCredentials,
  Position,
  SpotExecution,
  SpotOpenOrder,
  WalletAccountResult,
} from '../api/types';
import { PositionCard } from '../components/PositionCard';

interface PositionsScreenProps {
  credentials: ApiCredentials;
  positions: Position[];
  account: WalletAccountResult | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

const formatPrice = (value?: number) => {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value);
  return n >= 1000 ? n.toFixed(2) : n >= 1 ? n.toFixed(5) : n.toFixed(8);
};

export const PositionsScreen: React.FC<PositionsScreenProps> = ({
  credentials,
  positions,
  account,
  isRefreshing,
  onRefresh,
}) => {
  const [executions, setExecutions] = useState<SpotExecution[]>([]);
  const [openOrders, setOpenOrders] = useState<SpotOpenOrder[]>([]);
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const [spotLoading, setSpotLoading] = useState(false);

  const spotAssets = useMemo(
    () => (account?.coin || [])
      .filter((coin) => coin.coin !== 'USDT' && Number(coin.walletBalance) > 0 && Number(coin.usdValue) > 0.01)
      .sort((a, b) => Number(b.usdValue) - Number(a.usdValue)),
    [account]
  );

  const loadSpotDetails = useCallback(async () => {
    setSpotLoading(true);
    try {
      const [history, orders] = await Promise.all([
        fetchSpotExecutions(credentials, 100),
        fetchSpotOpenOrders(credentials, 50),
      ]);
      setExecutions(history);
      setOpenOrders(orders);

      const symbols = Array.from(new Set([
        ...spotAssets.map((coin) => `${coin.coin.toUpperCase()}USDT`),
        ...orders.map((order) => order.symbol.toUpperCase()),
      ]));
      const snapshots = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const snap = await fetchSpotMarketSnapshot(symbol);
            return [symbol, snap.lastPrice] as const;
          } catch {
            return [symbol, NaN] as const;
          }
        })
      );
      setMarketPrices(Object.fromEntries(snapshots));
    } catch {
      // Salda/Futures pozostają widoczne nawet przy chwilowym błędzie historii Spot.
    } finally {
      setSpotLoading(false);
    }
  }, [credentials, spotAssets]);

  useEffect(() => { void loadSpotDetails(); }, [loadSpotDetails]);

  const refreshAll = async () => {
    onRefresh();
    await loadSpotDetails();
  };

  const buyPriceFor = (symbol: string): number | undefined => {
    const row = executions
      .filter((item) => item.symbol.toUpperCase() === symbol && item.side === 'Buy')
      .sort((a, b) => Number(b.execTime) - Number(a.execTime))[0];
    const price = row ? Number(row.execPrice) : NaN;
    return Number.isFinite(price) && price > 0 ? price : undefined;
  };

  const sellOrders = openOrders.filter((order) => order.side === 'Sell');

  return (
    <View style={styles.container}>
      <FlatList
        data={positions}
        keyExtractor={(item) => `${item.category}-${item.symbol}-${item.side}`}
        renderItem={({ item }) => <PositionCard position={item} />}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing || spotLoading}
            onRefresh={refreshAll}
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
                  Spot: {spotAssets.length} • SELL: {sellOrders.length} • Futures: {positions.length}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={refreshAll}
                disabled={isRefreshing || spotLoading}
              >
                {isRefreshing || spotLoading ? (
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
              spotAssets.map((coin) => {
                const symbol = `${coin.coin.toUpperCase()}USDT`;
                const buyPrice = buyPriceFor(symbol);
                const currentPrice = marketPrices[symbol];
                const relatedSell = sellOrders.find((order) => order.symbol.toUpperCase() === symbol);
                return (
                  <View key={coin.coin} style={styles.spotCard}>
                    <View style={styles.spotTopRow}>
                      <View>
                        <Text style={styles.spotCoin}>{coin.coin}</Text>
                        <Text style={styles.spotLabel}>Saldo: {coin.walletBalance}</Text>
                        <Text style={styles.spotLabel}>Dostępne: {coin.free || coin.walletBalance}</Text>
                      </View>
                      <View style={styles.spotRight}>
                        <Text style={styles.spotValue}>{Number(coin.usdValue).toFixed(2)} USD</Text>
                        {relatedSell && <Text style={styles.orderBadge}>SELL GTC aktywny</Text>}
                      </View>
                    </View>
                    <View style={styles.priceGrid}>
                      <View style={styles.priceCell}>
                        <Text style={styles.priceLabel}>Cena zakupu</Text>
                        <Text style={styles.buyPrice}>{formatPrice(buyPrice)}</Text>
                      </View>
                      <View style={styles.priceCellRight}>
                        <Text style={styles.priceLabel}>Cena aktualna</Text>
                        <Text style={styles.currentPrice}>{formatPrice(currentPrice)}</Text>
                      </View>
                    </View>
                    {relatedSell && (
                      <View style={styles.orderLine}>
                        <Text style={styles.orderText}>SELL {relatedSell.qty} @ {formatPrice(Number(relatedSell.price))}</Text>
                        <Text style={styles.orderStatus}>{relatedSell.orderStatus}</Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}

            <Text style={[styles.sectionTitle, styles.derivativesTitle]}>Spot / otwarte zlecenia SELL</Text>
            {sellOrders.length === 0 ? (
              <View style={styles.emptyContainerSmall}>
                <Text style={styles.emptySubtitle}>Brak aktywnych zleceń SELL Spot na Bybit.</Text>
              </View>
            ) : sellOrders.map((order) => (
              <View key={order.orderId} style={styles.orderCard}>
                <View>
                  <Text style={styles.orderSymbol}>{order.symbol}</Text>
                  <Text style={styles.spotLabel}>Ilość: {order.qty} • wykonano: {order.cumExecQty || '0'}</Text>
                </View>
                <View style={styles.spotRight}>
                  <Text style={styles.sellPrice}>SELL @ {formatPrice(Number(order.price))}</Text>
                  <Text style={styles.orderStatus}>{order.orderStatus}</Text>
                </View>
              </View>
            ))}

            <Text style={[styles.sectionTitle, styles.derivativesTitle]}>Futures / pozycje otwarte</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Brak otwartych pozycji Futures</Text>
            <Text style={styles.emptySubtitle}>
              Aktywa Spot i aktywne zlecenia SELL są pokazane wyżej.
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  scrollContent: { padding: 16, paddingBottom: 30 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 8 },
  headerTitle: { color: '#F0B90B', fontSize: 24, fontWeight: '800' },
  headerSubtitle: { color: '#8E8E93', fontSize: 12, marginTop: 2 },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  derivativesTitle: { marginTop: 18 },
  refreshButton: { backgroundColor: '#1E1E1E', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#333333' },
  refreshButtonText: { color: '#F0B90B', fontSize: 13, fontWeight: '600' },
  spotCard: { backgroundColor: '#1E1E1E', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#2A2A2A' },
  spotTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  spotCoin: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  spotValue: { color: '#F0B90B', fontSize: 16, fontWeight: '700' },
  spotLabel: { color: '#8E8E93', fontSize: 12, marginTop: 4 },
  spotRight: { alignItems: 'flex-end' },
  priceGrid: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333333', marginTop: 10, paddingTop: 9 },
  priceCell: { flex: 1 },
  priceCellRight: { flex: 1, alignItems: 'flex-end' },
  priceLabel: { color: '#77777D', fontSize: 10 },
  buyPrice: { color: '#22C55E', fontSize: 13, fontWeight: '700', marginTop: 3 },
  currentPrice: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginTop: 3 },
  orderBadge: { color: '#22C55E', fontSize: 10, fontWeight: '800', marginTop: 4 },
  orderLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 9, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333333' },
  orderText: { color: '#F0B90B', fontSize: 11, fontWeight: '700' },
  orderStatus: { color: '#22C55E', fontSize: 10, fontWeight: '700' },
  orderCard: { backgroundColor: '#1A1A1A', borderRadius: 9, padding: 12, marginBottom: 7, borderWidth: 1, borderColor: '#2A2A2A', flexDirection: 'row', justifyContent: 'space-between' },
  orderSymbol: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  sellPrice: { color: '#F0B90B', fontSize: 12, fontWeight: '800' },
  emptyContainerSmall: { backgroundColor: '#1E1E1E', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#2A2A2A' },
  emptyContainer: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 32, alignItems: 'center', marginVertical: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  emptyTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: '#8E8E93', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
