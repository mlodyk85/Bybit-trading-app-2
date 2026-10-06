import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  clearProEngineConfig,
  fetchProEngineStatus,
  loadProEngineConfig,
  ProEngineCommand,
  ProEngineConfig,
  ProEngineStatus,
  saveProEngineConfig,
  sendProEngineCommand,
} from '../services/proEngineBridge';

export const ProEngineScreen: React.FC = () => {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<ProEngineStatus | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState('');

  const config = useCallback((): ProEngineConfig => ({ url: url.trim(), token: token.trim() }), [url, token]);

  const refresh = useCallback(async (override?: ProEngineConfig) => {
    const cfg = override || config();
    if (!cfg.url || !cfg.token) return;
    setLoading(true);
    try {
      const next = await fetchProEngineStatus(cfg);
      setStatus(next);
      setLastError('');
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : 'Brak połączenia z PRO Engine.');
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    let mounted = true;
    void loadProEngineConfig().then((saved) => {
      if (!mounted || !saved) return;
      setUrl(saved.url);
      setToken(saved.token);
      setConfigured(true);
      void refresh(saved);
    });
    return () => { mounted = false; };
  }, [refresh]);

  useEffect(() => {
    if (!configured) return;
    const timer = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(timer);
  }, [configured, refresh]);

  const save = async () => {
    try {
      const saved = await saveProEngineConfig(config());
      setUrl(saved.url);
      setToken(saved.token);
      setConfigured(true);
      await refresh(saved);
      Alert.alert('PRO Engine', 'Połączenie zapisane.');
    } catch (e: unknown) {
      Alert.alert('Błąd', e instanceof Error ? e.message : 'Nie udało się zapisać konfiguracji.');
    }
  };

  const command = async (value: ProEngineCommand) => {
    try {
      await sendProEngineCommand(config(), value);
      setTimeout(() => { void refresh(); }, 700);
    } catch (e: unknown) {
      Alert.alert('PRO Engine', e instanceof Error ? e.message : 'Nie udało się wysłać komendy.');
    }
  };

  const clear = async () => {
    await clearProEngineConfig();
    setConfigured(false);
    setStatus(null);
    setUrl('');
    setToken('');
    setLastError('');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>PRO ENGINE</Text>
      <Text style={styles.subtitle}>Bybit Spot • autonomiczny silnik 24/7 • WebSocket + kontrola kapitału</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Połączenie</Text>
        <Text style={styles.hint}>PRO Engine działa autonomicznie na MacBooku/VPS i nie potrzebuje otwartej aplikacji w telefonie. Po uruchomieniu procesu sam skanuje rynek, kupuje, wystawia SELL i zarządza pozycjami. Klucze Bybit zostają na komputerze; telefon jest tylko panelem kontroli.</Text>
        <Text style={styles.label}>Adres PRO Engine</Text>
        <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="http://192.168.1.10:8790" placeholderTextColor="#666" />
        <Text style={styles.label}>Token</Text>
        <TextInput style={styles.input} value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="token bezpieczeństwa" placeholderTextColor="#666" />
        <View style={styles.row}>
          <TouchableOpacity style={styles.primary} onPress={save}><Text style={styles.primaryText}>ZAPISZ I TESTUJ</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => { void refresh(); }}><Text style={styles.secondaryText}>ODŚWIEŻ</Text></TouchableOpacity>
        </View>
        {configured && <TouchableOpacity onPress={clear} style={styles.clear}><Text style={styles.clearText}>Usuń konfigurację</Text></TouchableOpacity>}
      </View>

      <View style={styles.card}>
        <View style={styles.statusHeader}>
          <Text style={styles.cardTitle}>Status</Text>
          {loading ? <ActivityIndicator color="#F0B90B" /> : <Text style={[styles.badge, { color: status ? '#00E676' : '#FF5252' }]}>{status ? 'ONLINE' : 'BRAK POŁĄCZENIA'}</Text>}
        </View>
        {!!lastError && <Text style={styles.error}>{lastError}</Text>}
        {status ? (
          <>
            <Text style={styles.mainLine}>{status.running ? 'TRADING ON' : 'TRADING STOP'} • {status.dayLocked ? 'DAY LOCK' : 'ACTIVE'}</Text>
            <View style={styles.metrics}>
              <Text style={styles.metric}>Equity {status.account?.equity?.toFixed(2) || '0.00'}</Text>
              <Text style={styles.metric}>Free USDT {status.account?.freeUsdt?.toFixed(2) || '0.00'}</Text>
              <Text style={[styles.metric, { color: status.realizedToday >= 0 ? '#00E676' : '#FF5252' }]}>Realized {status.realizedToday >= 0 ? '+' : ''}{status.realizedToday.toFixed(2)}</Text>
              <Text style={[styles.metric, { color: status.unrealized >= 0 ? '#00E676' : '#FF5252' }]}>Unrealized {status.unrealized >= 0 ? '+' : ''}{status.unrealized.toFixed(2)}</Text>
              <Text style={styles.metric}>Cel +{status.dailyTarget.toFixed(2)}/dzień</Text>
              <Text style={styles.metric}>Limit -{status.dailyLossLimit.toFixed(2)}</Text>
              <Text style={styles.metric}>W/L {status.winsToday}/{status.lossesToday}</Text>
              <Text style={styles.metric}>Pozycje {status.openPositions.length}/{status.maxOpen}</Text>
            </View>
            <Text style={styles.hint}>Rezerwa USDT: {status.reservePct}% equity • stake: {status.stakePct}% equity • transakcje dziś: {status.tradesToday}</Text>
            <Text style={styles.hint}>Ostatnia akcja: {status.lastAction}</Text>
          </>
        ) : <Text style={styles.hint}>Uruchom PRO Engine na MacBooku/VPS i wpisz jego adres oraz token.</Text>}
      </View>

      {!!status?.openPositions.length && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Otwarte pozycje PRO</Text>
          {status.openPositions.map((p) => (
            <View key={p.symbol} style={styles.position}>
              <Text style={styles.positionSymbol}>{p.symbol} • {p.setup}</Text>
              <Text style={styles.positionLine}>entry {p.entryPrice} • mark {p.markPrice} • TP {p.targetPct.toFixed(2)}% • SL {p.stopPct.toFixed(2)}%</Text>
              <Text style={[styles.positionPnl, { color: p.pnl >= 0 ? '#00E676' : '#FF5252' }]}>{p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(4)} USDT</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sterowanie</Text>
        <Text style={styles.warning}>Tryb AUTONOMICZNY jest domyślny. START służy do wznowienia po ręcznym STOP. Cel +10 USDT/dzień jest celem pracy silnika, nie gwarancją wyniku; po osiągnięciu celu bot blokuje nowe wejścia do następnego dnia.</Text>
        <TouchableOpacity style={styles.start} onPress={() => { void command('START'); }}><Text style={styles.actionText}>START PRO ENGINE</Text></TouchableOpacity>
        <TouchableOpacity style={styles.stop} onPress={() => { void command('STOP'); }}><Text style={styles.actionText}>STOP NOWYCH WEJŚĆ</Text></TouchableOpacity>
        <TouchableOpacity style={styles.profit} onPress={() => { void command('CLOSE_PROFITABLE'); }}><Text style={styles.actionText}>UWOLNIJ DODATNIE POZYCJE</Text></TouchableOpacity>
        <TouchableOpacity style={styles.close} onPress={() => {
          Alert.alert('CLOSE ALL?', 'Zamknąć wszystkie pozycje zarządzane przez PRO Engine po cenie rynkowej?', [
            { text: 'Anuluj', style: 'cancel' },
            { text: 'ZAMKNIJ', style: 'destructive', onPress: () => { void command('CLOSE_ALL'); } },
          ]);
        }}><Text style={styles.actionText}>EMERGENCY CLOSE ALL</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: '#F0B90B', fontSize: 25, fontWeight: '900', marginTop: 12 },
  subtitle: { color: '#AAA', fontSize: 12, marginBottom: 16 },
  card: { backgroundColor: '#1E1E1E', borderWidth: 1, borderColor: '#2C2C2C', borderRadius: 10, padding: 14, marginBottom: 14 },
  cardTitle: { color: '#FFF', fontSize: 16, fontWeight: '800', marginBottom: 8 },
  hint: { color: '#AAA', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  warning: { color: '#F0B90B', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  label: { color: '#CCC', fontSize: 12, marginBottom: 5 },
  input: { backgroundColor: '#121212', color: '#FFF', borderWidth: 1, borderColor: '#333', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 10, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8 },
  primary: { flex: 1, backgroundColor: '#F0B90B', borderRadius: 7, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#000', fontWeight: '900', fontSize: 12 },
  secondary: { flex: 1, borderWidth: 1, borderColor: '#F0B90B', borderRadius: 7, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: '#F0B90B', fontWeight: '800', fontSize: 12 },
  clear: { marginTop: 10, alignItems: 'center' },
  clearText: { color: '#888', fontSize: 11 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontWeight: '900', fontSize: 11 },
  error: { color: '#FF5252', fontSize: 12, marginBottom: 8 },
  mainLine: { color: '#FFF', fontWeight: '800', marginBottom: 10 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  metric: { color: '#DDD', backgroundColor: '#121212', paddingHorizontal: 9, paddingVertical: 7, borderRadius: 6, fontSize: 12 },
  position: { borderTopWidth: 1, borderTopColor: '#333', paddingVertical: 10 },
  positionSymbol: { color: '#FFF', fontWeight: '800' },
  positionLine: { color: '#AAA', fontSize: 11, marginTop: 4 },
  positionPnl: { fontSize: 13, fontWeight: '900', marginTop: 4 },
  start: { backgroundColor: '#166534', borderRadius: 7, padding: 13, alignItems: 'center', marginBottom: 8 },
  stop: { backgroundColor: '#92400E', borderRadius: 7, padding: 13, alignItems: 'center', marginBottom: 8 },
  profit: { backgroundColor: '#1D4ED8', borderRadius: 7, padding: 13, alignItems: 'center', marginBottom: 8 },
  close: { backgroundColor: '#991B1B', borderRadius: 7, padding: 13, alignItems: 'center' },
  actionText: { color: '#FFF', fontWeight: '900', fontSize: 12 },
});
