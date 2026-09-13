export interface BybitApiResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
  retExtInfo: Record<string, unknown>;
  time: number;
}

export interface CoinBalance {
  coin: string;
  equity: string;
  usdValue: string;
  walletBalance: string;
  free: string; // Available balance for coin
  locked: string;
  borrowAmount: string;
  availableToBorrow: string;
  availableToWithdraw: string;
  accruedInterest: string;
  totalOrderIM: string;
  totalPositionIM: string;
  totalPositionMM: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  bonus: string;
}

export interface WalletAccountResult {
  accountType: string;
  accountLTV: string;
  totalEquity: string;
  totalWalletBalance: string;
  totalMarginBalance: string;
  totalAvailableBalance: string;
  totalPerpUPL: string;
  totalInitialMargin: string;
  totalMaintenanceMargin: string;
  coin: CoinBalance[];
}

export interface WalletBalanceResult {
  list: WalletAccountResult[];
}

export interface Position {
  symbol: string;
  side: 'Buy' | 'Sell' | 'None' | string; // Buy = LONG, Sell = SHORT
  size: string;
  avgPrice: string; // Entry price
  markPrice: string;
  leverage: string;
  unrealisedPnl: string;
  liqPrice: string;
  takeProfit: string;
  stopLoss: string;
  positionValue: string;
  category: 'linear' | 'inverse' | string;
  tradeMode: number;
  createdTime: string;
  updatedTime: string;
}

export interface PositionListResult {
  category: string;
  list: Position[];
  nextPageCursor?: string;
}

export interface ApiCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface SignParams {
  apiKey: string;
  apiSecret: string;
  timestamp: number;
  recvWindow: number;
  queryString: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ApiError {
  code: number | string;
  message: string;
}
