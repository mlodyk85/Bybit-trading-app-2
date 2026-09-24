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
import { COIN_BUILDER_SYMBOLS, isCoreAccumulationSymbol } from '../services/coinBuilder';
import { loadSellLockedSymbols } from '../services/tradingPreferences';
import { activateTradingEngine, deactivateTradingEngine } from '../services/tradingForegroundService';
import { loadTradingRunState, setTradingRunRequested } from '../services/tradingRunState';
import {
  cancelSpotOrder,
  fetchSpotExecutions,
  fetchSpotMarketSnapshot,
  fetchSpotMinOrderAmt,
  fetchSpotTradingRules,
  fetchSpotOpenOrders,
  fetchSpotOrderExecutions,
  fetchSpotUsdtMarketCandidates,
  fetchSpotUsdtSymbols,
  fetchWalletBalance,
  placeSpotLimitSellBase,
  placeSpotMarketOrder,
  placeSpotMarketSellBase,
  SpotMarketCandidate,
  SpotMarketSnapshot,
  summarizeSpotExecutions,
  waitForSpotFill,
} from '../api/bybit';
import { rankAdaptiveOpportunities, MarketRegime, EntryStrategy, dynamicExitPolicy } from '../services/adaptiveTradingEngine';
import { CapitalManager, DEFAULT_CAPITAL_POLICY } from '../services/capitalManager';
import { planSpotCycleSizing, passesNetProfitGate } from '../services/executionMath';
import { aiAdviceCanAuthorizeLiveTrade, appendAiShadowRecord, loadAiAdvisorConfig, requestAiAdvice } from '../services/aiAdvisor';

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
  regime: MarketRegime;
  strategy: EntryStrategy;
  volatilityPct: number;
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
  exitOrderId?: string;
  targetSellPrice?: number;
  trailArmPct?: number;
  trailDropPct?: number;
  trailingExit?: boolean;
  closed?: boolean;
  realizedPnlUsdt?: number;
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
const STRATEGIC_CORE_SYMBOLS = new Set<string>(COIN_BUILDER_SYMBOLS);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toNumber = (value: string) => Number(value.replace(',', '.'));
const priceText = (value: number) => value >= 1000 ? value.toFixed(2) : value >= 1 ? value.toFixed(5) : value.toFixed(8);
const SCAN_SAMPLES = 9;
const SCAN_INTERVAL_MS = 1250;
// Safety-first thresholds. The bot never intentionally triggers a SELL at break-even.
const AUTO_SELL_PROFIT_PCT = 0.35;
const AUTO_SELL_MIN_NET_USDT = 0.01;
const AUTO_SELL_MIN_NET_PCT = 0.08;
const SPOT_MAKER_FEE_PCT = 0.075;
const SPOT_TAKER_FEE_PCT = 0.075;
const MARKET_ROUND_TRIP_FEE_PCT = SPOT_TAKER_FEE_PCT * 2;
const SLIPPAGE_SAFETY_PCT = 0.04;
const EXIT_COST_BUFFER_PCT = SPOT_TAKER_FEE_PCT + SLIPPAGE_SAFETY_PCT;
const SMART_MIN_TRADE_USDT = 5;
const ACCUMULATION_MIN_COIN_GAIN_PCT = 0.15;
const REBUY_COST_BUFFER_PCT = SPOT_TAKER_FEE_PCT + SLIPPAGE_SAFETY_PCT;
const CORE_PROFIT_ALLOCATION_PCT = 0.50;
const CORE_USDT_RESERVE_PCT = 0.40;
const CORE_DIP_24H_PCT = -2.0;
const CORE_BOUNCE_FROM_LOW_PCT = 0.30;

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
  const [smartRunning, setSmartRunning] = useState(false); // Happy Hour engine
  const [accumulationRunning, setAccumulationRunning] = useState(false); // Smart engine
  const [accumulationStatus, setAccumulationStatus] = useState('Gotowy');
  const [targetProfit, setTargetProfit] = useState('0');
  const [maxLoss, setMaxLoss] = useState('2');
  const [maxCycles, setMaxCycles] = useState('1000');
  const [maxSlots, setMaxSlots] = useState('2');
  const [shadowCapital, setShadowCapital] = useState('25');
  const [shadowUsdt, setShadowUsdt] = useState(25);
  const [availableUsdt, setAvailableUsdt] = useState(0);
  const [sessionProfit, setSessionProfit] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);
  const [scanCount, setScanCount] = useState(0);
  const [smartStatus, setSmartStatus] = useState('Gotowy');
  const [scanInfo, setScanInfo] = useState('');
  const [activeScore, setActiveScore] = useState<SmartCandidateScore | null>(null);
  const [aiAdvisorStatus, setAiAdvisorStatus] = useState('AI SHADOW: wyłączony');
  const [shadowPositions, setShadowPositions] = useState<TrackedPosition[]>([]);
  const [livePositions, setLivePositions] = useState<TrackedPosition[]>([]);
  const [accumulationCycles, setAccumulationCycles] = useState<AccumulationCycle[]>([]);
  const [accumulatedCoin, setAccumulatedCoin] = useState(0);
  const [accumulationShare, setAccumulationShare] = useState('5');
  const [managedHoldings, setManagedHoldings] = useState<AssetSmartAutoSeed[]>(initialHoldings);
  const [sellLockedSymbols, setSellLockedSymbols] = useState<string[]>([]);

  const stopRef = useRef(false); // Happy Hour stop
  const accumulationStopRef = useRef(false); // Smart stop
  const scanCountRef = useRef(0);
  const shadowPositionsRef = useRef<TrackedPosition[]>([]);
  const livePositionsRef = useRef<TrackedPosition[]>([]);
  const shadowUsdtRef = useRef(25);
  const sessionProfitRef = useRef(0);
  const cycleCountRef = useRef(0);
  const sellBusyRef = useRef(false);
  const accumulationRef = useRef<Map<string, AccumulationCycle>>(new Map());
  const accumulatedCoinRef = useRef(0);
  const sellLockedSymbolsRef = useRef<string[]>([]);
  const smartRunningRef = useRef(false);
  const accumulationRunningRef = useRef(false);
  // Only REALIZED positive USDT profit feeds strategic accumulation.
  // Existing CORE balances are never sold to finance this pool.
  const coreAccumulationFundRef = useRef(0);
  const capitalManagerRef = useRef(new CapitalManager(DEFAULT_CAPITAL_POLICY));

  useEffect(() => {
    // Manual Trade selection is UI state only. A running bot must never lock the pair selector.
    if (initialSymbol) {
      setSymbol(initialSymbol.toUpperCase());
      onHoldingConsumed?.();
    }
    if (initialHolding) setSmartEnabled(true);
    setManagedHoldings(initialHoldings);

  }, [initialHolding, initialHoldings, initialSymbol, onHoldingConsumed]);

  useEffect(() => {
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0 || value > maxOrderUsdt) setAmount(String(Math.min(10, maxOrderUsdt)));
  }, [amount, maxOrderUsdt]);

  useEffect(() => { void refreshSellLocks(); }, []);

  useEffect(() => () => {
    // Abort both independent loops before React state is torn down.
    stopRef.current = true;
    accumulationStopRef.current = true;
    smartRunningRef.current = false;
    accumulationRunningRef.current = false;
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchSpotUsdtSymbols()
      .then((list) => { if (mounted && list.length) setPairs(list); })
      .catch(() => undefined)
      .finally(() => { if (mounted) setPairsLoading(false); });
    return () => { mounted = false; };
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

  const refreshSellLocks = async (): Promise<string[]> => {
    const locks = await loadSellLockedSymbols();
    sellLockedSymbolsRef.current = locks;
    setSellLockedSymbols(locks);
    return locks;
  };
  const cancelLockedOpenSellOrders = async (locks: string[]): Promise<number> => {
    if (locks.length === 0) return 0;
    const locked = new Set(locks.map((item) => item.toUpperCase()));
    const openOrders = await fetchSpotOpenOrders(credentials, 50);
    const targets = openOrders.filter((order) => order.side === 'Sell' && locked.has(order.symbol.toUpperCase()));
    let cancelled = 0;
    for (const order of targets) {
      try {
        await cancelSpotOrder(credentials, order.symbol, order.orderId);
        cancelled += 1;
      } catch {
        // Jeżeli zlecenie właśnie się wykonało lub zostało anulowane, kolejny refresh zsynchronizuje stan.
      }
    }
    if (cancelled > 0) {
      livePositionsRef.current = livePositionsRef.current.map((position) => locked.has(position.symbol.toUpperCase())
        ? { ...position, exitOrderId: undefined, targetSellPrice: undefined, sellReady: false }
        : position);
      setLivePositions([...livePositionsRef.current]);
    }
    return cancelled;
  };


  const cancelLegacyPortfolioProfitSells = async (symbols: string[]): Promise<number> => {
    if (symbols.length === 0) return 0;
    const managed = new Set(symbols.map((item) => item.toUpperCase()));
    const openOrders = await fetchSpotOpenOrders(credentials, 50);
    const targets = openOrders.filter((order) =>
      order.side === 'Sell'
      && managed.has(order.symbol.toUpperCase())
      && Boolean(order.orderLinkId?.startsWith('profit-s-'))
    );
    let cancelled = 0;
    for (const order of targets) {
      try {
        await cancelSpotOrder(credentials, order.symbol, order.orderId);
        cancelled += 1;
      } catch {
        // Zlecenie mogło zostać wykonane lub anulowane w międzyczasie.
      }
    }
    return cancelled;
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
    // Only this explicit user action is allowed to disable Happy Hour.
    stopRef.current = true;
    void setTradingRunRequested('happy-hour', false);
    setSmartStatus('STOP RĘCZNY: kończę skanowanie. Otwarte pozycje SMART AUTO pozostają bez zmian.');
  };

  const scanBestCandidate = async (): Promise<SmartCandidateScore | null> => {
    const scanNo = scanCountRef.current + 1;
    setSmartStatus(`Skan ${scanNo}: zbieram ${SCAN_SAMPLES} próbek rynku...`);
    const tracks = new Map<string, SpotMarketCandidate[]>();
    let latest: SpotMarketCandidate[] = [];

    for (let sample = 0; sample < SCAN_SAMPLES; sample += 1) {
      if (stopRef.current) return null;
      latest = await fetchSpotUsdtMarketCandidates(240);
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
    const adaptiveRows: Array<SmartCandidateScore> = [];
    let bestObserved: { symbol: string; momentum: number; spread: number } | null = null;

    for (const now of latest) {
      // Strategic CORE is excluded at scanner level as well as execution level.
      if (STRATEGIC_CORE_SYMBOLS.has(now.symbol)) continue;
      const history = tracks.get(now.symbol) || [];
      if (history.length < 4) continue;
      const first = history[0];
      const shortBase = history[Math.max(0, history.length - 3)];
      if (first.lastPrice <= 0 || shortBase.lastPrice <= 0) continue;
      const windowMomentumPct = ((now.lastPrice - first.lastPrice) / first.lastPrice) * 100;
      const shortMomentumPct = ((now.lastPrice - shortBase.lastPrice) / shortBase.lastPrice) * 100;

      if (!bestObserved || windowMomentumPct < bestObserved.momentum) bestObserved = { symbol: now.symbol, momentum: windowMomentumPct, spread: now.spreadPct };

      const volatilityPct = now.low24h > 0 ? ((now.high24h - now.low24h) / now.low24h) * 100 / Math.sqrt(24) : Math.abs(windowMomentumPct);
      adaptiveRows.push({ market: now, windowMomentumPct, shortMomentumPct, score: 0, regime: 'RANGE', strategy: 'NONE', volatilityPct });
    }
    const ranked = rankAdaptiveOpportunities(adaptiveRows.map((row) => ({
      symbol: row.market.symbol, change24hPct: row.market.change24hPct,
      windowMomentumPct: row.windowMomentumPct, shortMomentumPct: row.shortMomentumPct,
      spreadPct: row.market.spreadPct, turnover24h: row.market.turnover24h, volatilityPct: row.volatilityPct,
    })), 2);
    const winner = ranked[0];
    const source = winner ? adaptiveRows.find((row) => row.market.symbol === winner.symbol) : undefined;
    const best = winner && source ? { ...source, score: winner.score, regime: winner.regime, strategy: winner.strategy } : null;
    setActiveScore(best);
    if (best) {
      setScanInfo(`WEJŚCIE ${best.market.symbol} • ${best.regime}/${best.strategy} • 24h ${best.market.change24hPct >= 0 ? '+' : ''}${best.market.change24hPct.toFixed(2)}% • ruch ${best.windowMomentumPct.toFixed(4)}% • spread ${best.market.spreadPct.toFixed(3)}%`);
      const aiConfig = await loadAiAdvisorConfig();
      if (aiConfig.enabled) {
        const snapshot = {
          symbol: best.market.symbol,
          regime: best.regime,
          strategy: best.strategy,
          price: best.market.ask || best.market.lastPrice,
          spreadPct: best.market.spreadPct,
          change24hPct: best.market.change24hPct,
          windowMomentumPct: best.windowMomentumPct,
          shortMomentumPct: best.shortMomentumPct,
          turnover24h: best.market.turnover24h,
          volatilityPct: best.volatilityPct,
          estimatedRoundTripCostPct: MARKET_ROUND_TRIP_FEE_PCT + best.market.spreadPct + SLIPPAGE_SAFETY_PCT,
          openPositions: livePositionsRef.current.filter((item) => !item.fromPortfolio).length,
          freeUsdtAfterReserve: Math.max(0, availableUsdt),
        };
        const advice = await requestAiAdvice(snapshot, aiConfig);
        if (advice) {
          const autoAuthorized = aiConfig.mode === 'auto' && aiAdviceCanAuthorizeLiveTrade(snapshot, advice, aiConfig.minConfidence);
          setAiAdvisorStatus(`AI ${aiConfig.mode === 'auto' ? 'AUTO' : 'SHADOW'}: ${advice.decision} • pewność ${(advice.confidence * 100).toFixed(0)}% • ryzyko x${advice.riskMultiplier.toFixed(2)} • ${advice.reasons[0] || 'brak opisu'}`);
          await appendAiShadowRecord({ id: `ai-${Date.now()}-${snapshot.symbol}`, createdAt: Date.now(), snapshot, advice, localDecision: 'BUY' });
          if (aiConfig.mode === 'auto' && !autoAuthorized) {
            setScanInfo(`AI VETO ${snapshot.symbol} • ${advice.decision} • pewność ${(advice.confidence * 100).toFixed(0)}% — brak zlecenia`);
            return null;
          }
        } else {
          setAiAdvisorStatus(`AI ${aiConfig.mode === 'auto' ? 'AUTO' : 'SHADOW'}: brak poprawnej odpowiedzi/timeout.`);
          if (aiConfig.mode === 'auto') {
            setScanInfo('AI AUTO: brak odpowiedzi — fail-safe, brak zlecenia.');
            return null;
          }
        }
      } else {
        setAiAdvisorStatus('AI SHADOW: wyłączony w Ustawieniach.');
      }
    } else if (bestObserved) {
      setScanInfo(`BRAK WEJŚCIA • ${bestObserved.symbol} ${bestObserved.momentum >= 0 ? '+' : ''}${bestObserved.momentum.toFixed(4)}% • czekam na odbicie po spadku albo potwierdzony momentum`);
    } else {
      setScanInfo('BRAK WEJŚCIA • za mało danych');
    }
    return best;
  };

  const updateTrackedPosition = async (position: TrackedPosition): Promise<TrackedPosition> => {
    if (position.exitOrderId && !position.fromPortfolio) {
      const rows = await fetchSpotOrderExecutions(credentials, position.exitOrderId);
      const fill = summarizeSpotExecutions(rows);
      if (fill && fill.baseQty + 1e-10 >= position.qty * 0.999) {
        const baseCoin = position.symbol.replace(/USDT$/, '');
        const sellFeeUsdt = fill.feeByCurrency.USDT || 0;
        const sellFeeBaseUsdt = (fill.feeByCurrency[baseCoin] || 0) * (fill.avgPrice || 0);
        const netProceeds = Math.max(0, fill.quoteValue - sellFeeUsdt - sellFeeBaseUsdt);
        const pnl = netProceeds - position.costUsdt;
        return {
          ...position,
          currentMovePct: position.entryPrice > 0 ? ((fill.avgPrice - position.entryPrice) / position.entryPrice) * 100 : 0,
          currentPnlUsdt: pnl,
          sellReady: false,
          closed: true,
          realizedPnlUsdt: pnl,
        };
      }
    }

    const snapshot = await fetchSpotMarketSnapshot(position.symbol);
    const executablePrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
    const movePct = position.entryPrice > 0 ? ((executablePrice - position.entryPrice) / position.entryPrice) * 100 : 0;
    const peakMovePct = Math.max(position.peakMovePct, movePct);
    const grossExitValue = executablePrice * position.qty;
    const conservativeExitCost = grossExitValue * (EXIT_COST_BUFFER_PCT / 100);
    const currentPnlUsdt = grossExitValue - conservativeExitCost - position.costUsdt;
    const minNetProfit = Math.max(AUTO_SELL_MIN_NET_USDT, position.costUsdt * (AUTO_SELL_MIN_NET_PCT / 100));
    const trailingExit = peakMovePct >= (position.trailArmPct || Number.POSITIVE_INFINITY)
      && peakMovePct - movePct >= (position.trailDropPct || Number.POSITIVE_INFINITY)
      && currentPnlUsdt >= minNetProfit;
    const sellReady = ((!position.exitOrderId && movePct >= AUTO_SELL_PROFIT_PCT) || trailingExit) && currentPnlUsdt >= minNetProfit;
    return { ...position, peakMovePct, currentMovePct: movePct, currentPnlUsdt, sellReady, trailingExit };
  };

  const buyCandidate = async (candidate: SmartCandidateScore, trade: number, slots: number) => {
    if (!candidate || stopRef.current || smartMode !== 'assist') return;
    // Hard safety wall: Happy Hour / USDT-growth must never trade strategic CORE.
    // CORE is purchased only by tryBuyStrategicDip() from realized-profit allocation.
    if (STRATEGIC_CORE_SYMBOLS.has(candidate.market.symbol)) {
      setSmartStatus(`CORE LOCK: ${candidate.market.symbol} pominięty przez silnik handlowy — tylko akumulacja.`);
      return;
    }
    if (livePositionsRef.current.filter((item) => !item.fromPortfolio).length >= slots) return;

    setBusy(true);
    setError('');
    let capitalReservationId = '';
    try {
      const free = await refreshAvailableUsdt();
      const openOrders = await fetchSpotOpenOrders(credentials, 50);
      const openBuyOrdersUsdt = openOrders.filter((order) => order.side === 'Buy').reduce((sum, order) => sum + (Number(order.qty) || 0) * (Number(order.price) || 0), 0);
      const reservationId = `happy-buy-${candidate.market.symbol}-${Date.now()}`;
      const active = livePositionsRef.current.filter((item) => !item.fromPortfolio).length;
      const reserved = capitalManagerRef.current.tryReserve(reservationId, trade, {
        walletFreeUsdt: free, openBuyOrdersUsdt, managedPositionsCostUsdt: livePositionsRef.current.reduce((sum, item) => sum + item.costUsdt, 0), smartReservedUsdt: coreAccumulationFundRef.current,
      }, active);
      if (!reserved) {
        setSmartStatus(`CAPITAL RESERVE: brak bezpiecznego budżetu na ${trade.toFixed(2)} USDT.`);
        return;
      }
      capitalReservationId = reservationId;
      const rules = await fetchSpotTradingRules(candidate.market.symbol);
      const sizing = planSpotCycleSizing(free, trade, candidate.market.ask || candidate.market.lastPrice, rules);
      if (!sizing) {
        capitalManagerRef.current.release(reservationId);
        setSmartStatus(`DUST GUARD: ${candidate.market.symbol} pominięty — cykl nie utworzyłby sprzedawalnej partii.`);
        return;
      }
      const ack = await placeSpotMarketOrder(credentials, candidate.market.symbol, 'Buy', sizing.quoteUsdt, maxOrderUsdt);
      setLastAck(ack);
      const fill = await waitForSpotFill(credentials, ack.orderId);
      capitalManagerRef.current.release(reservationId);
      capitalReservationId = '';
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

      let trackedPosition = position;
      let exitStatus = 'awaryjny monitoring ceny';
      try {
        const minNetProfit = Math.max(AUTO_SELL_MIN_NET_USDT, position.costUsdt * (AUTO_SELL_MIN_NET_PCT / 100));
        // Let stronger short-term moves breathe instead of clipping every trade at the same 0.35%.
        // The floor still covers fees/slippage; the cap prevents an unrealistic distant exit.
        const exitPolicy = dynamicExitPolicy(candidate.regime, candidate.volatilityPct, MARKET_ROUND_TRIP_FEE_PCT + SLIPPAGE_SAFETY_PCT);
        const dynamicProfitPct = exitPolicy.takeProfitPct;
        const grossTarget = position.entryPrice * (1 + dynamicProfitPct / 100);
        const makerNetTarget = position.qty > 0
          ? (position.costUsdt + minNetProfit) / (position.qty * (1 - SPOT_MAKER_FEE_PCT / 100))
          : grossTarget;
        const desiredSellPrice = Math.max(grossTarget, makerNetTarget);
        const exit = await placeSpotLimitSellBase(credentials, position.symbol, position.qty, desiredSellPrice, 'happy-hour');
        const protectedCost = position.qty > 0 ? position.costUsdt * (exit.normalizedQty / position.qty) : position.costUsdt;
        trackedPosition = {
          ...position,
          qty: exit.normalizedQty,
          costUsdt: protectedCost,
          exitOrderId: exit.orderId,
          targetSellPrice: exit.normalizedPrice,
          trailArmPct: exitPolicy.trailArmPct,
          trailDropPct: exitPolicy.trailDropPct,
          sellReady: false,
        };
        exitStatus = `GTC SELL @ ${priceText(exit.normalizedPrice)} pozostawiony na Bybit`;
      } catch (exitError: unknown) {
        exitStatus = `nie udało się wystawić LIMIT SELL (${exitError instanceof Error ? exitError.message : 'błąd'}); bot monitoruje i użyje bezpiecznego wyjścia`;
      }

      livePositionsRef.current = [...livePositionsRef.current, trackedPosition];
      setLivePositions([...livePositionsRef.current]);
      setSmartStatus(`HAPPY HOUR BUY ${trackedPosition.symbol}: ${trade.toFixed(2)} USDT • ${exitStatus}.`);
      await refreshAvailableUsdt();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Błąd BUY.';
      setError(message);
      setSmartStatus(`AUTO BUY nieudany: ${message}. Skaner działa dalej.`);
    } finally {
      if (capitalReservationId) capitalManagerRef.current.release(capitalReservationId);
      setBusy(false);
    }
  };

  const executeAssistSell = async (position: TrackedPosition) => {
    if (sellBusyRef.current || position.fromPortfolio) return;
    if (!position.sellReady || !passesNetProfitGate(position.currentPnlUsdt, position.costUsdt, AUTO_SELL_MIN_NET_USDT, AUTO_SELL_MIN_NET_PCT)) return;

    sellBusyRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (position.trailingExit && position.exitOrderId) {
        // Cancel acknowledgement is required before a market fallback, preventing a duplicate SELL.
        await cancelSpotOrder(credentials, position.symbol, position.exitOrderId);
        position = { ...position, exitOrderId: undefined, targetSellPrice: undefined };
        livePositionsRef.current = livePositionsRef.current.map((item) => item.id === position.id ? position : item);
      }
      const ack = await placeSpotMarketSellBase(credentials, position.symbol, position.qty, 'happy-hour');
      const fill = await waitForSpotFill(credentials, ack.orderId);
      const baseCoin = position.symbol.replace(/USDT$/, '');
      const sellFeeUsdt = fill.feeByCurrency.USDT || 0;
      const sellFeeBaseUsdt = (fill.feeByCurrency[baseCoin] || 0) * (fill.avgPrice || 0);
      const netProceeds = Math.max(0, fill.quoteValue - sellFeeUsdt - sellFeeBaseUsdt);
      const pnl = netProceeds - position.costUsdt;
      livePositionsRef.current = livePositionsRef.current.filter((item) => item.id !== position.id);
      setLivePositions([...livePositionsRef.current]);
      if (pnl > 0) {
        creditCoreFund(pnl);
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

  const creditCoreFund = (realizedPnlUsdt: number) => {
    if (!Number.isFinite(realizedPnlUsdt) || realizedPnlUsdt <= 0) return;
    coreAccumulationFundRef.current += realizedPnlUsdt * CORE_PROFIT_ALLOCATION_PCT;
  };

  const tryBuyStrategicDip = async (): Promise<boolean> => {
    if (sellBusyRef.current || coreAccumulationFundRef.current <= 0) return false;
    const free = await refreshAvailableUsdt();
    const reserve = free * CORE_USDT_RESERVE_PCT;
    const spendable = Math.max(0, free - reserve);
    if (spendable <= 0) return false;

    const snapshots: SpotMarketSnapshot[] = [];
    for (const coreSymbol of COIN_BUILDER_SYMBOLS) {
      try { snapshots.push(await fetchSpotMarketSnapshot(coreSymbol)); } catch { /* retry next loop */ }
    }

    // Dip + bounce confirmation: negative 24h move, price close to the 24h low,
    // but already above the low. This avoids buying solely because price is falling.
    const candidate = snapshots
      .filter((item) => {
        if (item.lastPrice <= 0 || item.low24h <= 0 || item.high24h <= item.low24h) return false;
        const bouncePct = ((item.lastPrice - item.low24h) / item.low24h) * 100;
        const rangeLocation = (item.lastPrice - item.low24h) / (item.high24h - item.low24h);
        return item.change24hPct <= CORE_DIP_24H_PCT
          && bouncePct >= CORE_BOUNCE_FROM_LOW_PCT
          && rangeLocation <= 0.35;
      })
      .sort((a, b) => a.change24hPct - b.change24hPct)[0];
    if (!candidate) return false;

    const exchangeMin = await fetchSpotMinOrderAmt(candidate.symbol);
    const minOrder = Math.max(exchangeMin * 1.02, 5);
    const budget = Math.min(coreAccumulationFundRef.current, spendable, maxOrderUsdt);
    if (budget + 1e-8 < minOrder) return false;

    const ack = await placeSpotMarketOrder(credentials, candidate.symbol, 'Buy', budget, maxOrderUsdt);
    const fill = await waitForSpotFill(credentials, ack.orderId);
    const baseCoin = candidate.symbol.replace(/USDT$/, '');
    const netQty = Math.max(0, fill.baseQty - (fill.feeByCurrency[baseCoin] || 0));
    const feeUsdt = (fill.feeByCurrency.USDT || 0) + (fill.feeByCurrency[baseCoin] || 0) * fill.avgPrice;
    const actualCost = fill.quoteValue + feeUsdt;
    coreAccumulationFundRef.current = Math.max(0, coreAccumulationFundRef.current - actualCost);

    const existing = livePositionsRef.current.find((item) => item.fromPortfolio && item.symbol === candidate.symbol);
    if (existing) {
      const nextQty = existing.qty + netQty;
      const nextCost = existing.costUsdt + actualCost;
      livePositionsRef.current = livePositionsRef.current.map((item) => item.id === existing.id ? {
        ...item,
        qty: nextQty,
        costUsdt: nextCost,
        entryPrice: nextQty > 0 ? nextCost / nextQty : item.entryPrice,
      } : item);
      setLivePositions([...livePositionsRef.current]);
    }
    setAccumulationStatus(`CORE BUY ${candidate.symbol}: +${netQty.toPrecision(7)} za ${actualCost.toFixed(2)} USDT z wypracowanego zysku. Rezerwa USDT pozostaje nienaruszona.`);
    await refreshAvailableUsdt();
    return true;
  };

  const tryStartAccumulation = async (): Promise<boolean> => {
    // Strategic CORE is accumulation-only in build 160. Existing holdings are never
    // sold to manufacture USDT; realized USDT profit is used for confirmed dip buys.
    return false;
    /*
    if (sellBusyRef.current) return false;
    const candidates = livePositionsRef.current
      .filter((position) => position.fromPortfolio && !isCoreAccumulationSymbol(position.symbol))
      .sort((a, b) => (b.currentMovePct - b.peakMovePct) - (a.currentMovePct - a.peakMovePct));

    for (const position of candidates) {
      const pullbackPct = position.peakMovePct - position.currentMovePct;
      const minNetProfit = Math.max(AUTO_SELL_MIN_NET_USDT, position.costUsdt * (AUTO_SELL_MIN_NET_PCT / 100));
      const trailingHarvest = position.currentMovePct >= ACCUMULATION_MIN_PROFIT_PCT
        && pullbackPct >= ACCUMULATION_PEAK_PULLBACK_PCT
        && position.currentPnlUsdt >= minNetProfit;
      if (!trailingHarvest) continue;

      const snapshot = await fetchSpotMarketSnapshot(position.symbol);
      const sellPrice = snapshot.bid > 0 ? snapshot.bid : snapshot.lastPrice;
      if (sellPrice <= 0) continue;

      const configuredShare = Math.min(0.10, Math.max(0.01, toNumber(accumulationShare) / 100 || ACCUMULATION_DEFAULT_SHARE));
      const totalQuote = position.qty * sellPrice;
      const exchangeMinQuote = await fetchSpotMinOrderAmt(position.symbol);
      if (exchangeMinQuote > 0 && totalQuote + 1e-8 < exchangeMinQuote) continue;

      // Do not let a small configured share block a profitable portfolio coin.
      // Increase only the working slice enough to satisfy the real Bybit minimum,
      // while never selling more than the tracked balance.
      const minExecutableQty = exchangeMinQuote > 0 ? (exchangeMinQuote * 1.01) / sellPrice : 0;
      const hardMaxWorkingQty = position.qty * 0.10;
      if (minExecutableQty > hardMaxWorkingQty + 1e-12) {
        setSmartStatus(`SMART COIN BUILDER: ${position.symbol} pomijam SELL — minimum Bybit wymagałoby ruszenia >10% pozycji.`);
        continue;
      }
      const qty = Math.min(hardMaxWorkingQty, Math.max(position.qty * configuredShare, minExecutableQty));
      const estimatedQuote = qty * sellPrice;
      if (qty <= 0 || estimatedQuote <= 0) continue;

      sellBusyRef.current = true;
      setBusy(true);
      setSmartStatus(`SMART ACCUMULATION: ${position.symbol} potwierdził lokalną górkę. Sprzedaję część roboczą...`);
      try {
        const ack = await placeSpotMarketSellBase(credentials, position.symbol, qty, 'smart');
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
    */
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

  const discoverPortfolioSeeds = async (): Promise<AssetSmartAutoSeed[]> => {
    const [wallet, history] = await Promise.all([
      fetchWalletBalance(credentials),
      fetchSpotExecutions(credentials, 100),
    ]);
    if (!wallet) return [];

    const seeds: AssetSmartAutoSeed[] = [];
    for (const asset of wallet.coin || []) {
      const coin = asset.coin.toUpperCase();
      if (coin === 'USDT') continue;
      const freeQty = Number(asset.free || asset.availableToWithdraw || asset.walletBalance || 0);
      const usdValue = Number(asset.usdValue || 0);
      if (!Number.isFinite(freeQty) || freeQty <= 0 || !Number.isFinite(usdValue) || usdValue < 1) continue;

      const symbol = `${coin}USDT`;
      const buys = history
        .filter((row) => row.symbol.toUpperCase() === symbol && row.side === 'Buy')
        .sort((a, b) => Number(b.execTime) - Number(a.execTime));
      const lastBuy = buys[0];
      if (!lastBuy) continue;

      const buyPrice = Number(lastBuy.execPrice);
      const buyQty = Number(lastBuy.execQty);
      const buyValue = Number(lastBuy.execValue);
      if (![buyPrice, buyQty, buyValue].every((value) => Number.isFinite(value) && value > 0)) continue;

      const baseFee = lastBuy.feeCurrency?.toUpperCase() === coin ? Number(lastBuy.execFee) || 0 : 0;
      const quoteFee = lastBuy.feeCurrency?.toUpperCase() === 'USDT' ? Number(lastBuy.execFee) || 0 : 0;
      // Manage the CURRENT wallet quantity, not only the quantity from the last BUY.
      // This is critical after an app upgrade/restart: positions opened by an older build
      // (for example AVAX/ARB/DOGE) must immediately re-enter SMART monitoring.
      const managedQty = freeQty;
      if (managedQty <= 0) continue;

      // Reconstruct a conservative cost basis from execution history.
      // Prefer the latest BUY price as the anchor, but apply it to the current free balance
      // so a position is never silently ignored just because the latest fill was smaller.
      const fullBuyNetQty = Math.max(1e-12, buyQty - baseFee);
      const fullBuyCost = buyValue + quoteFee + baseFee * buyPrice;
      const unitCost = fullBuyCost / fullBuyNetQty;
      const proportionalCost = unitCost * managedQty;
      seeds.push({ symbol, baseQty: managedQty, buyPrice: unitCost, buyCostUsdt: proportionalCost });
    }
    return seeds;
  };


  const startAccumulationEngine = (restored = false) => {
    if (accumulationRunningRef.current) return;
    accumulationRunningRef.current = true;
    accumulationStopRef.current = false;
    void setTradingRunRequested('smart', true);
    if (restored) setAccumulationStatus('SMART: przywracam pracę po wznowieniu aplikacji...');
    void activateTradingEngine('smart').catch((e: unknown) => {
      // Foreground keep-alive is an enhancement; its failure must never cancel the trading engine.
      setAccumulationStatus(`SMART uruchomiony • usługa tła niedostępna: ${e instanceof Error ? e.message : 'nieznany błąd'}.`);
    });
    setAccumulationRunning(true);
    setAccumulationStatus('SMART: wykrywam coiny dostępne w portfelu i ich ostatnią cenę zakupu...');

    void (async () => {
      try {
        const initialLocks = await refreshSellLocks();
        const cancelledAtStart = await cancelLockedOpenSellOrders(initialLocks);
        if (cancelledAtStart > 0) setAccumulationStatus(`SMART: anulowano ${cancelledAtStart} otwarte zlecenia SELL dla zablokowanych coinów.`);
        const discovered = await discoverPortfolioSeeds();
        const requested = managedHoldings.length > 0 ? managedHoldings : (initialHolding ? [initialHolding] : []);
        const bySymbol = new Map<string, AssetSmartAutoSeed>();
        for (const holding of [...discovered, ...requested]) bySymbol.set(holding.symbol, holding);
        const portfolioSeeds = Array.from(bySymbol.values());

        if (portfolioSeeds.length === 0) {
          setAccumulationStatus('SMART: brak coinów z rozpoznaną ceną zakupu. Nie sprzedaję aktywów bez kosztu bazowego.');
          setAccumulationRunning(false);
          return;
        }

        setManagedHoldings(portfolioSeeds);
        for (const holding of portfolioSeeds) {
          if (livePositionsRef.current.some((item) => item.symbol === holding.symbol && item.fromPortfolio)) continue;
          livePositionsRef.current = [...livePositionsRef.current, {
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
          }];
        }
        // Portfolio SMART is quantity-first: never place an immediate SELL just because the
        // current price is above the historical entry. Old app-generated profit-s-* orders
        // are removed so a legacy build cannot keep draining a long-term holding.
        const strategicSymbols = portfolioSeeds.map((item) => item.symbol).filter(isCoreAccumulationSymbol);
        const legacyCancelled = await cancelLegacyPortfolioProfitSells(strategicSymbols);
        livePositionsRef.current = livePositionsRef.current.map((position) => position.fromPortfolio
          ? { ...position, exitOrderId: undefined, targetSellPrice: undefined, sellReady: false }
          : position);
        setLivePositions([...livePositionsRef.current]);
        setAccumulationStatus(
          `SMART COIN BUILDER: monitoruję ${portfolioSeeds.length} coinów. CORE pozostaje w coinie; pracuje maks. 10% pozycji.${legacyCancelled > 0 ? ` Anulowano ${legacyCancelled} stare SELL.` : ''}`
        );

        while (!accumulationStopRef.current) {
          try {
            const previousLocksKey = sellLockedSymbolsRef.current.join('|');
            const currentLocks = await refreshSellLocks();
            if (currentLocks.join('|') !== previousLocksKey) {
              const cancelled = await cancelLockedOpenSellOrders(currentLocks);
              if (cancelled > 0) setAccumulationStatus(`SMART: blokada SELL aktywna — anulowano ${cancelled} zlecenia.`);
            }
            const happyOwned = livePositionsRef.current.filter((position) => !position.fromPortfolio);
            const smartOwned: TrackedPosition[] = [];
            for (const position of livePositionsRef.current.filter((item) => item.fromPortfolio)) {
              try { smartOwned.push(await updateTrackedPosition(position)); }
              catch { smartOwned.push(position); }
            }
            livePositionsRef.current = [...happyOwned, ...smartOwned];
            setLivePositions([...livePositionsRef.current]);

            // First harvest profitable wallet positions, then handle any pending rebuy cycle.
            // This prevents an old position from sitting in profit after an upgrade while SMART
            // only watches positions created in the current process.
            // Strategic CORE is accumulation-only. Never harvest/sell BTC/ETH/SOL/XRP/
            // PEPE/FLOKI/VELO to create USDT. Profitable USDT cycles fund dip purchases instead.
            if (!accumulationStopRef.current) {
              await tryStartAccumulation(); // accumulation-only policy returns no CORE sell candidates
              await tryBuyStrategicDip();
            }
            for (const activeCycle of Array.from(accumulationRef.current.values())) {
              if (accumulationStopRef.current) break;
              await tryFinishAccumulation(activeCycle.symbol);
            }

            const freeUsdtNow = await refreshAvailableUsdt();
            setAccumulationStatus(`SMART TOTAL CAPITAL: CORE/HOLD ${smartOwned.length} • fundusz dokupienia ${coreAccumulationFundRef.current.toFixed(4)} USDT • wolne USDT ${freeUsdtNow.toFixed(2)}. CORE: tylko gromadzenie, bez automatycznej sprzedaży.`);
            await sleep(900);
          } catch (e: unknown) {
            setAccumulationStatus(`SMART: błąd chwilowy — ${e instanceof Error ? e.message : 'nieznany błąd'}. Ponawiam.`);
            await sleep(3000);
          }
        }
      } catch (e: unknown) {
        setAccumulationStatus(`SMART: nie udało się wczytać portfela — ${e instanceof Error ? e.message : 'nieznany błąd'}.`);
      } finally {
        await deactivateTradingEngine('smart').catch(() => undefined);
        accumulationRunningRef.current = false;
        setAccumulationRunning(false);
        accumulationStopRef.current = false;
        setAccumulationStatus((current) => current.startsWith('SMART: nie udało') ? current : 'SMART zatrzymany. Happy Hour działa niezależnie.');
      }
    })();
  };

  const stopAccumulationEngine = () => {
    // Only this explicit user action is allowed to disable SMART.
    accumulationStopRef.current = true;
    void setTradingRunRequested('smart', false);
    setAccumulationStatus('SMART: zatrzymuję własny silnik ręcznie...');
  };

  const startSmart = (restored = false) => {
    if (smartRunningRef.current) return;
    const trade = toNumber(amount);
    const target = toNumber(targetProfit);
    const loss = toNumber(maxLoss);
    const cycles = Math.floor(toNumber(maxCycles));
    const slots = Math.max(1, Math.min(2, Math.floor(toNumber(maxSlots)) || 1));
    const virtualCapital = toNumber(shadowCapital);

    if (!Number.isFinite(trade) || trade <= 0 || trade > maxOrderUsdt) return setError(`Kwota musi być > 0 i <= ${maxOrderUsdt} USDT.`);
    if (trade < SMART_MIN_TRADE_USDT) return setError(`SMART AUTO i DEMO wymagają minimum ${SMART_MIN_TRADE_USDT} USDT na jedną pozycję.`);
    if (!Number.isFinite(target) || target < 0) return setError('Cel zysku: 0 lub więcej. 0 = bez limitu.');
    if (!Number.isFinite(loss) || loss <= 0) return setError('Max strata musi być > 0.');
    if (!Number.isFinite(cycles) || cycles < 1 || cycles > 1000) return setError('Minimalna liczba cykli: 1–1000.');
    if (smartMode === 'shadow' && (!Number.isFinite(virtualCapital) || virtualCapital < Math.max(10, trade))) return setError('Kapitał DEMO: minimum 10 USDT i co najmniej wartość jednej transakcji.');

    stopRef.current = false;
    void setTradingRunRequested('happy-hour', true);
    if (restored) setSmartStatus('HAPPY HOUR: przywracam ciągłe skanowanie po wznowieniu aplikacji...');
    void activateTradingEngine('happy-hour').catch((e: unknown) => {
      // Never turn trading back off just because Android rejected the keep-alive service.
      setError(`Happy Hour działa na pierwszym planie; usługa tła niedostępna: ${e instanceof Error ? e.message : 'nieznany błąd'}.`);
    });
    scanCountRef.current = 0;
    cycleCountRef.current = 0;
    sessionProfitRef.current = 0;
    shadowPositionsRef.current = [];
    accumulationRef.current.clear();
    accumulatedCoinRef.current = 0;
    setAccumulationCycles([]);
    setAccumulatedCoin(0);
    smartRunningRef.current = true;
    setSmartRunning(true);
    // Happy Hour and SMART are intentionally independent. Never start SMART from Happy Hour.
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
      // Happy Hour owns only positions opened by Happy Hour. Portfolio/Smart positions are a separate engine.
      void refreshAvailableUsdt();
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

            // Continuous mode: session thresholds are telemetry/risk signals, not an automatic shutdown.
            // Keep scanning until the user explicitly stops the engine.
            if (cycleCountRef.current >= cycles && sessionProfitRef.current >= 0 && refreshed.length === 0) {
              setSmartStatus(`DEMO: wykonano ${cycleCountRef.current} cykli; pracuję dalej.`);
            }
            if (target > 0 && sessionProfitRef.current >= target && refreshed.length === 0) {
              setSmartStatus(`DEMO: cel +${target.toFixed(2)} USDT osiągnięty; pracuję dalej.`);
            }
            if (sessionProfitRef.current <= -loss) {
              setSmartStatus(`DEMO: próg straty ${sessionProfitRef.current.toFixed(4)} USDT; skaner pozostaje aktywny.`);
            }

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
            const smartOwned = livePositionsRef.current.filter((position) => position.fromPortfolio);
            const refreshed: TrackedPosition[] = [];
            for (const position of livePositionsRef.current.filter((item) => !item.fromPortfolio)) {
              try {
                const updated = await updateTrackedPosition(position);
                if (updated.closed) {
                  const pnl = updated.realizedPnlUsdt || 0;
                  sessionProfitRef.current += pnl;
                  setSessionProfit(sessionProfitRef.current);
                  if (pnl > 0) {
                    cycleCountRef.current += 1;
                    setCycleCount(cycleCountRef.current);
                    setSmartStatus(`GTC SELL FILLED ${updated.symbol} • NETTO +${pnl.toFixed(4)} USDT • bot szuka następnego ruchu.`);
                  } else {
                    setSmartStatus(`GTC SELL FILLED ${updated.symbol} • wynik ${pnl.toFixed(4)} USDT.`);
                  }
                } else {
                  refreshed.push(updated);
                }
              } catch {
                refreshed.push(position);
              }
            }
            livePositionsRef.current = [...smartOwned, ...refreshed];
            setLivePositions([...livePositionsRef.current]);

            const sellCandidate = refreshed.find((position) => !position.fromPortfolio && position.sellReady && position.currentPnlUsdt > 0);
            if (sellCandidate) {
              await executeAssistSell(sellCandidate);
              await sleep(500);
              continue;
            }

            const free = await refreshAvailableUsdt();
            if (refreshed.filter((item) => !item.fromPortfolio).length < slots && free + 1e-8 >= trade) {
              const candidate = await scanBestCandidate();
              if (candidate && livePositionsRef.current.filter((item) => !item.fromPortfolio).every((item) => item.symbol !== candidate.market.symbol)) await buyCandidate(candidate, trade, slots);
            } else if (free + 1e-8 < trade) {
              setSmartStatus(`HAPPY HOUR: wolne USDT ${free.toFixed(2)} < ${trade.toFixed(2)}. Czekam bez używania kapitału Smart.`);
              await sleep(1000);
            } else {
              setSmartStatus(`HAPPY HOUR: ${refreshed.length}/${slots} slotów zajętych. Monitoruję własne pozycje.`);
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

      await deactivateTradingEngine('happy-hour').catch(() => undefined);
      smartRunningRef.current = false;
      setSmartRunning(false);
      stopRef.current = false;
      setSmartStatus('Happy Hour zatrzymany ręcznie.');
    })();
  };

  useEffect(() => {
    let mounted = true;
    void loadTradingRunState().then((state) => {
      if (!mounted) return;
      // A stored RUN request survives screen/app recreation. We resume automatically;
      // only the explicit STOP buttons clear these flags.
      if (state.smart && !accumulationRunning) startAccumulationEngine(true);
      if (state.happyHour && !smartRunningRef.current) startSmart(true);
    }).catch(() => undefined);
    return () => { mounted = false; };
    // Restore once for this screen instance; engines manage their own continuous loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const positionsToRender = smartMode === 'shadow' ? shadowPositions : livePositions.filter((position) => !position.fromPortfolio);
  const smartPositionsToRender = livePositions.filter((position) => position.fromPortfolio);

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
            <Text style={styles.smartNotice}>HAPPY HOUR działa niezależnie od ręcznie wybranej pary i portfela: skanuje rynek Spot/USDT, wybiera kandydatów i zarządza własnymi pozycjami. Ręczny Trade pozostaje zawsze dostępny.</Text>

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

            <Text style={styles.feeInfo}>Spot MNT: Maker {SPOT_MAKER_FEE_PCT.toFixed(3)}% • Taker {SPOT_TAKER_FEE_PCT.toFixed(3)}% • Market BUY+SELL ≈ {MARKET_ROUND_TRIP_FEE_PCT.toFixed(3)}% + spread/slippage. Po fill bot używa rzeczywistego execFee z Bybit.</Text>
            {!!scanInfo && <Text style={styles.scanInfo}>{scanInfo}</Text>}
            <Text style={styles.aiStatus}>{aiAdvisorStatus}</Text>
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
              ? <TouchableOpacity style={styles.stopButton} onPress={stopSmart}><Text style={styles.buttonText}>STOP HAPPY HOUR</Text></TouchableOpacity>
              : <TouchableOpacity style={styles.smartButton} onPress={() => startSmart(false)}><Text style={styles.smartButtonText}>{smartMode === 'assist' ? 'START HAPPY HOUR' : 'START DEMO'}</Text></TouchableOpacity>}
          </>}
        </View>

        <View style={styles.smartCard}>
          <View style={styles.smartHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.smartTitle}>SMART</Text>
              <Text style={styles.smartSub}>Oddzielny silnik • własne pozycje • nie uruchamia i nie zatrzymuje Happy Hour</Text>
            </View>
          </View>
          <Text style={styles.smartNotice}>SMART TOTAL CAPITAL prowadzi dwa niezależne koszyki: CORE COINS mają zwiększać liczbę sztuk, a wolne USDT mają zwiększać saldo USDT przez osobne krótkie transakcje. Bot nie sprzedaje CORE po to, żeby tworzyć USDT.</Text>
          {sellLockedSymbols.length > 0 && <Text style={styles.sellLockInfo}>🔒 SELL zablokowany: {sellLockedSymbols.map((item) => item.replace(/USDT$/, '')).join(', ')}</Text>}
          <Text style={styles.smallLabel}>Working slice (%) — 1–10%, domyślnie 5%</Text>
          <TextInput value={accumulationShare} onChangeText={setAccumulationShare} keyboardType="decimal-pad" style={styles.smallInput} />
          <Text style={styles.accLine}>{accumulationCycles.length > 0 ? accumulationCycles.map((cycle) => `${cycle.symbol}: po SELL, cel odkupu ${priceText(cycle.targetBuyPrice)}`).join('\n') : `Wybrane do Smart: ${managedHoldings.length || (initialHolding ? 1 : 0)}`}</Text>
          <Text style={styles.accLine}>Zmiana ilości coina: {accumulatedCoin >= 0 ? '+' : ''}{accumulatedCoin.toPrecision(5)}</Text>
          <Text style={styles.status}>{accumulationStatus}</Text>
          {smartPositionsToRender.map((position) => <View key={position.id} style={styles.positionCard}><View style={{ flex: 1 }}>
            <Text style={styles.positionSymbol}>{position.symbol} • COIN BUILDER / CORE HOLD</Text>
            <Text style={styles.positionLine}>wejście {priceText(position.entryPrice)} • ruch {position.currentMovePct >= 0 ? '+' : ''}{position.currentMovePct.toFixed(4)}%</Text>
            <Text style={styles.positionLine}>est. NET PnL {position.currentPnlUsdt >= 0 ? '+' : ''}{position.currentPnlUsdt.toFixed(4)} USDT</Text>
          </View></View>)}
          {accumulationRunning
            ? <TouchableOpacity style={styles.stopButton} onPress={stopAccumulationEngine}><Text style={styles.buttonText}>STOP SMART</Text></TouchableOpacity>
            : <TouchableOpacity style={styles.smartButton} onPress={() => startAccumulationEngine(false)}><Text style={styles.smartButtonText}>START CAŁY KAPITAŁ</Text></TouchableOpacity>}
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
  sellLockInfo: { color: '#FF6B6B', fontSize: 11, fontWeight: '800', marginBottom: 8 },
  feeInfo: { color: '#A3E635', fontSize: 10, lineHeight: 15, marginTop: 10 },
  scanInfo: { color: '#F0B90B', fontSize: 11, lineHeight: 16, marginTop: 12 },
  aiStatus: { color: '#00E5FF', fontSize: 11, lineHeight: 16, marginTop: 6 },
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
