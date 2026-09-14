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
  fetchWalletBalance,
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

type SmartMode = 'shadow' | 'assist';

interface SmartCandidateScore {
  market: SpotMarketCandidate;
  windowMomentumPct: number;
  shortMomentumPct: number;
  score: number;
}

interface TrackedPosition {
  id: string;
  symbol: string;
  qty: number;
  costUsdt: number;
  entryPrice: number;
  peakMovePct: number;
  currentMovePct: number;
  currentPnlUsdt: number;
  sellReady: boolean;
  fromPortfolio?: boolean;
}

const FALLBACK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'LINKUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'SUIUSDT'];
const CORE_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toNumber = (value: string) => Number(value.replace(',', '.'));
const priceText = (value: number) => value >= 1000 ? value.toFixed(2) : value >= 1 ? value.toFixed(5) : value.toFixed(8);
const SCAN_SAMPLES = 7;
const SCAN_INTERVAL_MS = 1400;
const MIN_ENTRY_MOMENTUM_PCT = 0.06;
const MAX_ENTRY_MOMENTUM_PCT = 2.5;
const MAX_SPREAD_PCT = 0.20;
const TRAIL_ARM_MOVE_PCT = 0.18;
const TRAIL_DROP_PCT = 0.07;

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
  const [smartMode, setSmartMode] = useState<SmartMode>('assist');
  const [smartRunning, setSmartRunning] = useState(false);
  const [targetProfit, setTargetProfit] = useState('0');
  const [maxLoss, setMaxLoss] = useState('2');
  const [maxCycles, setMaxCycles] = useState('1000');
  const [maxSlots, setMaxSlots] = useState('3');
  const [shadowCapital, setShadowCapital] = useState('25');
  const [shadowUsdt, setShadowUsdt] = useState(25);
  const [availableUsdt, setAvailableUsdt] = useState(0);
  const [sessionProfit, setSessionProfit] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);
  const [scanCount, setScanCount] = useState(0);
  const [smartStatus, setSmartStatus] = useState('Gotowy');
  const [scanInfo, setScanInfo] = useState('');
  const [activeScore, setActiveScore] = useState<SmartCandidateScore | null>(null);
  const [assistCandidate, setAssistCandidate] = useState<SmartCandidateScore | null>(null);
  const [shadowPositions, setShadowPositions] = useState<TrackedPosition[]>([]);
  const [livePositions, setLivePositions] = useState<TrackedPosition[]>([]);

  const stopRef = useRef(false);
  const scanCountRef = useRef(0);
  const shadowPositionsRef = useRef<TrackedPosition[]>([]);
  const livePositionsRef = useRef<TrackedPosition[]>([]);
  const assistCandidateRef = useRef<SmartCandidateScore | null>(null);
  const shadowUsdtRef = useRef(25);
  const sessionProfitRef = useRef(0);
  const cycleCountRef = useRef(0);

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

  const refreshAvailableUsdt = async (): Promise<number> => {
    try {
      const wallet = await fetchWalletBalance(credentials);
      const coin = wallet?.coin?.find((item) => item.coin === 'USDT');
      const free = Number(coin?.free || coin?.availableToWithdraw || coin?.walletBalance || 0);
      const value = Number.isFinite(free) && free > 0 ? free : 0;
      setAvailableUsdt(value);
      return value;
    } catch {
      return availableUsdt;
    }
  };

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

  const sellMax = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const baseCoin = symbol.replace(/USDT$/, '');
      const wallet = await fetchWalletBalance(credentials);
      const coin = wallet?.coin?.find((item) => item.coin === baseCoin);
      const free = Number(coin?.free || 0);
      const withdrawable = Number(coin?.availableToWithdraw || 0);
      const walletBalance = Number(coin?.walletBalance || 0);
      const locked = Number(coin?.locked || 0);
      const fallbackAvailable = Math.max(0, walletBalance - Math.max(0, locked));
      const qty = free > 0 ? free : withdrawable > 0 ? withdrawable : fallbackAvailable;

      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`Brak dostępnego salda ${baseCoin} do sprzedaży.`);
        setBusy(false);
        return;
      }

      const executablePrice = market ? (market.bid > 0 ? market.bid : market.lastPrice) : 0;
      const approxUsdt = executablePrice > 0 ? qty * executablePrice : 0;
      setBusy(false);

      Alert.alert(
        'SELL MAX — sprzedaż całego salda',
        `Sprzedać całe dostępne saldo ${baseCoin}: ${qty.toPrecision(8)} ${baseCoin}${approxUsdt > 0 ? ` (około ${approxUsdt.toFixed(2)} USDT)` : ''}?`,
        [
          { text: 'Anuluj', style: 'cancel' },
          {
            text: 'SPRZEDAJ CAŁOŚĆ',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              setError('');
              const startedAt = Date.now();
              try {
                const ack = await placeSpotMarketSellBase(credentials, symbol, qty);
                const fill = await waitForSpotFill(credentials, ack.orderId);
                setLastAck({
                  ...ack,
                  requestLatencyMs: Date.now() - startedAt,
                  symbol,
                  side: 'Sell',
                  quoteAmountUsdt: fill.quoteValue,
                });

                livePositionsRef.current = livePositionsRef.current.filter((item) => item.symbol !== symbol);
                setLivePositions([...livePositionsRef.current]);
                if (initialHolding?.symbol === symbol) onHoldingConsumed?.();
                setSmartStatus(`SELL MAX ${symbol}: sprzedano ${fill.baseQty} ${baseCoin} za ${fill.quoteValue.toFixed(2)} USDT.`);
                await refreshAvailableUsdt();
              } catch (e: unknown) {
                setError(e instanceof Error ? e.message : 'Błąd sprzedaży MAX.');
              } finally {
                setBusy(false);
              }
            },
          },
        ]
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać salda aktywa.');
      setBusy(false);
    }
  };

  const stopSmart = () => {
    stopRef.current = true;
    setSmartStatus('STOP: kończę skanowanie. Otwarte pozycje SMART AUTO pozostają bez zmian.');
  };

  const scanBestCandidate = async (): Promise<SmartCandidateScore | null> => {
    const scanNo = scanCountRef.current + 1;
    setSmartStatus(`Skan ${scanNo}: zbieram ${SCAN_SAMPLES} próbek rynku...`);
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
      setScanInfo(`Skan ${scanNo}: próbka ${sample + 1}/${SCAN_SAMPLES}`);
      if (sample < SCAN_SAMPLES - 1) await sleep(SCAN_INTERVAL_MS);
    }

    scanCountRef.current = scanNo;
    setScanCount(scanNo);
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

      const isCore = CORE_SYMBOLS.has(now.symbol);
      const requiredMomentum = isCore ? MIN_ENTRY_MOMENTUM_PCT : MIN_ENTRY_MOMENTUM_PCT * 1.7;
      if (windowMomentumPct < requiredMomentum || windowMomentumPct > MAX_ENTRY_MOMENTUM_PCT) continue;
      if (shortMomentumPct < 0 || now.spreadPct > MAX_SPREAD_PCT) continue;

      const liquidityScore = Math.max(0, Math.log10(Math.max(now.turnover24h, 1)) - 5);
      const coreQualityBonus = isCore ? 18 : 0;
      const score = windowMomentumPct * 260 + shortMomentumPct * 420 + liquidityScore * 2.2 + coreQualityBonus - now.spreadPct * 70;
      ranked.push({ market: now, windowMomentumPct, shortMomentumPct, score });
    }

    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0] || null;
    setActiveScore(best);
    if (best) {
      const quality = CORE_SYMBOLS.has(best.market.symbol) ? 'CORE' : 'ALT';
      setScanInfo(`WYBRANO ${best.market.symbol} • ${quality} • ruch +${best.windowMomentumPct.toFixed(4)}% • krótki +${best.shortMomentumPct.toFixed(4)}% • spread ${best.market.spreadPct.toFixed(3)}%`);
    } else if (bestObserved) {
      setScanInfo(`BRAK WEJŚCIA • najlepszy ${bestObserved.symbol} ${bestObserved.momentum >= 0 ? '+' : ''}${bestObserved.momentum.toFixed(4)}% • czekam na mocniejszy ruch`);
    } else {
      setScanInfo('BRAK WEJŚCIA • za mało danych');
    }
    return best;
  };

  const updateTrackedPosition = async (position: TrackedPosition): Promise<TrackedPosition> => {
    const snapshot = await fetchSpotMarketSnapshot(position.symbol);
    const executablePrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
    const movePct = position.entryPrice > 0 ? ((executablePrice - position.entryPrice) / position.entryPrice) * 100 : 0;
    const peakMovePct = Math.max(position.peakMovePct, movePct);
    const currentPnlUsdt = executablePrice * position.qty - position.costUsdt;
    const armed = peakMovePct >= TRAIL_ARM_MOVE_PCT;
    const pullback = armed ? peakMovePct - movePct : 0;
    const sellReady = armed && pullback >= TRAIL_DROP_PCT && movePct > 0 && currentPnlUsdt > 0;
    return {
      ...position,
      peakMovePct,
      currentMovePct: movePct,
      currentPnlUsdt,
      sellReady,
    };
  };

  const confirmAssistBuy = () => {
    const candidate = assistCandidateRef.current;
    const trade = toNumber(amount);
    const slots = Math.max(1, Math.min(3, Math.floor(toNumber(maxSlots)) || 1));
    if (!candidate || !smartRunning || smartMode !== 'assist') return;
    if (livePositionsRef.current.length >= slots) return setError('Wszystkie sloty SMART AUTO są zajęte.');

    Alert.alert(
      'Potwierdź BUY',
      `${candidate.market.symbol} za ${trade.toFixed(2)} USDT?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'KUP',
          onPress: async () => {
            setBusy(true);
            setError('');
            try {
              const free = await refreshAvailableUsdt();
              if (free + 1e-8 < trade) {
                setSmartStatus(`Za mało wolnych USDT (${free.toFixed(2)}). Skaner działa dalej.`);
                setError('Insufficient balance — skaner nie został zatrzymany.');
                return;
              }
              const ack = await placeSpotMarketOrder(credentials, candidate.market.symbol, 'Buy', trade, maxOrderUsdt);
              setLastAck(ack);
              const fill = await waitForSpotFill(credentials, ack.orderId);
              const baseCoin = candidate.market.symbol.replace(/USDT$/, '');
              const qty = Math.max(0, fill.baseQty - (fill.feeByCurrency[baseCoin] || 0));
              const position: TrackedPosition = {
                id: ack.orderId,
                symbol: candidate.market.symbol,
                qty,
                costUsdt: fill.quoteValue,
                entryPrice: fill.avgPrice,
                peakMovePct: 0,
                currentMovePct: 0,
                currentPnlUsdt: 0,
                sellReady: false,
              };
              livePositionsRef.current = [...livePositionsRef.current, position];
              setLivePositions([...livePositionsRef.current]);
              assistCandidateRef.current = null;
              setAssistCandidate(null);
              setSmartStatus(`BUY wykonany: ${position.symbol}. Trzymam do zysku; trailing uruchomi się dopiero po +${TRAIL_ARM_MOVE_PCT.toFixed(2)}%.`);
              await refreshAvailableUsdt();
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Błąd BUY.';
              setError(message);
              setSmartStatus(`BUY nieudany: ${message}. Skaner działa dalej.`);
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const confirmAssistSell = (position: TrackedPosition) => {
    if (!position.sellReady || position.currentPnlUsdt <= 0) {
      setError('SMART AUTO nie wystawia SELL na stracie. Pozycja pozostaje w monitoringu.');
      return;
    }
    Alert.alert(
      'Potwierdź SELL',
      `${position.symbol} • ruch +${position.currentMovePct.toFixed(4)}% • PnL +${position.currentPnlUsdt.toFixed(4)} USDT?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'SPRZEDAJ',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError('');
            try {
              const ack = await placeSpotMarketSellBase(credentials, position.symbol, position.qty);
              const fill = await waitForSpotFill(credentials, ack.orderId);
              const pnl = fill.quoteValue - position.costUsdt;
              livePositionsRef.current = livePositionsRef.current.filter((item) => item.id !== position.id);
              setLivePositions([...livePositionsRef.current]);
              cycleCountRef.current += 1;
              sessionProfitRef.current += pnl;
              setCycleCount(cycleCountRef.current);
              setSessionProfit(sessionProfitRef.current);
              if (position.fromPortfolio) onHoldingConsumed?.();
              setSmartStatus(`SELL ${position.symbol} • wynik ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} USDT. Skaner działa dalej.`);
              await refreshAvailableUsdt();
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Błąd SELL.';
              setError(message);
              setSmartStatus(`SELL nieudany: ${message}. Skaner nadal monitoruje pozycje.`);
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const startSmart = () => {
    const trade = toNumber(amount);
    const target = toNumber(targetProfit);
    const loss = toNumber(maxLoss);
    const cycles = Math.floor(toNumber(maxCycles));
    const slots = Math.max(1, Math.min(3, Math.floor(toNumber(maxSlots)) || 1));
    const virtualCapital = toNumber(shadowCapital);

    if (!Number.isFinite(trade) || trade <= 0 || trade > maxOrderUsdt) return setError(`Kwota musi być > 0 i <= ${maxOrderUsdt} USDT.`);
    if (!Number.isFinite(target) || target < 0) return setError('Cel zysku: 0 lub więcej. 0 = bez limitu.');
    if (!Number.isFinite(loss) || loss <= 0) return setError('Max strata musi być > 0.');
    if (!Number.isFinite(cycles) || cycles < 1 || cycles > 1000) return setError('Minimalna liczba cykli: 1–1000.');
    if (smartMode === 'shadow' && (!Number.isFinite(virtualCapital) || virtualCapital < Math.max(10, trade))) return setError('Kapitał SHADOW: minimum 10 USDT i co najmniej wartość jednej transakcji.');

    stopRef.current = false;
    scanCountRef.current = 0;
    cycleCountRef.current = 0;
    sessionProfitRef.current = 0;
    shadowPositionsRef.current = [];
    assistCandidateRef.current = null;
    setSmartRunning(true);
    setError('');
    setCycleCount(0);
    setScanCount(0);
    setSessionProfit(0);
    setActiveScore(null);
    setAssistCandidate(null);
    setScanInfo('Start skanera jakości rynku...');

    if (smartMode === 'shadow') {
      shadowUsdtRef.current = virtualCapital;
      setShadowUsdt(virtualCapital);
      setShadowPositions([]);
    } else {
      void refreshAvailableUsdt();
      if (initialHolding && livePositionsRef.current.every((item) => item.symbol !== initialHolding.symbol)) {
        const seed: TrackedPosition = {
          id: `portfolio-${initialHolding.symbol}-${Date.now()}`,
          symbol: initialHolding.symbol,
          qty: initialHolding.baseQty,
          costUsdt: initialHolding.buyCostUsdt,
          entryPrice: initialHolding.buyPrice,
          peakMovePct: 0,
          currentMovePct: 0,
          currentPnlUsdt: 0,
          sellReady: false,
          fromPortfolio: true,
        };
        livePositionsRef.current = [...livePositionsRef.current, seed];
        setLivePositions([...livePositionsRef.current]);
      }
    }

    void (async () => {
      while (!stopRef.current) {
        try {
          if (smartMode === 'shadow') {
            const refreshed: TrackedPosition[] = [];
            for (const position of shadowPositionsRef.current) {
              const updated = await updateTrackedPosition(position);
              if (updated.sellReady) {
                const snapshot = await fetchSpotMarketSnapshot(updated.symbol);
                const exitPrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
                const proceeds = exitPrice * updated.qty;
                const pnl = proceeds - updated.costUsdt;
                if (pnl > 0) {
                  shadowUsdtRef.current += proceeds;
                  sessionProfitRef.current += pnl;
                  cycleCountRef.current += 1;
                  setSmartStatus(`SHADOW SELL ${updated.symbol} • +${pnl.toFixed(4)} USDT • szukam dalej.`);
                } else {
                  refreshed.push({ ...updated, sellReady: false });
                }
              } else {
                refreshed.push(updated);
              }
            }
            shadowPositionsRef.current = refreshed;
            setShadowPositions([...refreshed]);
            setShadowUsdt(shadowUsdtRef.current);
            setCycleCount(cycleCountRef.current);
            setSessionProfit(sessionProfitRef.current);

            if (cycleCountRef.current >= cycles && sessionProfitRef.current >= 0 && refreshed.length === 0) break;
            if (target > 0 && sessionProfitRef.current >= target && refreshed.length === 0) break;
            if (sessionProfitRef.current <= -loss) break;

            if (refreshed.length < slots && shadowUsdtRef.current >= trade) {
              const candidate = await scanBestCandidate();
              if (candidate && refreshed.every((item) => item.symbol !== candidate.market.symbol)) {
                const entry = candidate.market.ask > 0 ? candidate.market.ask : candidate.market.lastPrice;
                const qty = trade / entry;
                const position: TrackedPosition = {
                  id: `shadow-${Date.now()}-${candidate.market.symbol}`,
                  symbol: candidate.market.symbol,
                  qty,
                  costUsdt: trade,
                  entryPrice: entry,
                  peakMovePct: 0,
                  currentMovePct: 0,
                  currentPnlUsdt: 0,
                  sellReady: false,
                };
                shadowUsdtRef.current -= trade;
                shadowPositionsRef.current = [...shadowPositionsRef.current, position];
                setShadowPositions([...shadowPositionsRef.current]);
                setShadowUsdt(shadowUsdtRef.current);
                setSmartStatus(`SHADOW BUY ${position.symbol} ${trade.toFixed(2)} USDT • sloty ${shadowPositionsRef.current.length}/${slots} • trzymam do zysku.`);
              }
            } else {
              setSmartStatus(`SHADOW: monitoruję ${refreshed.length}/${slots} pozycji. Pozycje na minusie pozostają otwarte.`);
              await sleep(1600);
            }
          } else {
            const refreshed: TrackedPosition[] = [];
            for (const position of livePositionsRef.current) {
              try {
                refreshed.push(await updateTrackedPosition(position));
              } catch {
                refreshed.push(position);
              }
            }
            livePositionsRef.current = refreshed;
            setLivePositions([...refreshed]);

            const free = await refreshAvailableUsdt();
            if (refreshed.length < slots && free + 1e-8 >= trade) {
              const candidate = await scanBestCandidate();
              if (candidate && refreshed.every((item) => item.symbol !== candidate.market.symbol)) {
                assistCandidateRef.current = candidate;
                setAssistCandidate(candidate);
                setSmartStatus(`BUY GOTOWY: ${candidate.market.symbol} • ${trade.toFixed(2)} USDT. SMART AUTO nadal monitoruje pozostałe pozycje.`);
              }
            } else if (refreshed.length >= slots) {
              setSmartStatus(`SMART AUTO: ${refreshed.length}/${slots} slotów zajętych. Trzymam pozycje do zysku i monitoruję trailing.`);
            } else {
              setSmartStatus(`SMART AUTO: wolne USDT ${free.toFixed(2)} < ${trade.toFixed(2)}. Monitoruję istniejące pozycje.`);
              await sleep(1800);
            }
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Błąd skanera.';
          setError(message);
          setSmartStatus(`Błąd chwilowy: ${message}. Ponawiam za 3 s — SMART AUTO nie został zatrzymany.`);
          await sleep(3000);
        }
      }

      setSmartRunning(false);
      stopRef.current = false;
      if (cycleCountRef.current >= cycles && sessionProfitRef.current >= 0) setSmartStatus(`Min. ${cycles} cykli wykonane: ${sessionProfitRef.current >= 0 ? '+' : ''}${sessionProfitRef.current.toFixed(4)} USDT.`);
      else if (target > 0 && sessionProfitRef.current >= target) setSmartStatus(`Cel sesji osiągnięty: +${sessionProfitRef.current.toFixed(4)} USDT.`);
      else if (sessionProfitRef.current <= -loss) setSmartStatus(`Max strata sesji: ${sessionProfitRef.current.toFixed(4)} USDT.`);
      else setSmartStatus('Skaner zatrzymany ręcznie.');
    })();
  };

  const positionsToRender = smartMode === 'shadow' ? shadowPositions : livePositions;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Trading Spot</Text>
        <Text style={styles.subtitle}>Bybit Spot • ręczny handel + Smart Auto</Text>

        <View style={styles.quoteCard}>
          <View style={styles.quoteTop}>
            <Text style={styles.quoteSymbol}>{symbol}</Text>
            <Text style={[styles.change, { color: (market?.change24hPct || 0) >= 0 ? '#22C55E' : '#EF4444' }]}>
              {market ? `${market.change24hPct >= 0 ? '+' : ''}${market.change24hPct.toFixed(2)}% 24h` : '...'}
            </Text>
          </View>
          <Text style={styles.quotePrice}>{market ? `${priceText(market.lastPrice)} USDT` : 'Pobieranie ceny...'}</Text>
          {market && <Text style={styles.quoteDetails}>Bid {priceText(market.bid)} • Ask {priceText(market.ask)}</Text>}
        </View>

        <Text style={styles.label}>Para ręcznego handlu</Text>
        <TouchableOpacity style={styles.pairSelector} onPress={() => !smartRunning && setPairPickerOpen(true)}>
          <View><Text style={styles.pairValue}>{symbol}</Text><Text style={styles.hint}>Dotknij, aby zmienić</Text></View>
          <Text style={styles.arrow}>⌄</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Kwota pojedynczej transakcji (USDT)</Text>
        <TextInput value={amount} onChangeText={setAmount} editable={!busy} keyboardType="decimal-pad" style={styles.input} />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.row}>
          <TouchableOpacity disabled={busy} style={[styles.button, styles.buy]} onPress={() => submit('Buy')}><Text style={styles.buttonText}>BUY</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy} style={[styles.button, styles.sell]} onPress={() => submit('Sell')}><Text style={styles.buttonText}>SELL</Text></TouchableOpacity>
        </View>
        <TouchableOpacity disabled={busy} style={[styles.maxSellButton, busy && { opacity: 0.6 }]} onPress={() => void sellMax()}>
          <Text style={styles.maxSellText}>SELL MAX — SPRZEDAJ CAŁE SALDO {symbol.replace(/USDT$/, '')}</Text>
        </TouchableOpacity>

        <View style={styles.smartCard}>
          <View style={styles.smartHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.smartTitle}>SMART AUTO</Text>
              <Text style={styles.smartSub}>1–3 najlepsze okazje • mocne rynki mają wyższą wagę • bez SELL na stracie</Text>
            </View>
            <Switch value={smartEnabled} onValueChange={(value) => { if (!smartRunning) setSmartEnabled(value); }} disabled={smartRunning} />
          </View>

          {smartEnabled && <>
            <Text style={styles.smartNotice}>SMART AUTO skanuje cały wybrany rynek, preferuje płynne BTC/ETH/BNB/SOL/XRP/LINK/ADA/AVAX/DOGE i czeka na mocniejszy ruch. Po BUY pozycja jest trzymana do zysku; trailing uzbraja się dopiero od +{TRAIL_ARM_MOVE_PCT.toFixed(2)}%. SHADOW wykonuje tę samą strategię symulacyjnie. Realny BUY/SELL nadal wymaga potwierdzenia.</Text>

            <View style={styles.modeRow}>
              <TouchableOpacity disabled={smartRunning} onPress={() => setSmartMode('assist')} style={[styles.modeButton, smartMode === 'assist' && styles.modeSelected]}><Text style={styles.modeText}>SMART AUTO</Text></TouchableOpacity>
              <TouchableOpacity disabled={smartRunning} onPress={() => setSmartMode('shadow')} style={[styles.modeButton, smartMode === 'shadow' && styles.modeSelected]}><Text style={styles.modeText}>SHADOW</Text></TouchableOpacity>
            </View>

            <View style={styles.grid}>
              <View style={styles.field}><Text style={styles.smallLabel}>Cel zysku (0 = bez limitu)</Text><TextInput value={targetProfit} onChangeText={setTargetProfit} editable={!smartRunning} keyboardType="decimal-pad" style={styles.smallInput} /></View>
              <View style={styles.field}><Text style={styles.smallLabel}>Max strata sesji</Text><TextInput value={maxLoss} onChangeText={setMaxLoss} editable={!smartRunning} keyboardType="decimal-pad" style={styles.smallInput} /></View>
            </View>
            <View style={styles.grid}>
              <View style={styles.field}><Text style={styles.smallLabel}>Min. cykli</Text><TextInput value={maxCycles} onChangeText={setMaxCycles} editable={!smartRunning} keyboardType="number-pad" style={styles.smallInput} /></View>
              <View style={styles.field}><Text style={styles.smallLabel}>Równoległe sloty 1–3</Text><TextInput value={maxSlots} onChangeText={setMaxSlots} editable={!smartRunning} keyboardType="number-pad" style={styles.smallInput} /></View>
            </View>
            {smartMode === 'shadow' ? (
              <><Text style={styles.smallLabel}>Kapitał SHADOW (min. 10 USDT)</Text><TextInput value={shadowCapital} onChangeText={setShadowCapital} editable={!smartRunning} keyboardType="decimal-pad" style={styles.smallInput} /></>
            ) : (
              <Text style={styles.balanceText}>Wolne USDT: {availableUsdt.toFixed(2)}</Text>
            )}

            <View style={styles.stats}>
              <Text style={styles.stat}>Cykle: {cycleCount}</Text>
              <Text style={styles.stat}>Skany: {scanCount}</Text>
              <Text style={[styles.stat, { color: sessionProfit >= 0 ? '#22C55E' : '#EF4444' }]}>PnL {sessionProfit >= 0 ? '+' : ''}{sessionProfit.toFixed(4)}</Text>
              {smartMode === 'shadow' && <Text style={styles.stat}>USDT {shadowUsdt.toFixed(2)}</Text>}
            </View>

            {!!scanInfo && <Text style={styles.scanInfo}>{scanInfo}</Text>}
            {activeScore && <Text style={styles.candidate}>Kandydat: {activeScore.market.symbol} • +{activeScore.windowMomentumPct.toFixed(4)}%</Text>}
            <Text style={styles.status}>{smartStatus}</Text>

            {smartMode === 'assist' && assistCandidate && smartRunning && (
              <TouchableOpacity disabled={busy} style={styles.confirmBuy} onPress={confirmAssistBuy}><Text style={styles.buttonText}>POTWIERDŹ BUY {assistCandidate.market.symbol}</Text></TouchableOpacity>
            )}

            {positionsToRender.map((position) => {
              const state = position.currentPnlUsdt <= 0 ? 'CZEKA NA PLUS' : position.sellReady ? 'SELL READY' : position.peakMovePct >= TRAIL_ARM_MOVE_PCT ? 'TRAILING' : 'NA PLUSIE';
              return (
                <View key={position.id} style={styles.positionCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.positionSymbol}>{position.symbol} • {state}</Text>
                    <Text style={styles.positionLine}>wejście {priceText(position.entryPrice)} • ruch {position.currentMovePct >= 0 ? '+' : ''}{position.currentMovePct.toFixed(4)}%</Text>
                    <Text style={styles.positionLine}>max +{Math.max(0, position.peakMovePct).toFixed(4)}% • PnL {position.currentPnlUsdt >= 0 ? '+' : ''}{position.currentPnlUsdt.toFixed(4)} USDT</Text>
                  </View>
                  {smartMode === 'assist' && position.sellReady && <TouchableOpacity disabled={busy} style={styles.sellReady} onPress={() => confirmAssistSell(position)}><Text style={styles.buttonText}>SELL</Text></TouchableOpacity>}
                </View>
              );
            })}

            {smartRunning ? (
              <TouchableOpacity style={styles.stopButton} onPress={stopSmart}><Text style={styles.buttonText}>STOP SKANERA</Text></TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.smartButton} onPress={startSmart}><Text style={styles.smartButtonText}>{smartMode === 'assist' ? 'START SMART AUTO' : 'START SHADOW'}</Text></TouchableOpacity>
            )}
          </>}
        </View>

        {lastAck && <View style={styles.card}><Text style={styles.cardTitle}>Ostatnie zlecenie</Text><Text style={styles.line}>{lastAck.side} {lastAck.symbol} • {lastAck.quoteAmountUsdt.toFixed(2)} USDT</Text><Text style={styles.line}>Order ID: {lastAck.orderId}</Text></View>}
      </ScrollView>

      <Modal visible={pairPickerOpen} animationType="slide" transparent onRequestClose={() => setPairPickerOpen(false)}>
        <View style={styles.backdrop}><View style={styles.modal}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>Wybierz parę Spot/USDT</Text><TouchableOpacity onPress={() => setPairPickerOpen(false)}><Text style={styles.close}>✕</Text></TouchableOpacity></View>
          <TextInput value={pairSearch} onChangeText={setPairSearch} placeholder="BTC, XRP, ETH..." placeholderTextColor="#666" style={styles.search} />
          {pairsLoading && <ActivityIndicator color="#F0B90B" />}
          <FlatList data={filteredPairs} keyExtractor={(item) => item} renderItem={({ item }) => <TouchableOpacity style={styles.pairRow} onPress={() => selectPair(item)}><Text style={styles.pairRowText}>{item}</Text>{item === symbol && <Text style={styles.check}>✓</Text>}</TouchableOpacity>} />
        </View></View>
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
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  maxSellButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#EF4444', backgroundColor: '#2A1717', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 10 },
  maxSellText: { color: '#FF6B6B', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  smartCard: { backgroundColor: '#191919', borderWidth: 1, borderColor: '#F0B90B', borderRadius: 14, padding: 15, marginTop: 22 },
  smartHeader: { flexDirection: 'row', alignItems: 'center' },
  smartTitle: { color: '#F0B90B', fontSize: 18, fontWeight: '900' },
  smartSub: { color: '#8E8E93', fontSize: 10, marginTop: 3, paddingRight: 8 },
  smartNotice: { color: '#D4D4D8', fontSize: 12, lineHeight: 17, marginVertical: 12 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modeButton: { flex: 1, backgroundColor: '#242424', borderWidth: 1, borderColor: '#3F3F46', padding: 10, borderRadius: 9, alignItems: 'center' },
  modeSelected: { borderColor: '#F0B90B', backgroundColor: '#302A12' },
  modeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  grid: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  smallLabel: { color: '#A1A1AA', fontSize: 11, marginTop: 8, marginBottom: 4 },
  smallInput: { backgroundColor: '#242424', color: '#FFFFFF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: '#333333' },
  balanceText: { color: '#22C55E', fontSize: 12, fontWeight: '800', marginTop: 10 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 14 },
  stat: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
  scanInfo: { color: '#F0B90B', fontSize: 11, lineHeight: 16, marginTop: 12 },
  candidate: { color: '#22C55E', fontSize: 11, lineHeight: 16, marginTop: 7 },
  status: { color: '#D4D4D8', fontSize: 12, lineHeight: 17, marginVertical: 12 },
  smartButton: { backgroundColor: '#F0B90B', padding: 14, borderRadius: 10, alignItems: 'center' },
  smartButtonText: { color: '#111111', fontWeight: '900' },
  stopButton: { backgroundColor: '#B91C1C', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  confirmBuy: { backgroundColor: '#15803D', padding: 13, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  positionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#222222', borderRadius: 10, padding: 10, marginBottom: 8 },
  positionSymbol: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  positionLine: { color: '#A1A1AA', fontSize: 10, marginTop: 3 },
  sellReady: { backgroundColor: '#B91C1C', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8, marginLeft: 8 },
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
