import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { fetchSpotExecutionsHistory, fetchWalletBalance } from '../api/bybit';
import { ApiCredentials, SpotExecution, WalletAccountResult } from '../api/types';

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

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return '"' + text.replace(/"/g, '""') + '"';
}

function buildCsv(rows: SpotExecution[], realized: Map<string, RealizedTradeResult>): string {
  const header = [
    'Czas', 'Symbol', 'Typ', 'Cena_USDT', 'Ilosc', 'Wartosc_USDT',
    'Prowizja_waluta', 'Prowizja_USDT', 'Srednia_cena_zakupu_USDT',
    'Koszt_zakupu_USDT', 'Sprzedaz_brutto_USDT', 'Prowizje_lacznie_USDT',
    'Zysk_brutto_USDT', 'Zysk_netto_USDT', 'Wynik_pelny', 'Order_ID', 'Exec_ID',
  ];
  const lines = [header.map(csvEscape).join(';')];

  for (const item of rows) {
    const feeUsdt = getFeeUsdtEquivalent(item);
    const tradeResult = item.side === 'Sell' ? realized.get(item.execId) : undefined;
    lines.push([
      formatTime(item.execTime),
      item.symbol,
      item.side,
      item.execPrice,
      item.execQty,
      item.execValue,
      `${item.execFee} ${item.feeCurrency || ''}`,
      feeUsdt ?? '',
      tradeResult?.averageBuyPrice ?? '',
      tradeResult?.buyCostGrossUsdt ?? '',
      tradeResult?.sellValueGrossUsdt ?? '',
      tradeResult?.totalFeesUsdt ?? '',
      tradeResult?.grossProfitUsdt ?? '',
      tradeResult?.netProfitUsdt ?? '',
      tradeResult ? (tradeResult.complete ? 'TAK' : 'NIE') : '',
      item.orderId,
      item.execId,
    ].map(csvEscape).join(';'));
  }

  return '\uFEFF' + lines.join('\n');
}

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPdfHtml(rows: SpotExecution[], realized: Map<string, RealizedTradeResult>): string {
  const completed = Array.from(realized.values()).filter((row) => row.complete);
  const totalNet = completed.reduce((sum, row) => sum + row.netProfitUsdt, 0);
  const totalFees = completed.reduce((sum, row) => sum + row.totalFeesUsdt, 0);
  const totalGross = completed.reduce((sum, row) => sum + row.grossProfitUsdt, 0);

  const bodyRows = rows.map((item) => {
    const feeUsdt = getFeeUsdtEquivalent(item);
    const result = item.side === 'Sell' ? realized.get(item.execId) : undefined;
    return `
      <tr>
        <td>${htmlEscape(formatTime(item.execTime))}</td>
        <td>${htmlEscape(item.symbol)}</td>
        <td>${htmlEscape(item.side)}</td>
        <td>${htmlEscape(item.execPrice)}</td>
        <td>${htmlEscape(item.execQty)}</td>
        <td>${htmlEscape(item.execValue)}</td>
        <td>${feeUsdt !== null ? formatNumber(feeUsdt, 4) : '-'}</td>
        <td>${result ? formatNumber(result.grossProfitUsdt, 4) : '-'}</td>
        <td>${result ? formatNumber(result.netProfitUsdt, 4) : '-'}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h1 { margin-bottom: 4px; }
        .sub { color: #666; margin-bottom: 18px; }
        .summary { margin: 14px 0 20px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
        .positive { color: #11863b; font-weight: 700; }
        .negative { color: #c62828; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; }
        th, td { border: 1px solid #ddd; padding: 5px; text-align: left; }
        th { background: #f2f2f2; }
        .note { margin-top: 14px; color: #666; font-size: 9px; }
      </style>
    </head>
    <body>
      <h1>Bybit Trading — raport transakcji</h1>
      <div class="sub">Wygenerowano: ${htmlEscape(new Date().toLocaleString('pl-PL'))}</div>
      <div class="summary">
        <div>Zamknięte, w pełni dopasowane sprzedaże: ${completed.length}</div>
        <div>Zysk/strata brutto: <span class="${totalGross >= 0 ? 'positive' : 'negative'}">${formatNumber(totalGross, 4)} USDT</span></div>
        <div>Prowizje łącznie: ${formatNumber(totalFees, 4)} USDT</div>
        <div>Zysk/strata NETTO: <span class="${totalNet >= 0 ? 'positive' : 'negative'}">${formatNumber(totalNet, 4)} USDT</span></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Czas</th><th>Symbol</th><th>Typ</th><th>Cena</th><th>Ilość</th>
            <th>Wartość</th><th>Fee USDT</th><th>PnL brutto</th><th>PnL netto</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <div class="note">PnL sprzedaży jest liczony metodą FIFO na podstawie wykonów dostępnych w pobranej historii. Niepełne dopasowania nie są wliczane do podsumowania netto.</div>
    </body>
  </html>`;
}


interface ProfitWindowSummary {
  label: string;
  ms: number;
  net: number;
  gross: number;
  fees: number;
  cycles: number;
}

function buildProfitWindowSummaries(
  rows: SpotExecution[],
  realized: Map<string, RealizedTradeResult>,
  now = Date.now()
): ProfitWindowSummary[] {
  const windows = [
    { label: '1H', ms: 60 * 60 * 1000 },
    { label: '12H', ms: 12 * 60 * 60 * 1000 },
    { label: '24H', ms: 24 * 60 * 60 * 1000 },
    { label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
    { label: '1M', ms: 30 * 24 * 60 * 60 * 1000 },
    { label: '3M', ms: 90 * 24 * 60 * 60 * 1000 },
    { label: '6M', ms: 180 * 24 * 60 * 60 * 1000 },
    { label: '12M', ms: 365 * 24 * 60 * 60 * 1000 },
  ];

  return windows.map((window) => {
    let net = 0;
    let gross = 0;
    let fees = 0;
    let cycles = 0;
    const cutoff = now - window.ms;

    for (const item of rows) {
      if (item.side !== 'Sell') continue;
      const execTime = Number(item.execTime);
      if (!Number.isFinite(execTime) || execTime < cutoff || execTime > now) continue;
      const result = realized.get(item.execId);
      if (!result || !result.complete) continue;
      net += result.netProfitUsdt;
      gross += result.grossProfitUsdt;
      fees += result.totalFeesUsdt;
      cycles += 1;
    }

    return { ...window, net, gross, fees, cycles };
  });
}

type ReportRange = '24h' | '7d' | '30d' | '365d';

const RANGE_MS: Record<ReportRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '365d': 365 * 24 * 60 * 60 * 1000,
};

export const ReportScreen: React.FC<Props> = ({ credentials }) => {
  const [rows, setRows] = useState<SpotExecution[]>([]);
  const [historyRows, setHistoryRows] = useState<SpotExecution[]>([]);
  const [range, setRange] = useState<ReportRange>('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [accountSnapshot, setAccountSnapshot] = useState<WalletAccountResult | null>(null);

  const load = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const endTime = Date.now();
      const historyStart = endTime - RANGE_MS['365d'];
      const [fullHistory, wallet] = await Promise.all([
        fetchSpotExecutionsHistory(credentials, historyStart, endTime, 20000),
        fetchWalletBalance(credentials),
      ]);
      setHistoryRows(fullHistory);
      setAccountSnapshot(wallet);
      const cutoff = endTime - RANGE_MS[range];
      setRows(fullHistory.filter((item) => Number(item.execTime) >= cutoff));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać raportu.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [credentials, range]);

  const exportCsv = async () => {
    if (rows.length === 0 || exporting) return;
    setExporting('csv');
    try {
      const realized = calculateRealizedResults(historyRows);
      const csv = buildCsv(rows, realized);
      const fileUri = `${FileSystem.cacheDirectory}bybit-report-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Udostępnianie plików nie jest dostępne na tym urządzeniu.');
      await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Eksport raportu CSV' });
    } catch (e: unknown) {
      Alert.alert('Eksport CSV nieudany', e instanceof Error ? e.message : 'Nie udało się utworzyć pliku CSV.');
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    if (rows.length === 0 || exporting) return;
    setExporting('pdf');
    try {
      const realized = calculateRealizedResults(historyRows);
      const { uri } = await Print.printToFileAsync({ html: buildPdfHtml(rows, realized), base64: false });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Udostępnianie plików nie jest dostępne na tym urządzeniu.');
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Eksport raportu PDF' });
    } catch (e: unknown) {
      Alert.alert('Eksport PDF nieudany', e instanceof Error ? e.message : 'Nie udało się utworzyć pliku PDF.');
    } finally {
      setExporting(null);
    }
  };

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

        {accountSnapshot && (() => {
          const equity = Number(accountSnapshot.totalEquity || 0);
          const walletBalance = Number(accountSnapshot.totalWalletBalance || 0);
          const available = Number(accountSnapshot.totalAvailableBalance || 0);
          const perpUpl = Number(accountSnapshot.totalPerpUPL || 0);
          const usdt = accountSnapshot.coin.find((item) => item.coin === 'USDT');
          const freeUsdt = Math.max(
            Number(usdt?.free || 0),
            Number(usdt?.availableToWithdraw || 0),
            Math.max(0, Number(usdt?.walletBalance || 0) - Math.max(0, Number(usdt?.locked || 0)))
          );
          const spotAssets = accountSnapshot.coin
            .filter((item) => item.coin !== 'USDT')
            .reduce((sum, item) => sum + Math.max(0, Number(item.usdValue || 0)), 0);
          return (
            <View style={styles.accountCard}>
              <Text style={styles.accountTitle}>Stan konta TERAZ</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Equity</Text><Text style={styles.summaryValue}>{formatNumber(equity, 2)} USDT</Text></View>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Wallet</Text><Text style={styles.summaryValue}>{formatNumber(walletBalance, 2)} USDT</Text></View>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Wolne USDT</Text><Text style={styles.summaryValue}>{formatNumber(freeUsdt, 2)} USDT</Text></View>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Aktywa poza USDT</Text><Text style={styles.summaryValue}>{formatNumber(spotAssets, 2)} USD</Text></View>
              </View>
              <Text style={[styles.summaryPnl, perpUpl >= 0 ? styles.profit : styles.loss]}>
                Perpetual UPL: {perpUpl >= 0 ? '+' : ''}{formatNumber(perpUpl, 4)} USDT
              </Text>
              <Text style={styles.summaryNote}>Available balance: {formatNumber(available, 2)} USDT. Ten panel pokazuje bieżący stan konta; poniższy FIFO PnL pokazuje tylko zrealizowane wyniki zamkniętych sprzedaży Spot.</Text>
            </View>
          );
        })()}

        <View style={styles.rangeRow}>
          {(['24h', '7d', '30d', '365d'] as ReportRange[]).map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.rangeButton, range === item && styles.rangeButtonActive]}
              onPress={() => setRange(item)}
              disabled={loading || refreshing}
            >
              <Text style={[styles.rangeButtonText, range === item && styles.rangeButtonTextActive]}>
                {item === '365d' ? 'MAX' : item.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {(() => {
          const realized = calculateRealizedResults(historyRows);
          const visibleExecIds = new Set(rows.map((item) => item.execId));
          const profitWindows = buildProfitWindowSummaries(historyRows, realized);
          const completed = Array.from(realized.entries())
            .filter(([execId, item]) => visibleExecIds.has(execId) && item.complete)
            .map(([, item]) => item);
          const totalGross = completed.reduce((sum, item) => sum + item.grossProfitUsdt, 0);
          const totalFees = completed.reduce((sum, item) => sum + item.totalFeesUsdt, 0);
          const totalNet = completed.reduce((sum, item) => sum + item.netProfitUsdt, 0);
          const totalBuy = rows.filter((item) => item.side === 'Buy').reduce((sum, item) => sum + (Number(item.execValue) || 0), 0);
          const totalSell = rows.filter((item) => item.side === 'Sell').reduce((sum, item) => sum + (Number(item.execValue) || 0), 0);
          return (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Podsumowanie okresu</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>BUY</Text><Text style={styles.summaryValue}>{formatNumber(totalBuy, 2)} USDT</Text></View>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>SELL</Text><Text style={styles.summaryValue}>{formatNumber(totalSell, 2)} USDT</Text></View>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Prowizje</Text><Text style={styles.summaryValue}>{formatNumber(totalFees, 4)} USDT</Text></View>
                <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Cykle</Text><Text style={styles.summaryValue}>{completed.length}</Text></View>
              </View>
              <Text style={[styles.summaryPnl, totalGross >= 0 ? styles.profit : styles.loss]}>
                PnL brutto: {totalGross >= 0 ? '+' : ''}{formatNumber(totalGross, 4)} USDT
              </Text>
              <Text style={[styles.summaryPnl, totalNet >= 0 ? styles.profit : styles.loss]}>
                ZREALIZOWANY FIFO PnL NETTO: {totalNet >= 0 ? '+' : ''}{formatNumber(totalNet, 4)} USDT
              </Text>
              <Text style={styles.summaryNote}>Widok: {rows.length} wykonań • baza FIFO: {historyRows.length} wykonań z do 365 dni. To NIE jest zmiana całego equity konta i nie obejmuje niezrealizowanej straty/zysku na otwartych coinach.</Text>

              <View style={styles.periodSection}>
                <Text style={styles.periodTitle}>Zysk całkowity NETTO według okresu</Text>
                <View style={styles.periodGrid}>
                  {profitWindows.map((item) => (
                    <View key={item.label} style={styles.periodCard}>
                      <Text style={styles.periodLabel}>{item.label}</Text>
                      <Text style={[styles.periodNet, item.net >= 0 ? styles.profit : styles.loss]}>
                        {item.net >= 0 ? '+' : ''}{formatNumber(item.net, 4)} USDT
                      </Text>
                      <Text style={styles.periodMeta}>brutto {item.gross >= 0 ? '+' : ''}{formatNumber(item.gross, 4)} • fee {formatNumber(item.fees, 4)}</Text>
                      <Text style={styles.periodMeta}>{item.cycles} zamkniętych cykli</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          );
        })()}

        <View style={styles.exportRow}>
          <TouchableOpacity
            style={[styles.exportButton, (rows.length === 0 || exporting !== null) && styles.exportDisabled]}
            onPress={() => void exportCsv()}
            disabled={rows.length === 0 || exporting !== null}
          >
            <Text style={styles.exportButtonText}>{exporting === 'csv' ? 'EKSPORT CSV...' : 'EKSPORT CSV'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.exportButton, (rows.length === 0 || exporting !== null) && styles.exportDisabled]}
            onPress={() => void exportPdf()}
            disabled={rows.length === 0 || exporting !== null}
          >
            <Text style={styles.exportButtonText}>{exporting === 'pdf' ? 'EKSPORT PDF...' : 'EKSPORT PDF'}</Text>
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator size="large" color="#F0B90B" style={styles.loader} />}
        {!!error && <Text style={styles.error}>{error}</Text>}
        {!loading && !error && rows.length === 0 && <Text style={styles.empty}>Brak wykonanych transakcji Spot.</Text>}

        {(() => {
          const realized = calculateRealizedResults(historyRows);
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
        });
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
  rangeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  rangeButton: { flex: 1, backgroundColor: '#202020', borderWidth: 1, borderColor: '#3A3A3A', borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  rangeButtonActive: { backgroundColor: '#F0B90B', borderColor: '#F0B90B' },
  rangeButtonText: { color: '#C8C8CC', fontSize: 11, fontWeight: '800' },
  rangeButtonTextActive: { color: '#111111' },
  accountCard: { backgroundColor: '#151B22', borderWidth: 1, borderColor: '#36536B', borderRadius: 12, padding: 12, marginTop: 12 },
  accountTitle: { color: '#7DD3FC', fontSize: 14, fontWeight: '900', marginBottom: 8 },
  summaryCard: { backgroundColor: '#171717', borderWidth: 1, borderColor: '#3A3A3A', borderRadius: 12, padding: 12, marginTop: 12 },
  summaryTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', marginBottom: 8 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryItem: { width: '48%', backgroundColor: '#202020', borderRadius: 8, padding: 8 },
  summaryLabel: { color: '#8E8E93', fontSize: 10, fontWeight: '700' },
  summaryValue: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', marginTop: 3 },
  summaryPnl: { fontSize: 13, fontWeight: '900', marginTop: 8 },
  summaryNote: { color: '#8E8E93', fontSize: 10, lineHeight: 14, marginTop: 8 },
  periodSection: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#2F2F2F', paddingTop: 12 },
  periodTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', marginBottom: 8 },
  periodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  periodCard: { width: '48%', backgroundColor: '#202020', borderRadius: 8, padding: 8 },
  periodLabel: { color: '#F0B90B', fontSize: 11, fontWeight: '900' },
  periodNet: { fontSize: 12, fontWeight: '900', marginTop: 4 },
  periodMeta: { color: '#8E8E93', fontSize: 9, lineHeight: 13, marginTop: 2 },
  exportRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  exportButton: { flex: 1, backgroundColor: '#F0B90B', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  exportButtonText: { color: '#111111', fontSize: 12, fontWeight: '900' },
  exportDisabled: { opacity: 0.45 },
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
