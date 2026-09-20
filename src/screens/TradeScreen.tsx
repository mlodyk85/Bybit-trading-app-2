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
  initialHoldings?: AssetSmartAutoSeed[];
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

interface AccumulationCycle {
  symbol: string;
  soldQty: number;
  soldQuoteUsdt: number;
  sellPrice: number;
  targetBuyPrice: number;
  startedAt: number;
}

const FALLBACK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'LINKUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'SUIUSDT'];
const CORE_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toNumber = (value: string) => Number(value.replace(',', '.'));
const priceText = (value: number) => value >= 1000 ? value.toFixed(2) : value >= 1 ? value.toFixed(5) : value.toFixed(8);
const SCAN_SAMPLES = 7;
const SCAN_INTERVAL_MS = 1400;
const BUY_DIP_MIN_PCT = -0.30;
const BUY_DIP_MAX_PCT = -2.50;
const BUY_REVERSAL_PCT = 0.05;
const MAX_SPREAD_PCT = 0.20;
// Safety-first thresholds. The bot never intentionally triggers a SELL at break-even.
const AUTO_SELL_PROFIT_PCT = 0.35;
const AUTO_SELL_MIN_NET_USDT = 0.01;
const AUTO_SELL_MIN_NET_PCT = 0.08;
const SPOT_MAKER_FEE_PCT = 0.075;
const SPOT_TAKER_FEE_PCT = 0.075;
const MARKET_ROUND_TRIP_FEE_PCT = SPOT_TAKER_FEE_PCT * 2;
const SLIPPAGE_SAFETY_PCT = 0.04;
const EXIT_COST_BUFFER_PCT = SPOT_TAKER_FEE_PCT + SLIPPAGE_SAFETY_PCT;
const SMART_MIN_TRADE_USDT = 10;
const ACCUMULATION_DEFAULT_SHARE = 0.10;
const ACCUMULATION_MIN_PROFIT_PCT = 0.45;
const ACCUMULATION_PEAK_PULLBACK_PCT = 0.08;
const ACCUMULATION_REBUY_DROP_PCT = 0.45;
const ACCUMULATION_MIN_COIN_GAIN_PCT = 0.03;
const REBUY_COST_BUFFER_PCT = SPOT_TAKER_FEE_PCT + SLIPPAGE_SAFETY_PCT;

export const TradeScreen: React.FC<Props> = ({
  credentials,
  initialSymbol = 'BTCUSDT',
  initialHolding = null,
  initialHoldings = [],
  maxOrderUsdt,
  onHoldingConsumed,
}) => {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [amount, setAmount] = useState(String(Math.min(10, maxOrderUsdt)));
  const [busy, setBusy] = useState(false);
  const [lastAck, setLastAck] = useState<TradeAck | null>(null);
  const [error, setError] = useState('');
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [pairs, setPairs] = useState<string[]>(FALLBACK_SYMBOLS);
  const [pairsLoading, setPairsLoading] = useState(true);
  const [market, setMarket] = useState<SpotMarketSnapshot | null>(null);

  const [smartEnabled, setSmartEnabled] = useState(Boolean(initialHolding) || initialHoldings.length > 0);
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
  const [shadowPositions, setShadowPositions] = useState<TrackedPosition[]>([]);
  const [livePositions, setLivePositions] = useState<TrackedPosition[]>([]);
  const [accumulationCycles, setAccumulationCycles] = useState<AccumulationCycle[]>([]);
  const [accumulatedCoin, setAccumulatedCoin] = useState(0);
  const [accumulationShare, setAccumulationShare] = useState('10');
  const [managedHoldings, setManagedHoldings] = useState<AssetSmartAutoSeed[]>(initialHoldings);

  const stopRef = useRef(false);
  const scanCountRef = useRef(0);
  const shadowPositionsRef = useRef<TrackedPosition[]>([]);
  const livePositionsRef = useRef<TrackedPosition[]>([]);
  const shadowUsdtRef = useRef(25);
  const sessionProfitRef = useRef(0);
  const cycleCountRef = useRef(0);
  const sellBusyRef = useRef(false);
  const accumulationRef = useRef<Map<string, AccumulationCycle>>(new Map());
  const accumulatedCoinRef = useRef(0);

  useEffect(() => {
    // Manual Trade selection is UI state only. A running bot must never lock the pair selector.
    if (initialSymbol) {
      setSymbol(initialSymbol.toUpperCase());
      onHoldingConsumed?.();
    }
    if (initialHolding) setSmartEnabled(true);
    setManagedHoldings(initialHoldings);

    // When another portfolio coin is enabled while the scanner is already running,
    // attach it as its own independent tracked position instead of ignoring it until restart.
    if (smartRunning && smartMode === 'assist') {
      let changed = false;
      let next = [...livePositionsRef.current];
      for (const holding of initialHoldings) {
        if (next.some((item) => item.symbol === holding.symbol && item.fromPortfolio)) continue;
        next.push({
          id: `portfolio-${holding.symbol}-${Date.now()}`,
          symbol: holding.symbol,
          qty: holding.baseQty,
          costUsdt: holding.buyCostUsdt,
          entryPrice: holding.buyPrice,
          peakMovePct: 0,
          currentMovePct: 0,
          currentPnlUsdt: 0,
          sellReady: false,
          fromPortfolio: true,
        });
        changed = true;
      }
      if (changed) {
        livePositionsRef.current = next;
        setLivePositions([...next]);
      }
    }
  }, [initialHolding, initialHoldings, initialSymbol, onHoldingConsumed, smartMode, smartRunning]);

  useEffect(() => {
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0 || value > maxOrderUsdt) setAmount(String(Math.min(10, maxOrderUsdt)));
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
      const walletBalance = Number(coin?.walletBalance || 0);
      const locked = Number(coin?.locked || 0);
      const explicitFree = Number(coin?.free || 0);
      const withdrawable = Number(coin?.availableToWithdraw || 0);
      const walletMinusLocked = Number.isFinite(walletBalance) ? Math.max(0, walletBalance - Math.max(0, locked)) : 0;
      // Under Unified accounts "free" can lag or represent a narrower bucket than the Assets screen.
      // Prefer walletBalance - locked, while keeping the explicit API fields as fallbacks.
      const free = Math.max(walletMinusLocked, explicitFree, withdrawable);
      const value = Number.isFinite(free) && free > 0 ? free : 0;
      setAvailableUsdt(value);
      return value;
    } catch {
      return availableUsdt;
    }
  };

  const selectPair = (next: string) => {
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
                setLastAck({ ...ack, requestLatencyMs: Date.now() - startedAt, symbol, side: 'Sell', quoteAmountUsdt: fill.quoteValue });
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

      if (!bestObserved || windowMomentumPct < bestObserved.momentum) bestObserved = { symbol: now.symbol, momentum: windowMomentumPct, spread: now.spreadPct };

      const isCore = CORE_SYMBOLS.has(now.symbol);
      // BUY only after a real dip: the wider window must still be negative,
      // while the short window confirms that price has started reversing upward.
      if (windowMomentumPct > BUY_DIP_MIN_PCT || windowMomentumPct < BUY_DIP_MAX_PCT) continue;
      if (shortMomentumPct < BUY_REVERSAL_PCT || now.spreadPct > MAX_SPREAD_PCT) continue;

      const liquidityScore = Math.max(0, Math.log10(Math.max(now.turnover24h, 1)) - 5);
      const coreQualityBonus = isCore ? 18 : 0;
      const dipDepth = Math.abs(windowMomentumPct);
      const score = dipDepth * 180 + shortMomentumPct * 520 + liquidityScore * 2.2 + coreQualityBonus - now.spreadPct * 70;
      ranked.push({ market: now, windowMomentumPct, shortMomentumPct, score });
    }

    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0] || null;
    setActiveScore(best);
    if (best) {
      const quality = CORE_SYMBOLS.has(best.market.symbol) ? 'CORE' : 'ALT';
      setScanInfo(`DOŁEK ${best.market.symbol} • ${quality} • spadek ${best.windowMomentumPct.toFixed(4)}% • odbicie +${best.shortMomentumPct.toFixed(4)}% • spread ${best.market.spreadPct.toFixed(3)}%`);
    } else if (bestObserved) {
      setScanInfo(`BRAK DOŁKA • ${bestObserved.symbol} ${bestObserved.momentum >= 0 ? '+' : ''}${bestObserved.momentum.toFixed(4)}% • BUY wymaga spadku ≤ ${BUY_DIP_MIN_PCT.toFixed(2)}% i potwierdzonego odbicia`);
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
    const grossExitValue = executablePrice * position.qty;
    const conservativeExitCost = grossExitValue * (EXIT_COST_BUFFER_PCT / 100);
    const currentPnlUsdt = grossExitValue - conservativeExitCost - position.costUsdt;
    const minNetProfit = Math.max(AUTO_SELL_MIN_NET_USDT, position.costUsdt * (AUTO_SELL_MIN_NET_PCT / 100));
    const sellReady = movePct >= AUTO_SELL_PROFIT_PCT && currentPnlUsdt >= minNetProfit;
    return { ...position, peakMovePct, currentMovePct: movePct, currentPnlUsdt, sellReady };
  };

  const buyCandidate = async (candidate: SmartCandidateScore, trade: number, slots: number) => {
    if (!candidate || stopRef.current || smartMode !== 'assist') return;
    if (livePositionsRef.current.length >= slots) return;

    setBusy(true);
    setError('');
    try {
      const walletFree = await refreshAvailableUsdt();
            const reservedUsdt = Array.from(accumulationRef.current.values()).reduce((sum, item) => sum + item.soldQuoteUsdt, 0);
            const free = Math.max(0, walletFree - reservedUsdt);
      if (free + 1e-8 < trade) {
        setSmartStatus(`Za mało wolnych USDT (${free.toFixed(2)}). Skaner działa dalej.`);
        return;
      }
      const ack = await placeSpotMarketOrder(credentials, candidate.market.symbol, 'Buy', trade, maxOrderUsdt);
      setLastAck(ack);
      const fill = await waitForSpotFill(credentials, ack.orderId);
      const baseCoin = candidate.market.symbol.replace(/USDT$/, '');
      const qty = Math.max(0, fill.baseQty - (fill.feeByCurrency[baseCoin] || 0));
      const buyFeeUsdt = fill.feeByCurrency.USDT || 0;
      const buyFeeBaseUsdt = (fill.feeByCurrency[baseCoin] || 0) * (fill.avgPrice || 0);
      const position: TrackedPosition = {
        id: ack.orderId,
        symbol: candidate.market.symbol,
        qty,
        costUsdt: fill.quoteValue + buyFeeUsdt + buyFeeBaseUsdt,
        entryPrice: fill.avgPrice,
        peakMovePct: 0,
        currentMovePct: 0,
        currentPnlUsdt: 0,
        sellReady: false,
      };
      livePositionsRef.current = [...livePositionsRef.current, position];
      setLivePositions([...livePositionsRef.current]);
      setSmartStatus(`HAPPY HOUR BUY ${position.symbol}: ${trade.toFixed(2)} USDT. Wyjście tylko po dodatnim NET po rzeczywistym fee.`);
      await refreshAvailableUsdt();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Błąd BUY.';
      setError(message);
      setSmartStatus(`AUTO BUY nieudany: ${message}. Skaner działa dalej.`);
    } finally {
      setBusy(false);
    }
  };

  const executeAssistSell = async (position: TrackedPosition) => {
    if (sellBusyRef.current || position.fromPortfolio) return;
    const minNetProfit = Math.max(AUTO_SELL_MIN_NET_USDT, position.costUsdt * (AUTO_SELL_MIN_NET_PCT / 100));
    if (!position.sellReady || position.currentPnlUsdt < minNetProfit) return;

    sellBusyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const ack = await placeSpotMarketSellBase(credentials, position.symbol, position.qty);
      const fill = await waitForSpotFill(credentials, ack.orderId);
      const baseCoin = position.symbol.replace(/USDT$/, '');
      const sellFeeUsdt = fill.feeByCurrency.USDT || 0;
      const sellFeeBaseUsdt = (fill.feeByCurrency[baseCoin] || 0) * (fill.avgPrice || 0);
      const netProceeds = Math.max(0, fill.quoteValue - sellFeeUsdt - sellFeeBaseUsdt);
      const pnl = netProceeds - position.costUsdt;
      livePositionsRef.current = livePositionsRef.current.filter((item) => item.id !== position.id);
      setLivePositions([...livePositionsRef.current]);
      if (pnl > 0) {
        cycleCountRef.current += 1;
        sessionProfitRef.current += pnl;
        setCycleCount(cycleCountRef.current);
        setSessionProfit(sessionProfitRef.current);
        setSmartStatus(`AUTO SELL ${position.symbol} • NETTO +${pnl.toFixed(4)} USDT po fee. Skaner działa dalej.`);
      } else {
        // Market fills can move between quote and execution. Do not count a non-positive fill as a successful cycle.
        sessionProfitRef.current += pnl;
        setSessionProfit(sessionProfitRef.current);
        setSmartStatus(`SAFETY: ${position.symbol} fill zakończył się ${pnl.toFixed(4)} USDT po fee. Cykl NIE został zaliczony.`);
      }
      await refreshAvailableUsdt();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Błąd SELL.';
      setError(message);
      setSmartStatus(`AUTO SELL nieudany: ${message}. Skaner nadal monitoruje pozycję.`);
    } finally {
      sellBusyRef.current = false;
      setBusy(false);
    }
  };

  const tryStartAccumulation = async (): Promise<boolean> => {
    if (sellBusyRef.current) return false;
    const candidates = livePositionsRef.current
      .filter((position) => position.fromPortfolio && position.qty > 0 && position.entryPrice > 0 && position.currentPnlUsdt > 0 && !accumulationRef.current.has(position.symbol))
      .sort((a, b) => (b.currentMovePct - b.peakMovePct) - (a.currentMovePct - a.peakMovePct));

    for (const position of candidates) {
      const pullbackPct = position.peakMovePct - position.currentMovePct;
      if (position.currentMovePct < ACCUMULATION_MIN_PROFIT_PCT || pullbackPct < ACCUMULATION_PEAK_PULLBACK_PCT) continue;

      const snapshot = await fetchSpotMarketSnapshot(position.symbol);
      const sellPrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
      if (sellPrice <= 0) continue;

      const configuredShare = Math.min(1, Math.max(0.01, toNumber(accumulationShare) / 100 || ACCUMULATION_DEFAULT_SHARE));
      const maxByShare = position.qty * configuredShare;
      const qty = maxByShare;
      const estimatedQuote = qty * sellPrice;
      if (qty <= 0 || estimatedQuote < SMART_MIN_TRADE_USDT) continue;

      sellBusyRef.current = true;
      setBusy(true);
      setSmartStatus(`SMART ACCUMULATION: ${position.symbol} potwierdził lokalną górkę. Sprzedaję część roboczą...`);
      try {
        const ack = await placeSpotMarketSellBase(credentials, position.symbol, qty);
        const fill = await waitForSpotFill(credentials, ack.orderId);
        const soldQty = fill.baseQty > 0 ? fill.baseQty : qty;
        const baseCoin = position.symbol.replace(/USDT$/, '');
        const sellFeeUsdt = fill.feeByCurrency.USDT || 0;
        const sellFeeBaseUsdt = (fill.feeByCurrency[baseCoin] || 0) * (fill.avgPrice || 0);
        const soldQuoteUsdt = Math.max(0, fill.quoteValue - sellFeeUsdt - sellFeeBaseUsdt);
        const actualSellPrice = fill.avgPrice > 0 ? fill.avgPrice : soldQuoteUsdt / soldQty;
        const soldCost = position.qty > 0 ? position.costUsdt * (soldQty / position.qty) : 0;
        const realizedPnl = soldQuoteUsdt - soldCost;

        const remainingQty = Math.max(0, position.qty - soldQty);
        const remainingCost = Math.max(0, position.costUsdt - soldCost);
        const updated = livePositionsRef.current.map((item) => item.id === position.id ? {
          ...item,
          qty: remainingQty,
          costUsdt: remainingCost,
          currentPnlUsdt: 0,
          sellReady: false,
        } : item);
        livePositionsRef.current = updated;
        setLivePositions([...updated]);

        const cycle: AccumulationCycle = {
          symbol: position.symbol,
          soldQty,
          soldQuoteUsdt,
          sellPrice: actualSellPrice,
          targetBuyPrice: Math.min(
            actualSellPrice * (1 - ACCUMULATION_REBUY_DROP_PCT / 100),
            (soldQuoteUsdt / soldQty) * (1 - REBUY_COST_BUFFER_PCT / 100)
          ),
          startedAt: Date.now(),
        };
        accumulationRef.current.set(cycle.symbol, cycle);
        setAccumulationCycles(Array.from(accumulationRef.current.values()));
        sessionProfitRef.current += realizedPnl;
        setSessionProfit(sessionProfitRef.current);
        setSmartStatus(`SMART ACCUMULATION SELL ${position.symbol}: ${soldQty.toPrecision(7)} sprzedane po ${priceText(actualSellPrice)}. Czekam na odkup ≤ ${priceText(cycle.targetBuyPrice)}.`);
        await refreshAvailableUsdt();
        return true;
      } finally {
        sellBusyRef.current = false;
        setBusy(false);
      }
    }
    return false;
  };

  const tryFinishAccumulation = async (symbol?: string): Promise<boolean> => {
    if (sellBusyRef.current) return false;
    const cycle = symbol ? accumulationRef.current.get(symbol) : Array.from(accumulationRef.current.values())[0];
    if (!cycle) return false;

    const first = await fetchSpotMarketSnapshot(cycle.symbol);
    const firstAsk = first.ask > 0 ? first.ask : first.lastPrice;
    const minBoughtQty = cycle.soldQty * (1 + ACCUMULATION_MIN_COIN_GAIN_PCT / 100);
    const conservativeBoughtQty = firstAsk > 0
      ? (cycle.soldQuoteUsdt / firstAsk) * (1 - REBUY_COST_BUFFER_PCT / 100)
      : 0;
    if (firstAsk <= 0 || firstAsk > cycle.targetBuyPrice || conservativeBoughtQty <= minBoughtQty) {
      setSmartStatus(`SMART ACCUMULATION ${cycle.symbol}: po SELL czekam na dołek. Teraz ${priceText(firstAsk)}, cel ≤ ${priceText(cycle.targetBuyPrice)}.`);
      return false;
    }

    await sleep(1200);
    const second = await fetchSpotMarketSnapshot(cycle.symbol);
    const secondAsk = second.ask > 0 ? second.ask : second.lastPrice;
    if (secondAsk <= 0 || secondAsk < firstAsk) {
      setSmartStatus(`SMART ACCUMULATION ${cycle.symbol}: cena jest nisko, ale nadal spada. Czekam na potwierdzenie odbicia.`);
      return false;
    }

    sellBusyRef.current = true;
    setBusy(true);
    try {
      const spend = cycle.soldQuoteUsdt;
      const ack = await placeSpotMarketOrder(credentials, cycle.symbol, 'Buy', spend, Math.max(maxOrderUsdt, spend));
      const fill = await waitForSpotFill(credentials, ack.orderId);
      const baseCoin = cycle.symbol.replace(/USDT$/, '');
      const boughtQty = Math.max(0, fill.baseQty - (fill.feeByCurrency[baseCoin] || 0));
      const extraCoin = boughtQty - cycle.soldQty;

      const existing = livePositionsRef.current.find((item) => item.symbol === cycle.symbol && item.fromPortfolio);
      if (existing) {
        const nextQty = existing.qty + boughtQty;
        const buyFeeUsdt = fill.feeByCurrency.USDT || 0;
        const buyFeeBaseUsdt = (fill.feeByCurrency[baseCoin] || 0) * (fill.avgPrice || 0);
        const nextCost = existing.costUsdt + fill.quoteValue + buyFeeUsdt + buyFeeBaseUsdt;
        const nextEntry = nextQty > 0 ? nextCost / nextQty : existing.entryPrice;
        livePositionsRef.current = livePositionsRef.current.map((item) => item.id === existing.id ? {
          ...item,
          qty: nextQty,
          costUsdt: nextCost,
          entryPrice: nextEntry,
          peakMovePct: 0,
          currentMovePct: 0,
          currentPnlUsdt: 0,
          sellReady: false,
        } : item);
      } else {
        livePositionsRef.current = [...livePositionsRef.current, {
          id: `acc-${cycle.symbol}-${Date.now()}`,
          symbol: cycle.symbol,
          qty: boughtQty,
          costUsdt: fill.quoteValue + (fill.feeByCurrency.USDT || 0) + ((fill.feeByCurrency[baseCoin] || 0) * (fill.avgPrice || 0)),
          entryPrice: fill.avgPrice,
          peakMovePct: 0,
          currentMovePct: 0,
          currentPnlUsdt: 0,
          sellReady: false,
          fromPortfolio: true,
        }];
      }
      setLivePositions([...livePositionsRef.current]);

      accumulatedCoinRef.current += extraCoin;
      setAccumulatedCoin(accumulatedCoinRef.current);
      if (extraCoin > 0) {
        cycleCountRef.current += 1;
        setCycleCount(cycleCountRef.current);
      }
      accumulationRef.current.delete(cycle.symbol);
      setAccumulationCycles(Array.from(accumulationRef.current.values()));
      setSmartStatus(extraCoin > 0
        ? `SMART ACCUMULATION BUY BACK ${cycle.symbol}: odkupiono ${boughtQty.toPrecision(7)}. Coin +${extraCoin.toPrecision(5)} po fee.`
        : `SAFETY: BUY BACK ${cycle.symbol} nie zwiększył ilości coina (${extraCoin.toPrecision(5)}). Cykl NIE został zaliczony.`);
      await refreshAvailableUsdt();
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Błąd BUY BACK.';
      setError(message);
      setSmartStatus(`SMART ACCUMULATION: BUY BACK nieudany (${message}). USDT pozostaje wolne, bot spróbuje ponownie.`);
      return false;
    } finally {
      sellBusyRef.current = false;
      setBusy(false);
    }
  };

  const startSmart = () => {
    const trade = toNumber(amount);
    const target = toNumber(targetProfit);
    const loss = toNumber(maxLoss);
    const cycles = Math.floor(toNumber(maxCycles));
    const slots = Math.max(1, Math.min(3, Math.floor(toNumber(maxSlots)) || 1));
    const virtualCapital = toNumber(shadowCapital);

    if (!Number.isFinite(trade) || trade <= 0 || trade > maxOrderUsdt) return setError(`Kwota musi być > 0 i <= ${maxOrderUsdt} USDT.`);
    if (trade < SMART_MIN_TRADE_USDT) return setError(`SMART AUTO i DEMO wymagają minimum ${SMART_MIN_TRADE_USDT} USDT na jedną pozycję.`);
    if (!Number.isFinite(target) || target < 0) return setError('Cel zysku: 0 lub więcej. 0 = bez limitu.');
    if (!Number.isFinite(loss) || loss <= 0) return setError('Max strata musi być > 0.');
    if (!Number.isFinite(cycles) || cycles < 1 || cycles > 1000) return setError('Minimalna liczba cykli: 1–1000.');
    if (smartMode === 'shadow' && (!Number.isFinite(virtualCapital) || virtualCapital < Math.max(10, trade))) return setError('Kapitał DEMO: minimum 10 USDT i co najmniej wartość jednej transakcji.');

    stopRef.current = false;
    scanCountRef.current = 0;
    cycleCountRef.current = 0;
    sessionProfitRef.current = 0;
    shadowPositionsRef.current = [];
    accumulationRef.current.clear();
    accumulatedCoinRef.current = 0;
    setAccumulationCycles([]);
    setAccumulatedCoin(0);
    setSmartRunning(true);
    setError('');
    setCycleCount(0);
    setScanCount(0);
    setSessionProfit(0);
    setActiveScore(null);
    setScanInfo(`Start skanera • AUTO BUY po dołku • AUTO SELL dopiero przy bezpiecznym zysku netto • SMART ACCUMULATION tylko gdy BUY BACK zwiększa ilość coina`);

    if (smartMode === 'shadow') {
      shadowUsdtRef.current = virtualCapital;
      setShadowUsdt(virtualCapital);
      setShadowPositions([]);
    } else {
      void refreshAvailableUsdt();
      const portfolioSeeds = managedHoldings.length > 0 ? managedHoldings : (initialHolding ? [initialHolding] : []);
      for (const holding of portfolioSeeds) {
        if (livePositionsRef.current.some((item) => item.symbol === holding.symbol && item.fromPortfolio)) continue;
        const seed: TrackedPosition = {
          id: `portfolio-${holding.symbol}-${Date.now()}`,
          symbol: holding.symbol,
          qty: holding.baseQty,
          costUsdt: holding.buyCostUsdt,
          entryPrice: holding.buyPrice,
          peakMovePct: 0,
          currentMovePct: 0,
          currentPnlUsdt: 0,
          sellReady: false,
          fromPortfolio: true,
        };
        livePositionsRef.current = [...livePositionsRef.current, seed];
      }
      setLivePositions([...livePositionsRef.current]);
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
                  setSmartStatus(`DEMO SELL ${updated.symbol} • +${pnl.toFixed(4)} USDT • szukam dalej.`);
                } else refreshed.push({ ...updated, sellReady: false });
              } else refreshed.push(updated);
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
                setSmartStatus(`DEMO BUY ${position.symbol} ${trade.toFixed(2)} USDT • AUTO SELL przy +${AUTO_SELL_PROFIT_PCT.toFixed(2)}%.`);
              }
            } else {
              setSmartStatus(`DEMO: monitoruję ${refreshed.length}/${slots} pozycji.`);
              await sleep(1600);
            }
          } else {
            const refreshed: TrackedPosition[] = [];
            for (const position of livePositionsRef.current) {
              try { refreshed.push(await updateTrackedPosition(position)); }
              catch { refreshed.push(position); }
            }
            livePositionsRef.current = refreshed;
            setLivePositions([...refreshed]);

            if (accumulationRef.current.size > 0) {
              for (const activeCycle of Array.from(accumulationRef.current.values())) {
                if (stopRef.current) break;
                await tryFinishAccumulation(activeCycle.symbol);
              }
            }

            // Smart Accumulation is independent from free USDT: every managed portfolio coin
            // continuously gets its own HOLD -> SELL -> WAIT -> BUY BACK cycle.
            const accumulationStarted = await tryStartAccumulation();
            if (accumulationStarted) {
              await sleep(350);
              continue;
            }

            const sellCandidate = refreshed.find((position) => !position.fromPortfolio && position.sellReady && position.currentPnlUsdt > 0);
            if (sellCandidate) {
              await executeAssistSell(sellCandidate);
              await sleep(500);
              continue;
            }

            const free = await refreshAvailableUsdt();
            if (refreshed.filter((item) => !item.fromPortfolio).length < slots && free + 1e-8 >= trade) {
              const candidate = await scanBestCandidate();
              if (candidate && livePositionsRef.current.every((item) => item.symbol !== candidate.market.symbol)) await buyCandidate(candidate, trade, slots);
            } else if (free + 1e-8 < trade) {
              const managed = refreshed.filter((item) => item.fromPortfolio).length;
              setSmartStatus(managed > 0
                ? `SMART ACCUMULATION: monitoruję niezależnie ${managed} coinów. Wolne USDT ${free.toFixed(2)} nie blokuje ich cykli.`
                : `SMART AUTO: USDT ${free.toFixed(2)} < ${trade.toFixed(2)}. Brak zarządzanych coinów do akumulacji.`);
              await sleep(1000);
            } else {
              setSmartStatus(`SMART AUTO: ${refreshed.length}/${slots} slotów zajętych. Monitoruję pozycje.`);
              await sleep(1000);
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
        <TouchableOpacity style={styles.pairSelector} onPress={() => setPairPickerOpen(true)}>
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
              <Text style={styles.smartTitle}>HAPPY HOUR</Text>
              <Text style={styles.smartSub}>Bot sam wybiera szybkie pary USDT • BUY • HOLD • SELL</Text>
            </View>
            <Switch value={smartEnabled} onValueChange={(value) => { if (!smartRunning) setSmartEnabled(value); }} disabled={smartRunning} />
          </View>

          {smartEnabled && <>
            <Text style={styles.smartNotice}>Dwa niezależne silniki: SMART ACCUMULATION obraca coinami, które już posiadasz, a HAPPY HOUR wykorzystuje wolne USDT i sam wybiera szybkie pary do handlu. Cykl jednego coina nie blokuje pozostałych.</Text>

            <View style={styles.modeRow}>
              <TouchableOpacity disabled={smartRunning} onPress={() => setSmartMode('assist')} style={[styles.modeButton, smartMode === 'assist' && styles.modeSelected]}><Text style={styles.modeText}>HAPPY HOUR</Text></TouchableOpacity>
              <TouchableOpacity disabled={smartRunning} onPress={() => setSmartMode('shadow')} style={[styles.modeButton, smartMode === 'shadow' && styles.modeSelected]}><Text style={styles.modeText}>DEMO</Text></TouchableOpacity>
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
              <><Text style={styles.smallLabel}>Kapitał DEMO (min. 10 USDT)</Text><TextInput value={shadowCapital} onChangeText={setShadowCapital} editable={!smartRunning} keyboardType="decimal-pad" style={styles.smallInput} /></>
            ) : <Text style={styles.balanceText}>Wolne USDT: {availableUsdt.toFixed(2)}</Text>}

            <View style={styles.stats}>
              <Text style={styles.stat}>Cykle: {cycleCount}</Text>
              <Text style={styles.stat}>Skany: {scanCount}</Text>
              <Text style={[styles.stat, { color: sessionProfit >= 0 ? '#22C55E' : '#EF4444' }]}>PnL {sessionProfit >= 0 ? '+' : ''}{sessionProfit.toFixed(4)}</Text>
              {smartMode === 'shadow' && <Text style={styles.stat}>USDT {shadowUsdt.toFixed(2)}</Text>}
            </View>

            {smartMode === 'assist' && <View style={styles.accCard}>
              <Text style={styles.accTitle}>SMART ACCUMULATION — POSIADANE COINY</Text>
              <Text style={styles.smallLabel}>Udział każdego zarządzanego coina (%) — 100 = cała dostępna ilość</Text>
              <TextInput value={accumulationShare} onChangeText={setAccumulationShare} keyboardType="decimal-pad" style={styles.smallInput} />
              <Text style={styles.accLine}>{accumulationCycles.length > 0 ? accumulationCycles.map((cycle) => `${cycle.symbol}: po SELL, cel odkupu ${priceText(cycle.targetBuyPrice)}`).join('\n') : `Gotowy — ${managedHoldings.length || (initialHolding ? 1 : 0)} coinów zarządzanych niezależnie; wolne USDT nie blokuje akumulacji.`}</Text>
              <Text style={styles.accLine}>Zmiana ilości coina z zakończonych cykli: {accumulatedCoin >= 0 ? '+' : ''}{accumulatedCoin.toPrecision(5)}</Text>
            </View>}

            <Text style={styles.feeInfo}>Spot MNT: Maker {SPOT_MAKER_FEE_PCT.toFixed(3)}% • Taker {SPOT_TAKER_FEE_PCT.toFixed(3)}% • Market BUY+SELL ≈ {MARKET_ROUND_TRIP_FEE_PCT.toFixed(3)}% + spread/slippage. Po fill bot używa rzeczywistego execFee z Bybit.</Text>
            {!!scanInfo && <Text style={styles.scanInfo}>{scanInfo}</Text>}
            {activeScore && <Text style={styles.candidate}>Kandydat BUY: {activeScore.market.symbol} • spadek {activeScore.windowMomentumPct.toFixed(4)}% • odbicie +{activeScore.shortMomentumPct.toFixed(4)}%</Text>}
            <Text style={styles.status}>{smartStatus}</Text>

            {positionsToRender.map((position) => {
              const state = position.currentPnlUsdt <= 0 ? 'CZEKA NA PLUS' : position.sellReady ? 'AUTO SELL READY' : 'NETTO NA PLUSIE';
              return <View key={position.id} style={styles.positionCard}><View style={{ flex: 1 }}>
                <Text style={styles.positionSymbol}>{position.symbol} • {position.fromPortfolio ? 'ACCUMULATION' : state}</Text>
                <Text style={styles.positionLine}>wejście {priceText(position.entryPrice)} • ruch {position.currentMovePct >= 0 ? '+' : ''}{position.currentMovePct.toFixed(4)}%</Text>
                <Text style={styles.positionLine}>max +{Math.max(0, position.peakMovePct).toFixed(4)}% • est. NET PnL {position.currentPnlUsdt >= 0 ? '+' : ''}{position.currentPnlUsdt.toFixed(4)} USDT</Text>
              </View></View>;
            })}

            {smartRunning
              ? <TouchableOpacity style={styles.stopButton} onPress={stopSmart}><Text style={styles.buttonText}>STOP SKANERA</Text></TouchableOpacity>
              : <TouchableOpacity style={styles.smartButton} onPress={startSmart}><Text style={styles.smartButtonText}>{smartMode === 'assist' ? 'START HAPPY HOUR + ACCUMULATION' : 'START DEMO'}</Text></TouchableOpacity>}
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
  accCard: { backgroundColor: '#20251A', borderWidth: 1, borderColor: '#65A30D', borderRadius: 10, padding: 10, marginTop: 12 },
  accTitle: { color: '#A3E635', fontSize: 11, fontWeight: '900' },
  accLine: { color: '#D4D4D8', fontSize: 10, lineHeight: 15, marginTop: 4 },
  feeInfo: { color: '#A3E635', fontSize: 10, lineHeight: 15, marginTop: 10 },
  scanInfo: { color: '#F0B90B', fontSize: 11, lineHeight: 16, marginTop: 12 },
  candidate: { color: '#22C55E', fontSize: 11, lineHeight: 16, marginTop: 7 },
  status: { color: '#D4D4D8', fontSize: 12, lineHeight: 17, marginVertical: 12 },
  smartButton: { backgroundColor: '#F0B90B', padding: 14, borderRadius: 10, alignItems: 'center' },
  smartButtonText: { color: '#111111', fontWeight: '900' },
  stopButton: { backgroundColor: '#B91C1C', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  positionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#222222', borderRadius: 10, padding: 10, marginBottom: 8 },
  positionSymbol: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  positionLine: { color: '#A1A1AA', fontSize: 10, marginTop: 3 },
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