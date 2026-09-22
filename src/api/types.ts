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
  free: string;
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
  side: 'Buy' | 'Sell' | 'None' | string;
  size: string;
  avgPrice: string;
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

export interface CreateSpotOrderResult {
  orderId: string;
  orderLinkId: string;
}

export interface TradeAck extends CreateSpotOrderResult {
  requestLatencyMs: number;
  symbol: string;
  side: 'Buy' | 'Sell';
  quoteAmountUsdt: number;
}

export interface SpotExecution {
  symbol: string;
  orderId: string;
  orderLinkId: string;
  side: 'Buy' | 'Sell' | string;
  orderType: string;
  execFee: string;
  feeCurrency?: string;
  feeRate?: string;
  execId: string;
  execPrice: string;
  execQty: string;
  execValue: string;
  execTime: string;
  isMaker?: boolean;
}

export interface ExecutionListResult {
  category: string;
  list: SpotExecution[];
  nextPageCursor?: string;
}

export interface SpotOpenOrder {
  symbol: string;
  orderId: string;
  orderLinkId?: string;
  side: 'Buy' | 'Sell' | string;
  orderType: string;
  price: string;
  qty: string;
  cumExecQty?: string;
  cumExecValue?: string;
  orderStatus: string;
  createdTime?: string;
  updatedTime?: string;
}

export interface SpotOpenOrderListResult {
  category: string;
  list: SpotOpenOrder[];
  nextPageCursor?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ApiError {
  code: number | string;
  message: string;
}
