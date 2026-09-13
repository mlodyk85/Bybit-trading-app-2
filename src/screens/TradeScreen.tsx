import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AssetSmartAutoSeed } from '../components/AssetRow';
import { ApiCredentials, TradeAck } from '../api/types';
import {
  fetchSpotMarketSnapshot,
  fetchSpotUsdtMarketCandidates,
  fetchSpotUsdtSymbols,
  placeSpotMarketOrder,
  placeSpotMarketSellBase,
  SpotMarketCandidate,
  SpotMarketSnapshot,
  waitForSpotFill,
} from '../api/bybit';

interface Props {
  credentials: ApiCredentials;
  initialSymbol?: string;
  initialHolding?: AssetSmartAutoSeed | null;
  maxOrderUsdt: number;
  onHoldingConsumed?: () => void;
}

interface SmartPosition {
  symbol: string;
  qty: number;
  costUsdt: number;
  entryPrice: number;
  estimatedFeeRate: number;
  fromPortfolio: boolean;
}

interface SmartCandidateScore {
  market: SpotMarketCandidate;
  momentumPct: number;
  score: number;
}

const FALLBACK_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','PEPEUSDT','SUIUSDT','LINKUSDT','AVAXUSDT'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toNumber = (v: string) => Number(v.replace(',', '.'));
const priceText = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(5) : v.toFixed(8);
const DEFAULT_MIN_NET_PROFIT_USDT = 0.05;
const DEFAULT_TRAIL_DROP_USDT = 0.01;

export const TradeScreen: React.FC<Props> = ({
  credentials,
  initialSymbol = 'BTCUSDT',
  initialHolding = null,
  maxOrderUsdt,
  onHoldingConsumed,
}) => {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [amount, setAmount] = useState(String(Math.min(5, maxOrderUsdt)));
  const [busy, setBusy] = useState(false);
  const [lastAck, setLastAck] = useState<TradeAck | null>(null);
  const [error, setError] = useState('');
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [pairs, setPairs] = useState<string[]>(FALLBACK_SYMBOLS);
  const [pairsLoading, setPairsLoading] = useState(true);
  const [market, setMarket] = useState<SpotMarketSnapshot | null>(null);

  const [smartEnabled, setSmartEnabled] = useState(Boolean(initialHolding));
  const [smartRunning, setSmartRunning] = useState(false);
  const [targetProfit, setTargetProfit] = useState('1');
  const [maxLoss, setMaxLoss] = useState('2');
  const [maxCycles, setMaxCycles] = useState('1000');
  const [sessionProfit, setSessionProfit] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);
  const [smartStatus, setSmartStatus] = useState('Gotowy');
  const [activeScore, setActiveScore] = useState<SmartCandidateScore | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!smartRunning && initialSymbol) setSymbol(initialSymbol.toUpperCase());
    if (initialHolding && !smartRunning) setSmartEnabled(true);
  }, [initialHolding, initialSymbol, smartRunning]);

  useEffect(() => {
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0 || value > maxOrderUsdt) setAmount(String(Math.min(5, maxOrderUsdt)));
  }, [amount, maxOrderUsdt]);

  useEffect(() => {
    let mounted = true;
    fetchSpotUsdtSymbols()
      .then((list) => { if (mounted && list.length) setPairs(list); })
      .catch(() => undefined)
      .finally(() => { if (mounted) setPairsLoading(false); });
    return () => { mounted = false; stopRef.current = true; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const snapshot = await fetchSpotMarketSnapshot(symbol);
        if (mounted) setMarket(snapshot);
      } catch {
        // Zachowaj ostatnią znaną cenę.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { mounted = false; clearInterval(timer); };
  }, [symbol]);

  const filteredPairs = useMemo(() => {
    const q = pairSearch.trim().toUpperCase();
    return q ? pairs.filter((p) => p.includes(q)) : pairs;
  }, [pairSearch, pairs]);

  const selectPair = (next: string) => {
    if (smartRunning) return;
    setSymbol(next);
    setPairSearch('');
    setPairPickerOpen(false);
  };

  const submit = (side: 'Buy' | 'Sell') => {
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0 || value > maxOrderUsdt) {
      setError(`Kwota musi być > 0 i <= ${maxOrderUsdt} USDT.`);
      return;
    }
    Alert.alert(
      side === 'Buy' ? 'Potwierdź zakup' : 'Potwierdź sprzedaż',
      `${side.toUpperCase()} ${symbol} za ${value.toFixed(2)} USDT po cenie rynkowej?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wykonaj',
          style: side === 'Sell' ? 'destructive' : 'default',
          onPress: async () => {
            setBusy(true);
            setError('');
            try {
              setLastAck(await placeSpotMarketOrder(credentials, symbol, side, value, maxOrderUsdt));
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Błąd zlecenia.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const stopSmart = () => {
    stopRef.current = true;
    setSmartStatus('STOP: jeśli jest otwarta pozycja, zamykam ją po rynku...');
  };

  const scanBestCandidate = async (): Promise<SmartCandidateScore | null> => {
    setSmartStatus('SMART AUTO: skanuję płynne pary USDT...');
    const first = await fetchSpotUsdtMarketCandidates(40);
    if (stopRef.current) return null;
    await sleep(3500);
    const second = await fetchSpotUsdtMarketCandidates(40);
    const previous = new Map(first.map((item) => [item.symbol, item]));

    const ranked = second
      .map((now) => {
        const before = previous.get(now.symbol);
        if (!before || before.lastPrice <= 0) return null;
        const momentumPct = ((now.lastPrice - before.lastPrice) / before.lastPrice) * 100;
        if (momentumPct <= 0.003 || momentumPct > 2 || now.spreadPct > 0.25) return null;
        const liquidityScore = Math.max(0, Math.log10(Math.max(now.turnover24h, 1)) - 5);
        const score = momentumPct * 220 + Math.max(0, now.change24hPct) * 0.12 + liquidityScore * 0.6 - now.spreadPct * 80;
        return { market: now, momentumPct, score } as SmartCandidateScore;
      })
      .filter((item): item is SmartCandidateScore => Boolean(item))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0] || null;
    setActiveScore(best);
    return best;
  };

  const estimateFeeRateFromBuy = (quoteValue: number, entry: number, feeByCurrency: Record<string, number>, baseCoin: string): number => {
    const feeUsdt = (feeByCurrency.USDT || 0) + (feeByCurrency[baseCoin] || 0) * entry;
    const inferred = quoteValue > 0 ? feeUsdt / quoteValue : 0;
    return Number.isFinite(inferred) && inferred > 0 && inferred < 0.01 ? inferred : 0.001;
  };

  const monitorAndSell = async (
    position: SmartPosition,
    realizedBefore: number,
    sessionLossLimit: number,
    minProfit: number,
    trailDrop: number
  ): Promise<{ pnl: number; reason: string }> => {
    let bestNetPnl = Number.NEGATIVE_INFINITY;
    let trailingArmed = false;
    let reason = 'MANUAL STOP';

    while (!stopRef.current) {
      const snapshot = await fetchSpotMarketSnapshot(position.symbol);
      setMarket(snapshot);
      setSymbol(position.symbol);
      const executablePrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
      const gross = executablePrice * position.qty;
      const estimatedExitFee = gross * position.estimatedFeeRate;
      const netPnl = gross - estimatedExitFee - position.costUsdt;
      bestNetPnl = Math.max(bestNetPnl, netPnl);

      if (netPnl >= minProfit) trailingArmed = true;
      const pullback = trailingArmed ? bestNetPnl - netPnl : 0;
      setSmartStatus(
        `${position.symbol} • netto ${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(4)} USDT • max ${bestNetPnl >= 0 ? '+' : ''}${bestNetPnl.toFixed(4)} • cofnięcie ${pullback.toFixed(4)}`
      );

      if (realizedBefore + netPnl <= -sessionLossLimit) {
        reason = 'MAX STRATA';
        break;
      }
      if (trailingArmed && pullback >= trailDrop && netPnl > 0) {
        reason = 'TRAILING PROFIT';
        break;
      }
      await sleep(1800);
    }

    setSmartStatus(`${reason}: SELL ${position.symbol}...`);
    const sellAck = await placeSpotMarketSellBase(credentials, position.symbol, position.qty);
    const sell = await waitForSpotFill(credentials, sellAck.orderId);
    const baseCoin = position.symbol.replace(/USDT$/, '');
    const sellFeeUsdt = (sell.feeByCurrency.USDT || 0) + (sell.feeByCurrency[baseCoin] || 0) * sell.avgPrice;
    const proceeds = sell.quoteValue - sellFeeUsdt;
    return { pnl: proceeds - position.costUsdt, reason };
  };

  const startSmart = () => {
    const trade = toNumber(amount);
    const target = toNumber(targetProfit);
    const loss = toNumber(maxLoss);
    const cycles = Math.floor(toNumber(maxCycles));

    if (!Number.isFinite(trade) || trade <= 0 || trade > maxOrderUsdt) return setError(`Kwota Smart Auto musi być > 0 i <= ${maxOrderUsdt} USDT.`);
    if (![target, loss].every((x) => Number.isFinite(x) && x > 0)) return setError('Cel zysku i max strata muszą być większe od 0.');
    if (!Number.isFinite(cycles) || cycles < 1 || cycles > 1000) return setError('Maksymalna liczba cykli: 1–1000.');

    const holdingText = initialHolding
      ? ` Najpierw Smart Auto będzie zarządzał posiadanym ${initialHolding.symbol.replace(/USDT$/, '')} (${initialHolding.baseQty}).`
      : '';

    Alert.alert(
      'SMART AUTO LIVE — prawdziwe pieniądze',
      `Smart Auto może wykonać do ${cycles} cykli. Po każdej sprzedaży wraca do USDT, skanuje płynne pary i wybiera aktywo z dodatnim krótkoterminowym momentum. Trailing profit aktywuje się od +${DEFAULT_MIN_NET_PROFIT_USDT.toFixed(2)} USDT netto i sprzedaje po cofnięciu o ${DEFAULT_TRAIL_DROP_USDT.toFixed(2)} USDT. Max strata sesji: ${loss.toFixed(2)} USDT.${holdingText} Zysk nie jest gwarantowany.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'START SMART AUTO',
          onPress: async () => {
            stopRef.current = false;
            setSmartRunning(true);
            setError('');
            setSessionProfit(0);
            setCycleCount(0);
            let total = 0;
            let completedCycles = 0;
            let openPosition: SmartPosition | null = null;
            let portfolioHoldingPending = initialHolding;

            try {
              while (!stopRef.current && completedCycles < cycles && total < target && total > -loss) {
                if (portfolioHoldingPending) {
                  const baseCoin = portfolioHoldingPending.symbol.replace(/USDT$/, '');
                  setSymbol(portfolioHoldingPending.symbol);
                  openPosition = {
                    symbol: portfolioHoldingPending.symbol,
                    qty: portfolioHoldingPending.baseQty,
                    costUsdt: portfolioHoldingPending.buyCostUsdt,
                    entryPrice: portfolioHoldingPending.buyPrice,
                    estimatedFeeRate: 0.001,
                    fromPortfolio: true,
                  };
                  setSmartStatus(`Pozycja startowa ${baseCoin}: pilnuję realnego PnL netto...`);
                  portfolioHoldingPending = null;
                } else {
                  let candidate: SmartCandidateScore | null = null;
                  while (!candidate && !stopRef.current) {
                    candidate = await scanBestCandidate();
                    if (!candidate && !stopRef.current) {
                      setSmartStatus('Brak wystarczająco dobrego sygnału — czekam i skanuję ponownie.');
                      await sleep(5000);
                    }
                  }
                  if (!candidate || stopRef.current) break;

                  setSymbol(candidate.market.symbol);
                  setMarket(candidate.market);
                  setSmartStatus(`${candidate.market.symbol}: momentum +${candidate.momentumPct.toFixed(4)}% • BUY ${trade.toFixed(2)} USDT`);
                  const buyAck = await placeSpotMarketOrder(credentials, candidate.market.symbol, 'Buy', trade, maxOrderUsdt);
                  setLastAck(buyAck);
                  const buy = await waitForSpotFill(credentials, buyAck.orderId);
                  const baseCoin = candidate.market.symbol.replace(/USDT$/, '');
                  const qty = Math.max(0, buy.baseQty - (buy.feeByCurrency[baseCoin] || 0));
                  const buyFeeUsdt = (buy.feeByCurrency.USDT || 0) + (buy.feeByCurrency[baseCoin] || 0) * buy.avgPrice;
                  const costUsdt = buy.quoteValue + buyFeeUsdt;
                  if (qty <= 0 || costUsdt <= 0) throw new Error('Brak prawidłowej ilości po BUY.');
                  openPosition = {
                    symbol: candidate.market.symbol,
                    qty,
                    costUsdt,
                    entryPrice: buy.avgPrice,
                    estimatedFeeRate: estimateFeeRateFromBuy(buy.quoteValue, buy.avgPrice, buy.feeByCurrency, baseCoin),
                    fromPortfolio: false,
                  };
                }

                if (!openPosition) continue;
                const result = await monitorAndSell(openPosition, total, loss, DEFAULT_MIN_NET_PROFIT_USDT, DEFAULT_TRAIL_DROP_USDT);
                total += result.pnl;
                completedCycles += 1;
                setCycleCount(completedCycles);
                setSessionProfit(total);
                setSmartStatus(`${result.reason} • cykl ${result.pnl >= 0 ? '+' : ''}${result.pnl.toFixed(4)} USDT • sesja ${total >= 0 ? '+' : ''}${total.toFixed(4)} USDT`);
                if (openPosition.fromPortfolio) onHoldingConsumed?.();
                openPosition = null;

                if (total >= target || total <= -loss || stopRef.current) break;
                await sleep(1200);
              }

              if (total >= target) setSmartStatus(`CEL SESJI OSIĄGNIĘTY: +${total.toFixed(4)} USDT`);
              else if (total <= -loss) setSmartStatus(`MAX STRATA SESJI: ${total.toFixed(4)} USDT — SMART AUTO STOP`);
              else if (stopRef.current) setSmartStatus(`SMART AUTO zatrzymane • wynik ${total >= 0 ? '+' : ''}${total.toFixed(4)} USDT`);
              else setSmartStatus(`Koniec limitu ${completedCycles} cykli • wynik ${total >= 0 ? '+' : ''}${total.toFixed(4)} USDT`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Błąd Smart Auto.';
              if (openPosition && openPosition.qty > 0) {
                try {
                  setSmartStatus(`Błąd: ${message}. Awaryjnie zamykam ${openPosition.symbol}...`);
                  const emergency = await placeSpotMarketSellBase(credentials, openPosition.symbol, openPosition.qty);
                  await waitForSpotFill(credentials, emergency.orderId);
                  openPosition = null;
                } catch {
                  setSmartStatus(`KRYTYCZNE: ${message}. Nie udało się potwierdzić awaryjnego SELL — sprawdź pozycję na Bybit.`);
                }
              }
              setError(message);
            } finally {
              setSmartRunning(false);
              stopRef.current = false;
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
        <Text style={styles.subtitle}>LIVE Bybit • Market • limit {maxOrderUsdt.toFixed(2)} USDT / zlecenie</Text>

        <View style={styles.quoteCard}>
          <View style={styles.quoteTop}>
            <Text style={styles.quoteSymbol}>{symbol}</Text>
            <Text style={[styles.change, { color: (market?.change24hPct || 0) >= 0 ? '#22C55E' : '#EF4444' }]}>
              {market ? `${market.change24hPct >= 0 ? '+' : ''}${market.change24hPct.toFixed(2)}% 24h` : '...'}
            </Text>
          </View>
          <Text style={styles.quotePrice}>{market ? `${priceText(market.lastPrice)} USDT` : 'Pobieranie ceny...'}</Text>
          {market && <Text style={styles.quoteDetails}>Bid {priceText(market.bid)} • Ask {priceText(market.ask)} • 24h H/L {priceText(market.high24h)} / {priceText(market.low24h)}</Text>}
        </View>

        <Text style={styles.label}>Para ręcznego handlu</Text>
        <TouchableOpacity style={styles.pairSelector} onPress={() => !smartRunning && setPairPickerOpen(true)}>
          <View>
            <Text style={styles.pairValue}>{symbol}</Text>
            <Text style={styles.hint}>{smartRunning ? 'Smart Auto wybiera parę automatycznie' : 'Dotknij, aby zmienić'}</Text>
          </View>
          <Text style={styles.arrow}>⌄</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Kwota pojedynczej transakcji (USDT)</Text>
        <TextInput value={amount} onChangeText={setAmount} editable={!smartRunning} keyboardType="decimal-pad" style={styles.input} />
        {!!error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.row}>
          <TouchableOpacity disabled={busy || smartRunning} style={[styles.button, styles.buy]} onPress={() => submit('Buy')}>
            <Text style={styles.buttonText}>{busy ? '...' : 'BUY'}</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={busy || smartRunning} style={[styles.button, styles.sell]} onPress={() => submit('Sell')}>
            <Text style={styles.buttonText}>{busy ? '...' : 'SELL'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.smartCard}>
          <View style={styles.smartHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.smartTitle}>SMART AUTO</Text>
              <Text style={styles.smartSub}>USDT → najlepsza płynna para → trailing profit → USDT → kolejny skan</Text>
            </View>
            <Switch value={smartEnabled} onValueChange={(v) => { if (!smartRunning) setSmartEnabled(v); }} disabled={smartRunning} />
          </View>

          {smartEnabled && <>
            <Text style={styles.smartNotice}>
              Smart Auto liczy wynik netto, uwzględnia faktyczną cenę wykonania BUY/SELL oraz prowizje z API. Trailing aktywuje się po +0,05 USDT netto i zabezpiecza zysk po cofnięciu o 0,01 USDT. Nie ma gwarancji dodatniego wyniku.
            </Text>
            {initialHolding && (
              <View style={styles.holdingBox}>
                <Text style={styles.holdingTitle}>Pozycja startowa z Portfolio</Text>
                <Text style={styles.holdingText}>{initialHolding.symbol} • {initialHolding.baseQty} • zakup @ {priceText(initialHolding.buyPrice)}</Text>
              </View>
            )}
            <View style={styles.grid}>
              <View style={styles.field}>
                <Text style={styles.smallLabel}>Cel zysku sesji (USDT)</Text>
                <TextInput value={targetProfit} onChangeText={setTargetProfit} editable={!smartRunning} keyboardType="decimal-pad" style={styles.smallInput} />
              </View>
              <View style={styles.field}>
                <Text style={styles.smallLabel}>Max strata sesji (USDT)</Text>
                <TextInput value={maxLoss} onChangeText={setMaxLoss} editable={!smartRunning} keyboardType="decimal-pad" style={styles.smallInput} />
              </View>
            </View>
            <Text style={styles.smallLabel}>Maksymalna liczba cykli (1–1000)</Text>
            <TextInput value={maxCycles} onChangeText={setMaxCycles} editable={!smartRunning} keyboardType="number-pad" style={styles.smallInput} />

            <View style={styles.stats}>
              <Text style={styles.stat}>Cykl {cycleCount}</Text>
              <Text style={[styles.stat, { color: sessionProfit >= 0 ? '#22C55E' : '#EF4444' }]}>PnL {sessionProfit >= 0 ? '+' : ''}{sessionProfit.toFixed(4)} USDT</Text>
            </View>
            {activeScore && <Text style={styles.candidate}>Skan: {activeScore.market.symbol} • momentum +{activeScore.momentumPct.toFixed(4)}% • spread {activeScore.market.spreadPct.toFixed(3)}%</Text>}
            <Text style={styles.status}>{smartStatus}</Text>
            {smartRunning ? (
              <TouchableOpacity style={styles.stopButton} onPress={stopSmart}><Text style={styles.buttonText}>STOP SMART AUTO</Text></TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.smartButton} onPress={startSmart}><Text style={styles.smartButtonText}>START SMART AUTO LIVE</Text></TouchableOpacity>
            )}
          </>}
        </View>

        {lastAck && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ostatnie zlecenie</Text>
            <Text style={styles.line}>{lastAck.side} {lastAck.symbol} • {lastAck.quoteAmountUsdt.toFixed(2)} USDT</Text>
            <Text style={styles.line}>Order ID: {lastAck.orderId}</Text>
            <Text style={styles.line}>API: {lastAck.requestLatencyMs} ms</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={pairPickerOpen} animationType="slide" transparent onRequestClose={() => setPairPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Wybierz parę Spot/USDT</Text>
              <TouchableOpacity onPress={() => setPairPickerOpen(false)}><Text style={styles.close}>✕</Text></TouchableOpacity>
            </View>
            <TextInput value={pairSearch} onChangeText={setPairSearch} placeholder="BTC, XRP, ETH..." placeholderTextColor="#666" style={styles.search} />
            {pairsLoading && <ActivityIndicator color="#F0B90B" />}
            <FlatList
              data={filteredPairs}
              keyExtractor={(x) => x}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pairRow} onPress={() => selectPair(item)}>
                  <Text style={styles.pairRowText}>{item}</Text>{item === symbol && <Text style={styles.check}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  container: { padding: 18, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#8E8E93', marginTop: 5, marginBottom: 16 },
  quoteCard: { backgroundColor: '#1E1E1E', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#333', marginBottom: 14 },
  quoteTop: { flexDirection: 'row', justifyContent: 'space-between' },
  quoteSymbol: { color: '#fff', fontSize: 18, fontWeight: '800' },
  quotePrice: { color: '#F0B90B', fontSize: 27, fontWeight: '800', marginTop: 8 },
  change: { fontWeight: '700' },
  quoteDetails: { color: '#8E8E93', fontSize: 11, marginTop: 7 },
  label: { color: '#D4D4D8', fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#1E1E1E', color: '#fff', borderRadius: 12, padding: 14, fontSize: 17 },
  pairSelector: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  pairValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  hint: { color: '#8E8E93', fontSize: 11, marginTop: 3 },
  arrow: { color: '#F0B90B', fontSize: 25 },
  error: { color: '#FF6B6B', marginTop: 10 },
  row: { flexDirection: 'row', gap: 12, marginTop: 18 },
  button: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buy: { backgroundColor: '#15803D' },
  sell: { backgroundColor: '#B91C1C' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  smartCard: { backgroundColor: '#191919', borderWidth: 1, borderColor: '#F0B90B', borderRadius: 14, padding: 15, marginTop: 22 },
  smartHeader: { flexDirection: 'row', alignItems: 'center' },
  smartTitle: { color: '#F0B90B', fontSize: 18, fontWeight: '900' },
  smartSub: { color: '#8E8E93', fontSize: 10, marginTop: 3, paddingRight: 8 },
  smartNotice: { color: '#D4D4D8', fontSize: 12, lineHeight: 17, marginVertical: 12 },
  holdingBox: { backgroundColor: '#222', borderRadius: 8, padding: 10, marginBottom: 8 },
  holdingTitle: { color: '#F0B90B', fontSize: 11, fontWeight: '800' },
  holdingText: { color: '#D4D4D8', fontSize: 11, marginTop: 4 },
  grid: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  smallLabel: { color: '#A1A1AA', fontSize: 11, marginTop: 8, marginBottom: 4 },
  smallInput: { backgroundColor: '#242424', color: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: '#333' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  stat: { color: '#fff', fontWeight: '700' },
  candidate: { color: '#F0B90B', fontSize: 11, marginTop: 8 },
  status: { color: '#D4D4D8', fontSize: 12, lineHeight: 17, marginVertical: 12 },
  smartButton: { backgroundColor: '#F0B90B', padding: 14, borderRadius: 10, alignItems: 'center' },
  smartButtonText: { color: '#111', fontWeight: '900' },
  stopButton: { backgroundColor: '#B91C1C', padding: 14, borderRadius: 10, alignItems: 'center' },
  card: { backgroundColor: '#1E1E1E', borderRadius: 14, padding: 15, marginTop: 18 },
  cardTitle: { color: '#fff', fontWeight: '800', marginBottom: 8 },
  line: { color: '#D4D4D8', marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.75)', justifyContent: 'flex-end' },
  modal: { height: '80%', backgroundColor: '#181818', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  close: { color: '#fff', fontSize: 22 },
  search: { backgroundColor: '#242424', color: '#fff', borderRadius: 10, padding: 12, marginVertical: 12 },
  pairRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333', flexDirection: 'row', justifyContent: 'space-between' },
  pairRowText: { color: '#fff', fontWeight: '700' },
  check: { color: '#F0B90B', fontWeight: '900' },
});
