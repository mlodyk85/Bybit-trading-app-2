import { isCoreSymbol } from './tradingPolicy';

export type MarketRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'HIGH_VOLATILITY';
export type EntryStrategy = 'MOMENTUM_BREAKOUT' | 'RANGE_GRID' | 'NONE';

export interface AdaptiveMarketRow {
  symbol: string;
  change24hPct: number;
  windowMomentumPct: number;
  shortMomentumPct: number;
  spreadPct: number;
  turnover24h: number;
  volatilityPct: number;
  distanceFromHighPct?: number;
}

export interface RankedOpportunity extends AdaptiveMarketRow {
  regime: MarketRegime;
  strategy: EntryStrategy;
  score: number;
  reason: string;
}

export function classifyMarketRegime(row: AdaptiveMarketRow): MarketRegime {
  if (row.volatilityPct >= 2.2 || Math.abs(row.shortMomentumPct) >= 1.1) return 'HIGH_VOLATILITY';
  if (row.change24hPct <= -1 && row.windowMomentumPct < -0.08 && row.shortMomentumPct <= 0) return 'TREND_DOWN';
  if (row.change24hPct >= 0.35 && row.windowMomentumPct > 0.04 && row.shortMomentumPct > 0.015) return 'TREND_UP';
  return 'RANGE';
}

export function rankAdaptiveOpportunities(rows: AdaptiveMarketRow[], maxPositions = 2): RankedOpportunity[] {
  return rows
    .filter((row) => !isCoreSymbol(row.symbol))
    .filter((row) => row.turnover24h >= 750_000 && row.spreadPct >= 0 && row.spreadPct <= 0.25)
    .map((row): RankedOpportunity => {
      const regime = classifyMarketRegime(row);
      if (regime === 'TREND_DOWN' || regime === 'HIGH_VOLATILITY') {
        return { ...row, regime, strategy: 'NONE', score: -1000, reason: regime === 'TREND_DOWN' ? 'trend spadkowy: Spot BUY zablokowany' : 'zmienność poza limitem' };
      }
      if (regime === 'TREND_UP') {
        const score = row.windowMomentumPct * 160 + row.shortMomentumPct * 280
          + Math.log10(Math.max(1, row.turnover24h)) * 4 - row.spreadPct * 120;
        return { ...row, regime, strategy: 'MOMENTUM_BREAKOUT', score, reason: 'płynny trend + potwierdzone momentum/breakout' };
      }
      const justifiedRange = Math.abs(row.change24hPct) <= 1.2
        && row.volatilityPct >= 0.18 && row.volatilityPct <= 1.35
        && row.shortMomentumPct > 0 && row.windowMomentumPct <= 0.12;
      return {
        ...row,
        regime,
        strategy: justifiedRange ? 'RANGE_GRID' : 'NONE',
        score: justifiedRange ? row.volatilityPct * 35 + row.shortMomentumPct * 180 - row.spreadPct * 140 : -500,
        reason: justifiedRange ? 'range z odbiciem i kosztem poniżej amplitudy' : 'range bez przewagi po kosztach',
      };
    })
    .filter((row) => row.strategy !== 'NONE')
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(2, maxPositions)));
}

export interface DynamicExitPolicy {
  takeProfitPct: number;
  trailArmPct: number;
  trailDropPct: number;
}

export function dynamicExitPolicy(regime: MarketRegime, volatilityPct: number, roundTripCostPct: number): DynamicExitPolicy {
  const costFloor = Math.max(0.18, roundTripCostPct + 0.10);
  const vol = Math.max(0.05, volatilityPct);
  return regime === 'TREND_UP'
    ? { takeProfitPct: Math.max(costFloor, Math.min(2.4, vol * 1.8)), trailArmPct: Math.max(costFloor, vol * 1.15), trailDropPct: Math.max(0.10, Math.min(0.9, vol * 0.55)) }
    : { takeProfitPct: Math.max(costFloor, Math.min(1.2, vol * 0.85)), trailArmPct: Math.max(costFloor, vol * 0.65), trailDropPct: Math.max(0.08, Math.min(0.55, vol * 0.35)) };
}
