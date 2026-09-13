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
  fromPortfolio: boolean;
}

interface SmartCandidateScore {
  market: SpotMarketCandidate;
  windowMomentumPct: number;
  shortMomentumPct: number;
  score: number;
}

const FALLBACK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'PEPEUSDT', 'SUIUSDT', 'LINKUSDT', 'AVAXUSDT'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toNumber = (value: string) => Number(value.replace(',', '.'));
const priceText = (value: number) => value >= 1000 ? value.toFixed(2) : value >= 1 ? value.toFixed(5) : value.toFixed(8);

// Smart Auto 1.3.3: decyzje wejścia/wyjścia bazują na ruchu ceny, nie na prowizji.
const SCAN_SAMPLES = 6;
const SCAN_INTERVAL_MS = 1500;
const MIN_ENTRY_MOMENTUM_PCT = 0.015;
const MAX_ENTRY_MOMENTUM_PCT = 3;
const MAX_SPREAD_PCT = 0.35;
const TRAIL_ARM_MOVE_PCT = 0.05;
const TRAIL_DROP_PCT = 0.02;

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
  const [scanCount, setScanCount] = useState(0);
  const [smartStatus, setSmartStatus] = useState('Gotowy');
  const [scanInfo, setScanInfo] = useState('');
  const [activeScore, setActiveScore] = useState<SmartCandidateScore | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!smartRunning && initialSymbol) setSymbol(initialSymbol.toUpperCase());
    if (initialHolding && !smartRunning) setSmartEnabled(true);
  }, [initialHolding, initialSymbol, smartRunning]);

  useEffect(() => {
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0 || value > maxOrderUsdt) {
      setAmount(String(Math.min(5, maxOrderUsdt)));
    }
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
        // Zachowaj ostatnią cenę.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { mounted = false; clearInterval(timer); };
  }, [symbol]);

  const filteredPairs = useMemo(() => {
    const query = pairSearch.trim().toUpperCase();
    return query ? pairs.filter((pair) => pair.includes(query)) : pairs;
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
    setSmartStatus('STOP: kończę skan; jeśli jest otwarta pozycja, zamykam ją po rynku...');
  };

  const scanBestCandidate = async (): Promise<SmartCandidateScore | null> => {
    setSmartStatus(`SMART AUTO: skan ${scanCount + 1} • zbieram ${SCAN_SAMPLES} próbek rynku...`);
    const tracks = new Map<string, SpotMarketCandidate[]>();
    let latest: SpotMarketCandidate[] = [];

    for (let sample = 0; sample < SCAN_SAMPLES; sample += 1) {
      if (stopRef.current) return null;
      latest = await fetchSpotUsdtMarketCandidates(40);
      for (const item of latest) {
        const history = tracks.get(item.symbol) || [];
        history.push(item);
        tracks.set(item.symbol, history);
      }
      setScanInfo(`Skan ${scanCount + 1}: próbka ${sample + 1}/${SCAN_SAMPLES}`);
      if (sample < SCAN_SAMPLES - 1) await sleep(SCAN_INTERVAL_MS);
    }

    setScanCount((value) => value + 1);
    const ranked: SmartCandidateScore[] = [];
    let bestObserved: { symbol: string; momentum: number; spread: number } | null = null;

    for (const now of latest) {
      const history = tracks.get(now.symbol) || [];
      if (history.length < 4) continue;
      const first = history[0];
      const shortBase = history[Math.max(0, history.length - 3)];
      if (first.lastPrice <= 0 || shortBase.lastPrice <= 0) continue;

      const windowMomentumPct = ((now.lastPrice - first.lastPrice) / first.lastPrice) * 100;
      const shortMomentumPct = ((now.lastPrice - shortBase.lastPrice) / shortBase.lastPrice) * 100;

      if (!bestObserved || windowMomentumPct > bestObserved.momentum) {
        bestObserved = { symbol: now.symbol, momentum: windowMomentumPct, spread: now.spreadPct };
      }

      if (windowMomentumPct < MIN_ENTRY_MOMENTUM_PCT) continue;
      if (windowMomentumPct > MAX_ENTRY_MOMENTUM_PCT) continue;
      if (shortMomentumPct < -0.01) continue;
      if (now.spreadPct > MAX_SPREAD_PCT) continue;

      const liquidityScore = Math.max(0, Math.log10(Math.max(now.turnover24h, 1)) - 5);
      const score = windowMomentumPct * 260 + shortMomentumPct * 420 + Math.max(0, now.change24hPct) * 0.05 + liquidityScore * 0.55 - now.spreadPct * 55;
      ranked.push({ market: now, windowMomentumPct, shortMomentumPct, score });
    }

    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0] || null;
    setActiveScore(best);

    if (best) {
      setScanInfo(
        `WYBRANO ${best.market.symbol} • ruch ${best.windowMomentumPct >= 0 ? '+' : ''}${best.windowMomentumPct.toFixed(4)}% • ostatnie próbki ${best.shortMomentumPct >= 0 ? '+' : ''}${best.shortMomentumPct.toFixed(4)}% • spread ${best.market.spreadPct.toFixed(3)}%`
      );
    } else if (bestObserved) {
      const reason = bestObserved.momentum < MIN_ENTRY_MOMENTUM_PCT
        ? `ruch < ${MIN_ENTRY_MOMENTUM_PCT.toFixed(3)}%`
        : bestObserved.spread > MAX_SPREAD_PCT
          ? `spread > ${MAX_SPREAD_PCT.toFixed(2)}%`
          : 'ruch wygasa w ostatnich próbkach';
      setScanInfo(`BRAK BUY • najlepszy ${bestObserved.symbol} ${bestObserved.momentum >= 0 ? '+' : ''}${bestObserved.momentum.toFixed(4)}% • ${reason}`);
    } else {
      setScanInfo('BRAK BUY • za mało danych ze skanera');
    }

    return best;
  };

  const monitorAndSell = async (
    position: SmartPosition,
    realizedBefore: number,
    sessionLossLimit: number
  ): Promise<{ pnl: number; reason: string }> => {
    let peakMovePct = Number.NEGATIVE_INFINITY;
    let trailingArmed = false;
    let reason = 'MANUAL STOP';

    while (!stopRef.current) {
      const snapshot = await fetchSpotMarketSnapshot(position.symbol);
      setMarket(snapshot);
      setSymbol(position.symbol);
      const executablePrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
      const currentValue = executablePrice * position.qty;
      const pricePnlUsdt = currentValue - position.costUsdt;
      const movePct = position.entryPrice > 0 ? ((executablePrice - position.entryPrice) / position.entryPrice) * 100 : 0;
      peakMovePct = Math.max(peakMovePct, movePct);

      if (movePct >= TRAIL_ARM_MOVE_PCT) trailingArmed = true;
      const pullbackPct = trailingArmed ? peakMovePct - movePct : 0;

      setSmartStatus(
        `${position.symbol} • ruch ${movePct >= 0 ? '+' : ''}${movePct.toFixed(4)}% • max ${peakMovePct >= 0 ? '+' : ''}${peakMovePct.toFixed(4)}% • cofnięcie ${pullbackPct.toFixed(4)}% • PnL ceny ${pricePnlUsdt >= 0 ? '+' : ''}${pricePnlUsdt.toFixed(4)} USDT`
      );

      if (realizedBefore + pricePnlUsdt <= -sessionLossLimit) {
        reason = 'MAX STRATA';
        break;
      }
      if (trailingArmed && pullbackPct >= TRAIL_DROP_PCT && movePct > 0) {
        reason = 'TRAILING CENY';
        break;
      }

      await sleep(1400);
    }

    setSmartStatus(`${reason}: SELL ${position.symbol}...`);
    const sellAck = await placeSpotMarketSellBase(credentials, position.symbol, position.qty);
    const sell = await waitForSpotFill(credentials, sellAck.orderId);
    const pnl = sell.quoteValue - position.costUsdt;
    return { pnl, reason };
  };

  const startSmart = () => {
    const trade = toNumber(amount);
    const target = toNumber(targetProfit);
    const loss = toNumber(maxLoss);
    const cycles = Math.floor(toNumber(maxCycles));

    if (!Number.isFinite(trade) || trade <= 0 || trade > maxOrderUsdt) return setError(`Kwota Smart Auto musi być > 0 i <= ${maxOrderUsdt} USDT.`);
    if (![target, loss].every((value) => Number.isFinite(value) && value > 0)) return setError('Cel zysku i max strata muszą być większe od 0.');
    if (!Number.isFinite(cycles) || cycles < 1 || cycles > 1000) return setError('Maksymalna liczba cykli: 1–1000.');

    const holdingText = initialHolding
      ? ` Najpierw Smart Auto będzie obserwował posiadane ${initialHolding.symbol.replace(/USDT$/, '')} (${initialHolding.baseQty}).`
      : '';

    Alert.alert(
      'SMART AUTO LIVE — prawdziwe pieniądze',
      `Smart Auto skanuje ruch ceny w kilku kolejnych próbkach zamiast pojedynczego odczytu. BUY wymaga rosnącego momentum. Po BUY trailing ceny uzbraja się od +${TRAIL_ARM_MOVE_PCT.toFixed(2)}% i sprzedaje po cofnięciu o ${TRAIL_DROP_PCT.toFixed(2)} pkt proc. Max strata sesji: ${loss.toFixed(2)} USDT.${holdingText} Zysk nie jest gwarantowany.`,
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
            setScanCount(0);
            setScanInfo('Start skanera...');
            setActiveScore(null);

            let total = 0;
            let completedCycles = 0;
            let openPosition: SmartPosition | null = null;
            let portfolioHoldingPending = initialHolding;

            try {
              while (!stopRef.current && completedCycles < cycles && total < target && total > -loss) {
                if (portfolioHoldingPending) {
                  setSymbol(portfolioHoldingPending.symbol);
                  openPosition = {
                    symbol: portfolioHoldingPending.symbol,
                    qty: portfolioHoldingPending.baseQty,
                    costUsdt: portfolioHoldingPending.buyCostUsdt,
                    entryPrice: portfolioHoldingPending.buyPrice,
                    fromPortfolio: true,
                  };
                  setSmartStatus(`Pozycja startowa ${portfolioHoldingPending.symbol}: obserwuję ruch ceny od ceny zakupu...`);
                  portfolioHoldingPending = null;
                } else {
                  let candidate: SmartCandidateScore | null = null;
                  while (!candidate && !stopRef.current) {
                    candidate = await scanBestCandidate();
                    if (!candidate && !stopRef.current) {
                      setSmartStatus('Nie ma jeszcze ruchu wejściowego. Czekam 2 s i skanuję ponownie.');
                      await sleep(2000);
                    }
                  }
                  if (!candidate || stopRef.current) break;

                  setSymbol(candidate.market.symbol);
                  setMarket(candidate.market);
                  setSmartStatus(`${candidate.market.symbol}: ruch +${candidate.windowMomentumPct.toFixed(4)}% • BUY ${trade.toFixed(2)} USDT`);
                  const buyAck = await placeSpotMarketOrder(credentials, candidate.market.symbol, 'Buy', trade, maxOrderUsdt);
                  setLastAck(buyAck);
                  const buy = await waitForSpotFill(credentials, buyAck.orderId);
                  const baseCoin = candidate.market.symbol.replace(/USDT$/, '');
                  const qty = Math.max(0, buy.baseQty - (buy.feeByCurrency[baseCoin] || 0));
                  const costUsdt = buy.quoteValue;
                  if (qty <= 0 || costUsdt <= 0 || buy.avgPrice <= 0) throw new Error('Brak prawidłowej ilości lub ceny po BUY.');

                  openPosition = {
                    symbol: candidate.market.symbol,
                    qty,
                    costUsdt,
                    entryPrice: buy.avgPrice,
                    fromPortfolio: false,
                  };
                }

                if (!openPosition) continue;
                const result = await monitorAndSell(openPosition, total, loss);
                total += result.pnl;
                completedCycles += 1;
                setCycleCount(completedCycles);
                setSessionProfit(total);
                setSmartStatus(`${result.reason} • zamknięty cykl ${completedCycles} • wynik cyklu ${result.pnl >= 0 ? '+' : ''}${result.pnl.toFixed(4)} USDT • sesja ${total >= 0 ? '+' : ''}${total.toFixed(4)} USDT`);
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
              <Text style={styles.smartSub}>Skan ruchu ceny → BUY → trailing ceny → SELL → USDT → kolejny skan</Text>
            </View>
            <Switch value={smartEnabled} onValueChange={(value) => { if (!smartRunning) setSmartEnabled(value); }} disabled={smartRunning} />
          </View>

          {smartEnabled && <>
            <Text style={styles.smartNotice}>
              Skaner analizuje kilka kolejnych próbek rynku. Wejście nie zależy od prowizji. Trailing ceny uzbraja się przy +{TRAIL_ARM_MOVE_PCT.toFixed(2)}% od ceny zakupu i reaguje po cofnięciu o {TRAIL_DROP_PCT.toFixed(2)} pkt proc. Max strata sesji pozostaje aktywna.
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

            <Text style={styles.smallLabel}>Maksymalna liczba zamkniętych cykli (1–1000)</Text>
            <TextInput value={maxCycles} onChangeText={setMaxCycles} editable={!smartRunning} keyboardType="number-pad" style={styles.smallInput} />

            <View style={styles.stats}>
              <Text style={styles.stat}>Zamknięte cykle: {cycleCount}</Text>
              <Text style={styles.stat}>Skany: {scanCount}</Text>
              <Text style={[styles.stat, { color: sessionProfit >= 0 ? '#22C55E' : '#EF4444' }]}>PnL {sessionProfit >= 0 ? '+' : ''}{sessionProfit.toFixed(4)}</Text>
            </View>

            {!!scanInfo && <Text style={styles.scanInfo}>{scanInfo}</Text>}
            {activeScore && (
              <Text style={styles.candidate}>
                Kandydat: {activeScore.market.symbol} • ruch +{activeScore.windowMomentumPct.toFixed(4)}% • krótki +{activeScore.shortMomentumPct.toFixed(4)}%
              </Text>
            )}
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
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pairRow} onPress={() => selectPair(item)}>
                  <Text style={styles.pairRowText}>{item}</Text>
                  {item === symbol && <Text style={styles.check}>✓</Text>}
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
  title: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#8E8E93', marginTop: 5, marginBottom: 16 },
  quoteCard: { backgroundColor: '#1E1E1E', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#333333', marginBottom: 14 },
  quoteTop: { flexDirection: 'row', justifyContent: 'space-between' },
  quoteSymbol: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  quotePrice: { color: '#F0B90B', fontSize: 27, fontWeight: '800', marginTop: 8 },
  change: { fontWeight: '700' },
  quoteDetails: { color: '#8E8E93', fontSize: 11, marginTop: 7 },
  label: { color: '#D4D4D8', fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#1E1E1E', color: '#FFFFFF', borderRadius: 12, padding: 14, fontSize: 17 },
  pairSelector: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#333333' },
  pairValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  hint: { color: '#8E8E93', fontSize: 11, marginTop: 3 },
  arrow: { color: '#F0B90B', fontSize: 25 },
  error: { color: '#FF6B6B', marginTop: 10 },
  row: { flexDirection: 'row', gap: 12, marginTop: 18 },
  button: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buy: { backgroundColor: '#15803D' },
  sell: { backgroundColor: '#B91C1C' },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  smartCard: { backgroundColor: '#191919', borderWidth: 1, borderColor: '#F0B90B', borderRadius: 14, padding: 15, marginTop: 22 },
  smartHeader: { flexDirection: 'row', alignItems: 'center' },
  smartTitle: { color: '#F0B90B', fontSize: 18, fontWeight: '900' },
  smartSub: { color: '#8E8E93', fontSize: 10, marginTop: 3, paddingRight: 8 },
  smartNotice: { color: '#D4D4D8', fontSize: 12, lineHeight: 17, marginVertical: 12 },
  holdingBox: { backgroundColor: '#222222', borderRadius: 8, padding: 10, marginBottom: 8 },
  holdingTitle: { color: '#F0B90B', fontSize: 11, fontWeight: '800' },
  holdingText: { color: '#D4D4D8', fontSize: 11, marginTop: 4 },
  grid: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  smallLabel: { color: '#A1A1AA', fontSize: 11, marginTop: 8, marginBottom: 4 },
  smallInput: { backgroundColor: '#242424', color: '#FFFFFF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: '#333333' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 14 },
  stat: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
  scanInfo: { color: '#F0B90B', fontSize: 11, lineHeight: 16, marginTop: 12 },
  candidate: { color: '#22C55E', fontSize: 11, lineHeight: 16, marginTop: 7 },
  status: { color: '#D4D4D8', fontSize: 12, lineHeight: 17, marginVertical: 12 },
  smartButton: { backgroundColor: '#F0B90B', padding: 14, borderRadius: 10, alignItems: 'center' },
  smartButtonText: { color: '#111111', fontWeight: '900' },
  stopButton: { backgroundColor: '#B91C1C', padding: 14, borderRadius: 10, alignItems: 'center' },
  card: { backgroundColor: '#1E1E1E', borderRadius: 14, padding: 15, marginTop: 18 },
  cardTitle: { color: '#FFFFFF', fontWeight: '800', marginBottom: 8 },
  line: { color: '#D4D4D8', marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.75)', justifyContent: 'flex-end' },
  modal: { height: '80%', backgroundColor: '#181818', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  close: { color: '#FFFFFF', fontSize: 22 },
  search: { backgroundColor: '#242424', color: '#FFFFFF', borderRadius: 10, padding: 12, marginVertical: 12 },
  pairRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333333', flexDirection: 'row', justifyContent: 'space-between' },
  pairRowText: { color: '#FFFFFF', fontWeight: '700' },
  check: { color: '#F0B90B', fontWeight: '900' },
});
