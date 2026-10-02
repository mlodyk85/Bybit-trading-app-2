import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  clearMt5BridgeConfig,
  fetchMt5Status,
  loadMt5BridgeConfig,
  Mt5BridgeConfig,
  Mt5Command,
  Mt5Status,
  saveMt5BridgeConfig,
  sendMt5Command,
} from '../services/mt5Bridge';

export const Mt5Screen: React.FC = () => {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Mt5Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [lastError, setLastError] = useState('');

  const currentConfig = useCallback((): Mt5BridgeConfig => ({ url: url.trim(), token: token.trim() }), [url, token]);

  const refresh = useCallback(async (configOverride?: Mt5BridgeConfig) => {
    const config = configOverride || currentConfig();
    if (!config.url || !config.token) return;
    setLoading(true);
    try {
      const next = await fetchMt5Status(config);
      setStatus(next);
      setLastError('');
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : 'Brak połączenia z MT5 Bridge.');
    } finally {
      setLoading(false);
    }
  }, [currentConfig]);

  useEffect(() => {
    let mounted = true;
    void loadMt5BridgeConfig().then((config) => {
      if (!mounted || !config) return;
      setUrl(config.url);
      setToken(config.token);
      setConfigured(true);
      void refresh(config);
    });
    return () => { mounted = false; };
  }, [refresh]);

  useEffect(() => {
    if (!configured) return;
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  const save = async () => {
    try {
      const saved = await saveMt5BridgeConfig(currentConfig());
      setUrl(saved.url);
      setToken(saved.token);
      setConfigured(true);
      await refresh(saved);
      Alert.alert('MT5 Bridge', 'Konfiguracja zapisana.');
    } catch (e: unknown) {
      Alert.alert('Błąd konfiguracji', e instanceof Error ? e.message : 'Nie udało się zapisać konfiguracji.');
    }
  };

  const command = async (value: Mt5Command) => {
    try {
      await sendMt5Command(currentConfig(), value);
      Alert.alert('MT5', `Wysłano komendę: ${value}`);
      setTimeout(() => { void refresh(); }, 800);
    } catch (e: unknown) {
      Alert.alert('Błąd MT5 Bridge', e instanceof Error ? e.message : 'Nie udało się wysłać komendy.');
    }
  };

  const clear = async () => {
    await clearMt5BridgeConfig();
    setConfigured(false);
    setStatus(null);
    setUrl('');
    setToken('');
    setLastError('');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>MT5</Text>
      <Text style={styles.subtitle}>Capital Rotation Gold • osobny silnik MetaTrader 5</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>MT5 Bridge</Text>
        <Text style={styles.hint}>Telefon steruje EA przez Bridge uruchomiony na VPS/PC obok terminala MT5. W MT5 trzeba dodać adres Bridge do Tools → Options → Expert Advisors → Allow WebRequest.</Text>
        <Text style={styles.label}>Adres Bridge</Text>
        <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="http://192.168.1.10:8787" placeholderTextColor="#666" />
        <Text style={styles.label}>Token Bridge</Text>
        <TextInput style={styles.input} value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="token bezpieczeństwa" placeholderTextColor="#666" />
        <View style={styles.row}>
          <TouchableOpacity style={styles.primaryButton} onPress={save}><Text style={styles.primaryText}>ZAPISZ I TESTUJ</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => { void refresh(); }}><Text style={styles.secondaryText}>ODŚWIEŻ</Text></TouchableOpacity>
        </View>
        {configured && <TouchableOpacity style={styles.clearButton} onPress={clear}><Text style={styles.clearText}>Usuń konfigurację Bridge</Text></TouchableOpacity>}
      </View>

      <View style={styles.card}>
        <View style={styles.statusHeader}>
          <Text style={styles.cardTitle}>Status EA</Text>
          {loading ? <ActivityIndicator color="#F0B90B" /> : <Text style={[styles.badge, { color: status ? '#00E676' : '#FF5252' }]}>{status ? 'ONLINE' : 'BRAK STATUSU'}</Text>}
        </View>
        {!!lastError && <Text style={styles.error}>{lastError}</Text>}
        {status ? (
          <>
            <Text style={styles.mainLine}>{status.symbol} • {status.enabled ? 'TRADING ON' : 'TRADING STOP'} • {status.dayLocked ? 'DAY LOCK' : 'ACTIVE'}</Text>
            <View style={styles.metrics}>
              <Text style={styles.metric}>Equity {status.equity.toFixed(2)}</Text>
              <Text style={styles.metric}>Balance {status.balance.toFixed(2)}</Text>
              <Text style={styles.metric}>Free {status.freeMargin.toFixed(2)}</Text>
              <Text style={styles.metric}>Margin {status.margin.toFixed(2)}</Text>
              <Text style={[styles.metric, { color: status.dailyRealized >= 0 ? '#00E676' : '#FF5252' }]}>Daily {status.dailyRealized >= 0 ? '+' : ''}{status.dailyRealized.toFixed(2)}</Text>
              <Text style={[styles.metric, { color: status.basketPnl >= 0 ? '#00E676' : '#FF5252' }]}>Basket {status.basketPnl >= 0 ? '+' : ''}{status.basketPnl.toFixed(2)}</Text>
            </View>
            <Text style={styles.hint}>Pozycje: {status.positions}/{status.maxPositions} • ostatnia aktualizacja: {new Date(status.updatedAt).toLocaleTimeString()}</Text>
            {!!status.lastAction && <Text style={styles.hint}>Ostatnia akcja: {status.lastAction}</Text>}
          </>
        ) : <Text style={styles.hint}>EA jeszcze nie wysłał statusu do Bridge.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sterowanie</Text>
        <TouchableOpacity style={styles.startButton} onPress={() => { void command('START'); }}><Text style={styles.actionText}>START EA</Text></TouchableOpacity>
        <TouchableOpacity style={styles.stopButton} onPress={() => { void command('STOP'); }}><Text style={styles.actionText}>STOP NOWYCH WEJŚĆ</Text></TouchableOpacity>
        <TouchableOpacity style={styles.closeButton} onPress={() => {
          Alert.alert('Zamknąć koszyk MT5?', 'Ta komenda zamknie wszystkie pozycje zarządzane przez ten EA.', [
            { text: 'Anuluj', style: 'cancel' },
            { text: 'ZAMKNIJ', style: 'destructive', onPress: () => { void command('CLOSE_ALL'); } },
          ]);
        }}><Text style={styles.actionText}>CLOSE ALL</Text></TouchableOpacity>
        <TouchableOpacity style={styles.resetButton} onPress={() => { void command('RESET_DAY_LOCK'); }}><Text style={styles.actionText}>RESET DAY LOCK</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: '#F0B90B', fontSize: 26, fontWeight: '900', marginTop: 12 },
  subtitle: { color: '#AAA', fontSize: 12, marginBottom: 16 },
  card: { backgroundColor: '#1E1E1E', borderWidth: 1, borderColor: '#2C2C2C', borderRadius: 10, padding: 14, marginBottom: 14 },
  cardTitle: { color: '#FFF', fontSize: 16, fontWeight: '800', marginBottom: 8 },
  hint: { color: '#AAA', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  label: { color: '#CCC', fontSize: 12, marginBottom: 5 },
  input: { backgroundColor: '#121212', color: '#FFF', borderWidth: 1, borderColor: '#333', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 10, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8 },
  primaryButton: { flex: 1, backgroundColor: '#F0B90B', borderRadius: 7, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#000', fontWeight: '900', fontSize: 12 },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: '#F0B90B', borderRadius: 7, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: '#F0B90B', fontWeight: '800', fontSize: 12 },
  clearButton: { marginTop: 10, alignItems: 'center' },
  clearText: { color: '#888', fontSize: 11 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontWeight: '900', fontSize: 11 },
  error: { color: '#FF5252', fontSize: 12, marginBottom: 8 },
  mainLine: { color: '#FFF', fontWeight: '800', marginBottom: 10 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  metric: { color: '#DDD', backgroundColor: '#121212', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 6, fontSize: 12 },
  startButton: { backgroundColor: '#166534', borderRadius: 7, padding: 13, alignItems: 'center', marginBottom: 8 },
  stopButton: { backgroundColor: '#92400E', borderRadius: 7, padding: 13, alignItems: 'center', marginBottom: 8 },
  closeButton: { backgroundColor: '#991B1B', borderRadius: 7, padding: 13, alignItems: 'center', marginBottom: 8 },
  resetButton: { backgroundColor: '#374151', borderRadius: 7, padding: 13, alignItems: 'center' },
  actionText: { color: '#FFF', fontWeight: '900', fontSize: 12 },
});
