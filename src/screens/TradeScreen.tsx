import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ApiCredentials, TradeAck } from '../api/types';
import { MAX_SPOT_ORDER_USDT, placeSpotMarketOrder } from '../api/bybit';

interface Props {
  credentials: ApiCredentials;
}

export const TradeScreen: React.FC<Props> = ({ credentials }) => {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [lastAck, setLastAck] = useState<TradeAck | null>(null);
  const [error, setError] = useState('');

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
        <TextInput
          value={symbol}
          onChangeText={setSymbol}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="BTCUSDT"
          placeholderTextColor="#6E6E73"
          style={styles.input}
        />

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
});
