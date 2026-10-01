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

function formatNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('pl-PL', { maximumFractionDigits: digits });
}

function getFeeUsdtEquivalent(item: SpotExecution): number | null {
  const fee = Number(item.execFee);
  if (!Number.isFinite(fee)) return null;
  const currency = item.feeCurrency?.toUpperCase();
  if (currency === 'USDT') return fee;

  const baseCoin = item.symbol.toUpperCase().endsWith('USDT')
    ? item.symbol.toUpperCase().slice(0, -4)
    : '';
  const price = Number(item.execPrice);
  if (currency && currency === baseCoin && Number.isFinite(price)) {
    return fee * price;
  }
  return null;
}

interface RealizedTradeResult {
  matchedQty: number;
  buyCostGrossUsdt: number;
  sellValueGrossUsdt: number;
  buyFeesUsdt: number;
  sellFeeUsdt: number;
  totalFeesUsdt: number;
  grossProfitUsdt: number;
  netProfitUsdt: number;
  averageBuyPrice: number;
  complete: boolean;
}

function calculateRealizedResults(rows: SpotExecution[]): Map<string, RealizedTradeResult> {
  type Lot = { qty: number; grossCostUsdt: number; feeUsdt: number; price: number };
  const lotsBySymbol = new Map<string, Lot[]>();
  const results = new Map<string, RealizedTradeResult>();

  const chronological = [...rows].sort((a, b) => Number(a.execTime) - Number(b.execTime));

  for (const item of chronological) {
    const symbol = item.symbol.toUpperCase();
    const qty = Number(item.execQty);
    const value = Number(item.execValue);
    const price = Number(item.execPrice);
    if (![qty, value, price].every(Number.isFinite) || qty <= 0 || value <= 0) continue;

    const feeUsdt = getFeeUsdtEquivalent(item) ?? 0;
    const baseCoin = symbol.endsWith('USDT') ? symbol.slice(0, -4) : '';
    const feeCurrency = item.feeCurrency?.toUpperCase();
    const baseFeeQty = feeCurrency === baseCoin ? Number(item.execFee) || 0 : 0;

    if (item.side === 'Buy') {
      const netQty = Math.max(0, qty - baseFeeQty);
      if (netQty <= 0) continue;
      const lots = lotsBySymbol.get(symbol) || [];
      lots.push({ qty: netQty, grossCostUsdt: value, feeUsdt, price });
      lotsBySymbol.set(symbol, lots);
      continue;
    }

    if (item.side !== 'Sell') continue;

    let remaining = qty;
    let matchedQty = 0;
    let buyCostGrossUsdt = 0;
    let buyFeesUsdt = 0;
    let weightedBuyPrice = 0;
    const lots = lotsBySymbol.get(symbol) || [];

    while (remaining > 1e-12 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(remaining, lot.qty);
      const fraction = lot.qty > 0 ? take / lot.qty : 0;
      matchedQty += take;
      buyCostGrossUsdt += lot.grossCostUsdt * fraction;
      buyFeesUsdt += lot.feeUsdt * fraction;
      weightedBuyPrice += lot.price * take;

      lot.qty -= take;
      lot.grossCostUsdt *= Math.max(0, 1 - fraction);
      lot.feeUsdt *= Math.max(0, 1 - fraction);
      remaining -= take;
      if (lot.qty <= 1e-12) lots.shift();
    }

    lotsBySymbol.set(symbol, lots);

    const complete = matchedQty + 1e-10 >= qty;
    const sellFraction = qty > 0 ? matchedQty / qty : 0;
    const sellValueGrossUsdt = value * sellFraction;
    const sellFeeUsdt = feeUsdt * sellFraction;
    const totalFeesUsdt = buyFeesUsdt + sellFeeUsdt;
    const grossProfitUsdt = sellValueGrossUsdt - buyCostGrossUsdt;
    const netProfitUsdt = grossProfitUsdt - totalFeesUsdt;

    results.set(item.execId, {
      matchedQty,
      buyCostGrossUsdt,
      sellValueGrossUsdt,
      buyFeesUsdt,
      sellFeeUsdt,
      totalFeesUsdt,
      grossProfitUsdt,
      netProfitUsdt,
      averageBuyPrice: matchedQty > 0 ? weightedBuyPrice / matchedQty : 0,
      complete,
    });
  }

  return results;
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
      setRows(await fetchSpotExecutions(credentials, 100));
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

        {(() => {
          const realized = calculateRealizedResults(rows);
          return rows.map((item) => {
          const isBuy = item.side === 'Buy';
          const feeCurrency = item.feeCurrency || 'waluta prowizji';
          const feeUsdt = getFeeUsdtEquivalent(item);
          const tradeResult = !isBuy ? realized.get(item.execId) : undefined;
          return (
            <View key={`${item.execId}-${item.orderId}`} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={[styles.side, isBuy ? styles.buy : styles.sell]}>{item.side.toUpperCase()}</Text>
              </View>
              <Text style={styles.line}>Czas: {formatTime(item.execTime)}</Text>
              <Text style={styles.line}>Cena: {item.execPrice} USDT</Text>
              <Text style={styles.line}>Ilość: {item.execQty}</Text>
              <Text style={styles.line}>Wartość wykonania: {item.execValue} USDT</Text>
              <Text style={styles.line}>
                Prowizja: {item.execFee} {feeCurrency}
                {feeUsdt !== null ? ` ≈ ${formatNumber(feeUsdt, 4)} USDT` : ''}
              </Text>
              {!!item.feeRate && <Text style={styles.line}>Fee rate: {item.feeRate}</Text>}
              {tradeResult && tradeResult.matchedQty > 0 && (
                <View style={styles.pnlBox}>
                  <Text style={styles.pnlTitle}>Wynik tej sprzedaży</Text>
                  <Text style={styles.pnlLine}>Śr. cena zakupu: {formatNumber(tradeResult.averageBuyPrice, 8)} USDT</Text>
                  <Text style={styles.pnlLine}>Koszt zakupu dopasowanej ilości: {formatNumber(tradeResult.buyCostGrossUsdt, 4)} USDT</Text>
                  <Text style={styles.pnlLine}>Wartość sprzedaży brutto: {formatNumber(tradeResult.sellValueGrossUsdt, 4)} USDT</Text>
                  <Text style={styles.pnlLine}>Prowizja BUY: {formatNumber(tradeResult.buyFeesUsdt, 4)} USDT</Text>
                  <Text style={styles.pnlLine}>Prowizja SELL: {formatNumber(tradeResult.sellFeeUsdt, 4)} USDT</Text>
                  <Text style={styles.pnlLine}>Prowizje łącznie: {formatNumber(tradeResult.totalFeesUsdt, 4)} USDT</Text>
                  <Text style={[styles.pnlValue, tradeResult.grossProfitUsdt >= 0 ? styles.profit : styles.loss]}>
                    Zysk/strata brutto: {tradeResult.grossProfitUsdt >= 0 ? '+' : ''}{formatNumber(tradeResult.grossProfitUsdt, 4)} USDT
                  </Text>
                  <Text style={[styles.pnlValue, tradeResult.netProfitUsdt >= 0 ? styles.profit : styles.loss]}>
                    Zysk/strata NETTO po prowizjach: {tradeResult.netProfitUsdt >= 0 ? '+' : ''}{formatNumber(tradeResult.netProfitUsdt, 4)} USDT
                  </Text>
                  {!tradeResult.complete && <Text style={styles.pnlWarning}>Wynik częściowy — w pobranej historii brakuje wcześniejszego BUY dla części tej sprzedaży.</Text>}
                </View>
              )}
              <Text style={styles.orderId}>Order ID: {item.orderId}</Text>
            </View>
          );
          )});
        })()}
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
  pnlBox: { backgroundColor: '#151515', borderWidth: 1, borderColor: '#333333', borderRadius: 10, padding: 10, marginTop: 10 },
  pnlTitle: { color: '#F0B90B', fontSize: 12, fontWeight: '800', marginBottom: 5 },
  pnlLine: { color: '#C9C9CD', fontSize: 11, marginTop: 3 },
  pnlValue: { fontSize: 12, fontWeight: '900', marginTop: 5 },
  profit: { color: '#22C55E' },
  loss: { color: '#EF4444' },
  pnlWarning: { color: '#FFB74D', fontSize: 10, lineHeight: 14, marginTop: 6 },
  orderId: { color: '#76767A', fontSize: 11, marginTop: 8 },
});
