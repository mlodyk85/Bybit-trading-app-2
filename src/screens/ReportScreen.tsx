import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { fetchSpotExecutions } from '../api/bybit';
import { ApiCredentials, SpotExecution } from '../api/types';

interface Props {
  credentials: ApiCredentials;
}

function formatTime(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return new Date(n).toLocaleString('pl-PL');
}

export const ReportScreen: React.FC<Props> = ({ credentials }) => {
  const [rows, setRows] = useState<SpotExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      setRows(await fetchSpotExecutions(credentials, 50));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać raportu.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [credentials]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#F0B90B" />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Raport transakcji</Text>
            <Text style={styles.subtitle}>Ostatnie wykonania Spot z Bybit</Text>
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={() => void load(true)}>
            <Text style={styles.refreshText}>Odśwież</Text>
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator size="large" color="#F0B90B" style={styles.loader} />}
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && rows.length === 0 && <Text style={styles.empty}>Brak wykonanych transakcji Spot.</Text>}

        {rows.map((item) => {
          const isBuy = item.side === 'Buy';
          return (
            <View key={`${item.execId}-${item.orderId}`} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={[styles.side, isBuy ? styles.buy : styles.sell]}>{item.side.toUpperCase()}</Text>
              </View>
              <Text style={styles.line}>Czas: {formatTime(item.execTime)}</Text>
              <Text style={styles.line}>Cena: {item.execPrice}</Text>
              <Text style={styles.line}>Ilość: {item.execQty}</Text>
              <Text style={styles.line}>Wartość: {item.execValue}</Text>
              <Text style={styles.line}>Fee: {item.execFee}</Text>
              <Text style={styles.orderId}>Order ID: {item.orderId}</Text>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  container: { padding: 18, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  subtitle: { color: '#8E8E93', marginTop: 4 },
  refreshButton: { backgroundColor: '#242424', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  refreshText: { color: '#F0B90B', fontWeight: '700' },
  loader: { marginTop: 30 },
  error: { color: '#FF6B6B', marginTop: 20 },
  empty: { color: '#8E8E93', marginTop: 24 },
  card: { backgroundColor: '#1E1E1E', borderRadius: 14, padding: 14, marginTop: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  symbol: { color: '#fff', fontSize: 17, fontWeight: '700' },
  side: { fontWeight: '800', fontSize: 13 },
  buy: { color: '#22C55E' },
  sell: { color: '#EF4444' },
  line: { color: '#D4D4D8', marginTop: 4 },
  orderId: { color: '#76767A', fontSize: 11, marginTop: 8 },
});
