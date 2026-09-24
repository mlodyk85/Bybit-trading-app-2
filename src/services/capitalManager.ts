export interface CapitalSnapshot {
  walletFreeUsdt: number;
  openBuyOrdersUsdt: number;
  managedPositionsCostUsdt: number;
  smartReservedUsdt: number;
}

export interface CapitalPolicy {
  reservePct: number;
  reserveFloorUsdt: number;
  maxActivePositions: number;
}

export const DEFAULT_CAPITAL_POLICY: CapitalPolicy = {
  reservePct: 35,
  reserveFloorUsdt: 10,
  maxActivePositions: 2,
};

export function capitalAvailableForHappyHour(snapshot: CapitalSnapshot, policy = DEFAULT_CAPITAL_POLICY): number {
  const free = Math.max(0, snapshot.walletFreeUsdt);
  const reserve = Math.max(policy.reserveFloorUsdt, free * policy.reservePct / 100);
  return Math.max(0, free - reserve - Math.max(0, snapshot.openBuyOrdersUsdt) - Math.max(0, snapshot.smartReservedUsdt));
}

export class CapitalManager {
  private reservations = new Map<string, number>();

  constructor(private readonly policy: CapitalPolicy = DEFAULT_CAPITAL_POLICY) {}

  reservedUsdt(): number {
    return [...this.reservations.values()].reduce((sum, value) => sum + value, 0);
  }

  release(id: string): void { this.reservations.delete(id); }

  tryReserve(id: string, requestedUsdt: number, snapshot: CapitalSnapshot, activePositions: number): boolean {
    if (!id || !(requestedUsdt > 0) || activePositions >= this.policy.maxActivePositions || this.reservations.has(id)) return false;
    const available = capitalAvailableForHappyHour(snapshot, this.policy) - this.reservedUsdt();
    if (requestedUsdt > available + 1e-8) return false;
    this.reservations.set(id, requestedUsdt);
    return true;
  }
}
