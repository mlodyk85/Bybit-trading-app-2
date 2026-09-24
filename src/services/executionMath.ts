export interface SpotTradingRules {
  qtyStep: number;
  minOrderQty: number;
  minNotional: number;
}

export interface SpotCycleSizing {
  quoteUsdt: number;
  grossBaseQty: number;
  managedBaseQty: number;
  estimatedBaseFeeQty: number;
}

export interface NetExecutionInput {
  entryQuote: number;
  exitQuote: number;
  entryFeeUsdt?: number;
  exitFeeUsdt?: number;
  entryBaseFeeQty?: number;
  exitBaseFeeQty?: number;
  exitPrice: number;
  spreadCostUsdt?: number;
  slippageCostUsdt?: number;
}

const finite = (value: number | undefined): number => Number.isFinite(value) ? Number(value) : 0;

export function floorToStep(value: number, step: number): number {
  if (!(value > 0) || !(step > 0)) return 0;
  const precision = Math.min(12, Math.max(0, Math.ceil(-Math.log10(step)) + 2));
  const factor = 10 ** precision;
  return Math.floor((Math.floor((value + Number.EPSILON) / step) * step + Number.EPSILON) * factor) / factor;
}

/** Plans a BUY whose post-fee quantity is sellable as one bot-owned lot. */
export function planSpotCycleSizing(
  availableQuoteUsdt: number,
  desiredQuoteUsdt: number,
  askPrice: number,
  rules: SpotTradingRules,
  buyFeeRate = 0.001,
): SpotCycleSizing | null {
  if (!(availableQuoteUsdt > 0) || !(desiredQuoteUsdt > 0) || !(askPrice > 0) || !(rules.qtyStep > 0)) return null;
  const quoteUsdt = Math.min(availableQuoteUsdt, desiredQuoteUsdt);
  const grossBaseQty = quoteUsdt / askPrice;
  const estimatedBaseFeeQty = grossBaseQty * Math.max(0, buyFeeRate);
  const managedBaseQty = floorToStep(grossBaseQty - estimatedBaseFeeQty, rules.qtyStep);
  if (managedBaseQty < rules.minOrderQty || managedBaseQty * askPrice < rules.minNotional) return null;
  // Require enough margin for one qty step after a base-asset fee or adverse rounding.
  if ((grossBaseQty - estimatedBaseFeeQty) - managedBaseQty < -1e-12) return null;
  return { quoteUsdt, grossBaseQty, managedBaseQty, estimatedBaseFeeQty };
}

export function calculateNetExecutionProfit(input: NetExecutionInput): number {
  const baseFeesValue = (finite(input.entryBaseFeeQty) + finite(input.exitBaseFeeQty)) * Math.max(0, input.exitPrice);
  return finite(input.exitQuote)
    - finite(input.entryQuote)
    - finite(input.entryFeeUsdt)
    - finite(input.exitFeeUsdt)
    - baseFeesValue
    - finite(input.spreadCostUsdt)
    - finite(input.slippageCostUsdt);
}

export function passesNetProfitGate(netProfitUsdt: number, costUsdt: number, minUsdt = 0.01, minPct = 0.08): boolean {
  return netProfitUsdt >= Math.max(minUsdt, Math.max(0, costUsdt) * minPct / 100);
}
