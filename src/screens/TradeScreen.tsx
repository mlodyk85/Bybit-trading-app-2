import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ApiCredentials, TradeAck } from '../api/types';
import {
  fetchSpotUsdtSymbols,
  MAX_SPOT_ORDER_USDT,
  placeSpotMarketOrder,
} from '../api/bybit';

interface Props {
  credentials: ApiCredentials;
}

const FALLBACK_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'PEPEUSDT',
  'SUIUSDT',
  'LINKUSDT',
  'AVAXUSDT',
];

export const TradeScreen: React.FC<Props> = ({ credentials }) => {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [lastAck, setLastAck] = useState<TradeAck | null>(null);
  const [error, setError] = useState('');
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [pairs, setPairs] = useState<string[]>(FALLBACK_SYMBOLS);
  const [pairsLoading, setPairsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadPairs = async () => {
      try {
        const result = await fetchSpotUsdtSymbols();
        if (active && result.length > 0) setPairs(result);
      } catch {
        // Fallback list remains available if Bybit public market endpoint is temporarily unavailable.
      } finally {
        if (active) setPairsLoading(false);
      }
    };
    void loadPairs();
    return () => {
      active = false;
    };
  }, []);

  const filteredPairs = useMemo(() => {
    const q = pairSearch.trim().toUpperCase();
    if (!q) return pairs;
    return pairs.filter((item) => item.includes(q));
  }, [pairSearch, pairs]);

  const selectPair = (nextSymbol: string) => {
    setSymbol(nextSymbol);
    setPairSearch('');
    setPairPickerOpen(false);
    setError('');
  };

  const submit = (side: 'Buy' | 'Sell') => {
    const parsed = Number(amount.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_SPOT_ORDER_USDT) {
      setError(`Kwota musi być większa od 0 i nie większa niż ${MAX_SPOT_ORDER_USDT} USDT.`);
      return;
    }

    const cleanSymbol = symbol.trim().toUpperCase();
    Alert.alert(
      side === 'Buy' ? 'Potwierdź zakup' : 'Potwierdź sprzedaż',
      `${side === 'Buy' ? 'BUY' : 'SELL'} ${cleanSymbol} za ${parsed.toFixed(2)} USDT?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wykonaj',
          style: side === 'Sell' ? 'destructive' : 'default',
          onPress: async () => {
            setBusy(true);
            setError('');
            try {
              const ack = await placeSpotMarketOrder(credentials, cleanSymbol, side, parsed);
              setLastAck(ack);
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Nie udało się wysłać zlecenia.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Trading Spot</Text>
        <Text style={styles.subtitle}>Ręczne zlecenia Market • twardy limit {MAX_SPOT_ORDER_USDT} USDT</Text>

        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Klucz API musi mieć uprawnienie Spot Trade. Wypłaty powinny pozostać wyłączone.
          </Text>
        </View>

        <Text style={styles.label}>Para</Text>
        <TouchableOpacity style={styles.pairSelector} onPress={() => setPairPickerOpen(true)}>
          <View>
            <Text style={styles.pairSelectorValue}>{symbol}</Text>
            <Text style={styles.pairSelectorHint}>Dotknij, aby wybrać parę z Bybit</Text>
          </View>
          <Text style={styles.pairSelectorArrow}>⌄</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Wartość transakcji (USDT)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="5.00"
          placeholderTextColor="#6E6E73"
          style={styles.input}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.row}>
          <TouchableOpacity disabled={busy} style={[styles.button, styles.buy]} onPress={() => submit('Buy')}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>BUY</Text>}
          </TouchableOpacity>
          <TouchableOpacity disabled={busy} style={[styles.button, styles.sell]} onPress={() => submit('Sell')}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>SELL</Text>}
          </TouchableOpacity>
        </View>

        {lastAck && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ostatnie zlecenie przyjęte przez Bybit</Text>
            <Text style={styles.line}>{lastAck.side} {lastAck.symbol}</Text>
            <Text style={styles.line}>Wartość: {lastAck.quoteAmountUsdt.toFixed(2)} USDT</Text>
            <Text style={styles.line}>Order ID: {lastAck.orderId}</Text>
            <Text style={styles.line}>Round-trip API: {lastAck.requestLatencyMs} ms</Text>
            <Text style={styles.note}>Przyjęcie zlecenia nie oznacza jeszcze pełnego wykonania. Sprawdź zakładkę Raport.</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={pairPickerOpen} animationType="slide" transparent onRequestClose={() => setPairPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Wybierz parę Spot</Text>
                <Text style={styles.modalSubtitle}>Aktywne pary USDT dostępne na Bybit</Text>
              </View>
              <TouchableOpacity onPress={() => setPairPickerOpen(false)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              value={pairSearch}
              onChangeText={setPairSearch}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Szukaj, np. BTC, ETH, VELO..."
              placeholderTextColor="#6E6E73"
              style={styles.searchInput}
            />

            {pairsLoading && (
              <View style={styles.loadingPairs}>
                <ActivityIndicator color="#F0B90B" />
                <Text style={styles.loadingPairsText}>Pobieranie listy par z Bybit...</Text>
              </View>
            )}

            <FlatList
              data={filteredPairs}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pairRow, item === symbol && styles.pairRowSelected]}
                  onPress={() => selectPair(item)}
                >
                  <View>
                    <Text style={styles.pairRowSymbol}>{item.replace('USDT', '')}</Text>
                    <Text style={styles.pairRowQuote}>/ USDT</Text>
                  </View>
                  {item === symbol && <Text style={styles.selectedMark}>✓</Text>}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyPairs}>Nie znaleziono takiej pary.</Text>}
              contentContainerStyle={styles.pairListContent}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  container: { padding: 18, paddingBottom: 32 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#9A9A9F', marginTop: 6, marginBottom: 18 },
  warning: { backgroundColor: '#2A2414', borderRadius: 12, padding: 12, marginBottom: 18 },
  warningText: { color: '#F0B90B', lineHeight: 20 },
  label: { color: '#D4D4D8', fontSize: 13, marginBottom: 6, marginTop: 10 },
  input: { backgroundColor: '#1E1E1E', color: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17 },
  pairSelector: { backgroundColor: '#1E1E1E', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#333333' },
  pairSelectorValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  pairSelectorHint: { color: '#8E8E93', fontSize: 11, marginTop: 3 },
  pairSelectorArrow: { color: '#F0B90B', fontSize: 26, fontWeight: '700' },
  error: { color: '#FF6B6B', marginTop: 12 },
  row: { flexDirection: 'row', gap: 12, marginTop: 20 },
  button: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buy: { backgroundColor: '#15803D' },
  sell: { backgroundColor: '#B91C1C' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  card: { backgroundColor: '#1E1E1E', borderRadius: 14, padding: 16, marginTop: 22 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  line: { color: '#D4D4D8', marginBottom: 6 },
  note: { color: '#8E8E93', marginTop: 8, lineHeight: 18, fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  modalCard: { height: '82%', backgroundColor: '#181818', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  modalSubtitle: { color: '#8E8E93', fontSize: 12, marginTop: 3 },
  closeButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { color: '#fff', fontSize: 18 },
  searchInput: { backgroundColor: '#242424', color: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: 1, borderColor: '#333333', marginBottom: 10 },
  loadingPairs: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  loadingPairsText: { color: '#8E8E93', marginLeft: 8, fontSize: 12 },
  pairListContent: { paddingBottom: 24 },
  pairRow: { minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333333', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8 },
  pairRowSelected: { backgroundColor: '#26220F' },
  pairRowSymbol: { color: '#fff', fontSize: 17, fontWeight: '800' },
  pairRowQuote: { color: '#8E8E93', fontSize: 11, marginTop: 1 },
  selectedMark: { color: '#F0B90B', fontSize: 20, fontWeight: '800' },
  emptyPairs: { color: '#8E8E93', textAlign: 'center', paddingVertical: 30 },
});
