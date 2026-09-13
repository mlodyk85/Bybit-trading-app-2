import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { scanSmartScores, SmartScoreResult } from '../services/smartScore';

interface Props {
  onUseSymbol: (symbol: string) => void;
}

const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export const SmartScoreScreen: React.FC<Props> = ({ onUseSymbol }) => {
  const [results, setResults] = useState<SmartScoreResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [minScoreText, setMinScoreText] = useState('70');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const minScore = Math.max(0, Math.min(100, Number(minScoreText.replace(',', '.')) || 0));

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const rows = await scanSmartScores(12);
      if (!mountedRef.current) return;
      setResults(rows);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Nie udało się wykonać skanu.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void refresh(), 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, loading]);

  const filtered = results.filter((item) => item.score >= minScore);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>SMART SCORE</Text>
        <Text style={styles.subtitle}>Ranking 0–100 • 1m + 5m + 15m • momentum • wolumen • zmienność</Text>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Jak działa</Text>
          <Text style={styles.infoText}>
            Skaner porównuje trzy interwały i premiuje zgodny trend, rosnący wolumen, powtarzalność zielonych świec i niski spread. Bardzo gwałtowne wybicia dostają karę, żeby ograniczyć spóźnione wejścia. To filtr jakości sygnału, nie gwarancja zysku.
          </Text>
        </View>

        <View style={styles.controlsCard}>
          <View style={styles.controlRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Minimalny score</Text>
              <Text style={styles.hint}>70 = DOBRY, 80 = MOCNY</Text>
            </View>
            <TextInput
              value={minScoreText}
              onChangeText={setMinScoreText}
              keyboardType="number-pad"
              style={styles.scoreInput}
            />
          </View>

          <View style={styles.controlRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Auto-skan co 60 s</Text>
              <Text style={styles.hint}>Odświeża ranking bez ręcznego naciskania.</Text>
            </View>
            <Switch value={autoRefresh} onValueChange={setAutoRefresh} />
          </View>

          <TouchableOpacity disabled={loading} onPress={() => void refresh()} style={[styles.scanButton, loading && { opacity: 0.6 }]}>
            <Text style={styles.scanButtonText}>{loading ? 'SKANOWANIE...' : 'SKANUJ TERAZ'}</Text>
          </TouchableOpacity>
          {lastUpdated && <Text style={styles.updated}>Ostatni skan: {lastUpdated.toLocaleTimeString()}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>

        {loading && !results.length && <ActivityIndicator size="large" color="#F0B90B" style={{ marginTop: 30 }} />}

        <View style={styles.summaryRow}>
          <Text style={styles.summary}>Wyniki ≥ {minScore}: {filtered.length}</Text>
          <Text style={styles.summary}>Przeskanowane: {results.length}</Text>
        </View>

        {filtered.map((item, index) => (
          <View key={item.symbol} style={styles.resultCard}>
            <View style={styles.resultTop}>
              <View>
                <Text style={styles.rank}>#{index + 1}</Text>
                <Text style={styles.symbol}>{item.symbol}</Text>
              </View>
              <View style={styles.scoreBox}>
                <Text style={styles.score}>{item.score}</Text>
                <Text style={styles.scoreLabel}>{item.label}</Text>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metric}><Text style={styles.metricLabel}>1m</Text><Text style={styles.metricValue}>{pct(item.momentum1mPct)}</Text></View>
              <View style={styles.metric}><Text style={styles.metricLabel}>5m</Text><Text style={styles.metricValue}>{pct(item.momentum5mPct)}</Text></View>
              <View style={styles.metric}><Text style={styles.metricLabel}>15m</Text><Text style={styles.metricValue}>{pct(item.momentum15mPct)}</Text></View>
              <View style={styles.metric}><Text style={styles.metricLabel}>24h</Text><Text style={styles.metricValue}>{pct(item.change24hPct)}</Text></View>
            </View>

            <Text style={styles.detail}>Zielone świece: {(item.greenConsistency * 100).toFixed(0)}% • wolumen x{item.volumeRatio.toFixed(2)} • spread {item.spreadPct.toFixed(3)}%</Text>
            <Text style={styles.detail}>Zmienność: {item.volatilityPct.toFixed(3)}% • sugerowany trailing: arm {item.suggestedTrailArmPct.toFixed(3)}% / drop {item.suggestedTrailDropPct.toFixed(3)}%</Text>
            <Text style={styles.reason}>{item.reasons.join(' • ')}</Text>

            <TouchableOpacity onPress={() => onUseSymbol(item.symbol)} style={styles.tradeButton}>
              <Text style={styles.tradeButtonText}>OTWÓRZ {item.symbol} W TRADE</Text>
            </TouchableOpacity>
          </View>
        ))}

        {!loading && results.length > 0 && filtered.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Brak sygnału powyżej progu</Text>
            <Text style={styles.emptyText}>To jest poprawny wynik — lepiej czekać niż wymuszać wejście.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  container: { padding: 18, paddingBottom: 40 },
  title: { color: '#F0B90B', fontSize: 28, fontWeight: '900' },
  subtitle: { color: '#8E8E93', marginTop: 5, marginBottom: 16, lineHeight: 18 },
  infoCard: { backgroundColor: '#1B1B1B', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#333', marginBottom: 12 },
  infoTitle: { color: '#FFFFFF', fontWeight: '800', marginBottom: 6 },
  infoText: { color: '#B3B3B8', fontSize: 12, lineHeight: 18 },
  controlsCard: { backgroundColor: '#1B1B1B', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#333' },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  label: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  hint: { color: '#8E8E93', fontSize: 10, marginTop: 3 },
  scoreInput: { width: 72, backgroundColor: '#242424', color: '#FFFFFF', borderRadius: 8, padding: 10, textAlign: 'center', fontWeight: '800' },
  scanButton: { backgroundColor: '#F0B90B', borderRadius: 10, padding: 13, alignItems: 'center' },
  scanButtonText: { color: '#111', fontWeight: '900' },
  updated: { color: '#8E8E93', fontSize: 10, marginTop: 8, textAlign: 'center' },
  error: { color: '#FF6B6B', marginTop: 8, fontSize: 11 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 14 },
  summary: { color: '#A1A1AA', fontSize: 11, fontWeight: '700' },
  resultCard: { backgroundColor: '#1B1B1B', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#343434' },
  resultTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rank: { color: '#71717A', fontSize: 10, fontWeight: '800' },
  symbol: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', marginTop: 2 },
  scoreBox: { minWidth: 72, borderRadius: 12, backgroundColor: '#302A12', borderWidth: 1, borderColor: '#F0B90B', alignItems: 'center', paddingVertical: 7 },
  score: { color: '#F0B90B', fontSize: 24, fontWeight: '900' },
  scoreLabel: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  metricsGrid: { flexDirection: 'row', gap: 7, marginTop: 12 },
  metric: { flex: 1, backgroundColor: '#242424', borderRadius: 8, paddingVertical: 7, alignItems: 'center' },
  metricLabel: { color: '#8E8E93', fontSize: 9 },
  metricValue: { color: '#FFFFFF', fontWeight: '800', fontSize: 11, marginTop: 2 },
  detail: { color: '#B3B3B8', fontSize: 10, marginTop: 8, lineHeight: 15 },
  reason: { color: '#22C55E', fontSize: 10, lineHeight: 15, marginTop: 7 },
  tradeButton: { marginTop: 12, backgroundColor: '#222', borderWidth: 1, borderColor: '#F0B90B', borderRadius: 9, padding: 11, alignItems: 'center' },
  tradeButtonText: { color: '#F0B90B', fontWeight: '900', fontSize: 11 },
  emptyCard: { backgroundColor: '#1B1B1B', borderRadius: 14, padding: 18, alignItems: 'center' },
  emptyTitle: { color: '#FFFFFF', fontWeight: '800' },
  emptyText: { color: '#8E8E93', fontSize: 11, marginTop: 5, textAlign: 'center' },
});
