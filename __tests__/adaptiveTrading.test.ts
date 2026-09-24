import { classifyMarketRegime, rankAdaptiveOpportunities } from '../src/services/adaptiveTradingEngine';
import { capitalAvailableForHappyHour, CapitalManager } from '../src/services/capitalManager';
import { calculateNetExecutionProfit, passesNetProfitGate, planSpotCycleSizing } from '../src/services/executionMath';
import { assertAutonomousSellAllowed, transitionEngine } from '../src/services/tradingPolicy';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
import { aiAdviceCanAuthorizeLiveTrade, validateAiAdvice } from '../src/services/aiAdvisor';

const row = (patch: Partial<Parameters<typeof classifyMarketRegime>[0]> = {}) => ({
  symbol: 'ARBUSDT', change24hPct: 1.2, windowMomentumPct: 0.18, shortMomentumPct: 0.07,
  spreadPct: 0.04, turnover24h: 5_000_000, volatilityPct: 0.6, ...patch,
});

describe('Adaptive Trading Engine', () => {
  it('blocks new speculative Spot BUY candidates in a downtrend', () => {
    const down = row({ change24hPct: -3, windowMomentumPct: -0.4, shortMomentumPct: -0.1 });
    expect(classifyMarketRegime(down)).toBe('TREND_DOWN');
    expect(rankAdaptiveOpportunities([down])).toEqual([]);
  });

  it('ranks only the best two liquid non-CORE opportunities', () => {
    const ranked = rankAdaptiveOpportunities([
      row({ symbol: 'BTCUSDT' }), row({ symbol: 'ARBUSDT' }), row({ symbol: 'OPUSDT', shortMomentumPct: 0.09 }), row({ symbol: 'SUIUSDT', shortMomentumPct: 0.08 }),
    ], 2);
    expect(ranked).toHaveLength(2);
    expect(ranked.some((item) => item.symbol === 'BTCUSDT')).toBe(false);
  });
});

describe('CORE lock and engine independence', () => {
  it.each(['XRPUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'VELOUSDT'])(
    'blocks autonomous SELL of %s', (symbol) => expect(() => assertAutonomousSellAllowed('happy-hour', symbol)).toThrow(`CORE_LOCK:${symbol}`),
  );

  it('starting or stopping Happy Hour never changes SMART lifecycle', () => {
    const initial = { happyHourRunning: false, smartRunning: true };
    expect(transitionEngine(initial, 'happy-hour', true)).toEqual({ happyHourRunning: true, smartRunning: true });
    expect(transitionEngine(initial, 'happy-hour', false)).toEqual(initial);
  });
});

describe('Dust-safe sizing and NETTO gate', () => {
  const rules = { qtyStep: 0.01, minOrderQty: 0.1, minNotional: 5 };

  it('accounts for a BUY fee charged in base and returns an exchange-sellable lot', () => {
    const plan = planSpotCycleSizing(100, 10, 10, rules, 0.001);
    expect(plan?.managedBaseQty).toBe(0.99);
    expect((plan?.managedBaseQty || 0) * 10).toBeGreaterThanOrEqual(5);
  });

  it('rejects sizing below minNotional', () => expect(planSpotCycleSizing(4, 4, 10, rules)).toBeNull());

  it('uses actual fees, spread and slippage for the net-profit gate', () => {
    const net = calculateNetExecutionProfit({ entryQuote: 100, exitQuote: 101, entryFeeUsdt: 0.1, exitFeeUsdt: 0.1, exitPrice: 10, spreadCostUsdt: 0.2, slippageCostUsdt: 0.15 });
    expect(net).toBeCloseTo(0.45, 8);
    expect(passesNetProfitGate(net, 100)).toBe(true);
    expect(passesNetProfitGate(0.05, 100)).toBe(false);
  });
});

describe('Capital reserve', () => {
  it('deducts the reserve, open orders and SMART reservations', () => {
    expect(capitalAvailableForHappyHour({ walletFreeUsdt: 100, openBuyOrdersUsdt: 10, managedPositionsCostUsdt: 0, smartReservedUsdt: 5 })).toBe(50);
  });

  it('prevents double spend and caps active positions at two', () => {
    const manager = new CapitalManager({ reservePct: 35, reserveFloorUsdt: 10, maxActivePositions: 2 });
    const snapshot = { walletFreeUsdt: 100, openBuyOrdersUsdt: 0, managedPositionsCostUsdt: 0, smartReservedUsdt: 0 };
    expect(manager.tryReserve('one', 40, snapshot, 0)).toBe(true);
    expect(manager.tryReserve('two', 30, snapshot, 1)).toBe(false);
    expect(manager.tryReserve('three', 1, snapshot, 2)).toBe(false);
  });
});

describe('AI Advisor shadow boundary', () => {
  const advice = {
    decision: 'BUY' as const, confidence: 0.8, expectedMovePct: 0.9, riskMultiplier: 0.7,
    tpMultiplier: 1.2, trailingMultiplier: 0.8, validForSeconds: 30,
    reasons: ['momentum'], warnings: [],
  };

  it('accepts only a bounded structured response', () => {
    expect(validateAiAdvice(advice)).toEqual(advice);
    expect(validateAiAdvice({ ...advice, riskMultiplier: 1.5 })).toBeNull();
    expect(validateAiAdvice({ ...advice, decision: 'SELL' })).toBeNull();
  });

  it('cannot authorize a LIVE order in build 180', () => {
    const snapshot = {
      symbol: 'ARBUSDT', regime: 'TREND_UP' as const, strategy: 'MOMENTUM_BREAKOUT' as const,
      price: 1, spreadPct: 0.05, change24hPct: 2, windowMomentumPct: 0.2,
      shortMomentumPct: 0.1, turnover24h: 5_000_000, volatilityPct: 0.5,
      estimatedRoundTripCostPct: 0.25, openPositions: 0, freeUsdtAfterReserve: 20,
    };
    expect(aiAdviceCanAuthorizeLiveTrade(snapshot, advice)).toBe(false);
    expect(aiAdviceCanAuthorizeLiveTrade({ ...snapshot, symbol: 'BTCUSDT' }, advice)).toBe(false);
  });
});
