export interface DemoPosition {
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  quantity: number;
  notionalUsdt: number;
  openedAt: number;
}

export interface DemoTrade {
  id: string;
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  exitPrice: number;
  notionalUsdt: number;
  grossPnlUsdt: number;
  feesUsdt: number;
  slippageUsdt: number;
  netPnlUsdt: number;
  openedAt: number;
  closedAt: number;
  reason: 'TP' | 'SL' | 'SIGNAL' | 'STOP';
}

export interface StrategyDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  fastSma: number;
  slowSma: number;
  momentumPct: number;
}

export const DEMO_FEE_RATE = 0.001; // conservative 0.10% each side
export const DEMO_SLIPPAGE_RATE = 0.0003; // simulated 0.03% each side
export const DEMO_TAKE_PROFIT_PCT = 0.006; // +0.60%
export const DEMO_STOP_LOSS_PCT = 0.0035; // -0.35%

export function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateStrategy(prices: number[]): StrategyDecision {
  if (prices.length < 12) {
    return { action: 'HOLD', score: 0, fastSma: 0, slowSma: 0, momentumPct: 0 };
  }

  const fast = prices.slice(-4);
  const slow = prices.slice(-12);
  const fastSma = average(fast);
  const slowSma = average(slow);
  const current = prices[prices.length - 1];
  const previous = prices[prices.length - 4];
  const momentumPct = previous > 0 ? (current - previous) / previous : 0;
  const trendPct = slowSma > 0 ? (fastSma - slowSma) / slowSma : 0;

  let score = 50;
  score += Math.max(-25, Math.min(25, trendPct * 50000));
  score += Math.max(-20, Math.min(20, momentumPct * 20000));
  score = Math.round(Math.max(0, Math.min(100, score)));

  if (fastSma > slowSma * 1.00025 && momentumPct > 0.00015 && current >= fastSma) {
    return { action: 'BUY', score, fastSma, slowSma, momentumPct };
  }

  if (fastSma < slowSma * 0.99985 || momentumPct < -0.00035) {
    return { action: 'SELL', score: 100 - score, fastSma, slowSma, momentumPct };
  }

  return { action: 'HOLD', score, fastSma, slowSma, momentumPct };
}

export function shouldClosePosition(position: DemoPosition, currentPrice: number, decision: StrategyDecision): DemoTrade['reason'] | null {
  const change = (currentPrice - position.entryPrice) / position.entryPrice;
  if (change >= DEMO_TAKE_PROFIT_PCT) return 'TP';
  if (change <= -DEMO_STOP_LOSS_PCT) return 'SL';
  if (decision.action === 'SELL' && decision.score >= 62) return 'SIGNAL';
  return null;
}

export function closeDemoPosition(position: DemoPosition, currentPrice: number, reason: DemoTrade['reason'], closedAt = Date.now()): DemoTrade {
  const effectiveEntry = position.entryPrice * (1 + DEMO_SLIPPAGE_RATE);
  const effectiveExit = currentPrice * (1 - DEMO_SLIPPAGE_RATE);
  const grossPnlUsdt = position.quantity * (effectiveExit - effectiveEntry);
  const feesUsdt = position.notionalUsdt * DEMO_FEE_RATE + position.quantity * effectiveExit * DEMO_FEE_RATE;
  const slippageUsdt = position.notionalUsdt * DEMO_SLIPPAGE_RATE + position.quantity * currentPrice * DEMO_SLIPPAGE_RATE;
  const netPnlUsdt = grossPnlUsdt - feesUsdt;

  return {
    id: `${position.symbol}-${closedAt}-${Math.random().toString(36).slice(2, 8)}`,
    symbol: position.symbol,
    side: 'LONG',
    entryPrice: position.entryPrice,
    exitPrice: currentPrice,
    notionalUsdt: position.notionalUsdt,
    grossPnlUsdt,
    feesUsdt,
    slippageUsdt,
    netPnlUsdt,
    openedAt: position.openedAt,
    closedAt,
    reason,
  };
}

export function openDemoPosition(symbol: string, price: number, notionalUsdt: number, openedAt = Date.now()): DemoPosition {
  return {
    symbol,
    side: 'LONG',
    entryPrice: price,
    quantity: notionalUsdt / price,
    notionalUsdt,
    openedAt,
  };
}
