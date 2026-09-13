import { buildQueryString, signBybitRequest } from '../src/api/signing';
import { CoinBalance } from '../src/api/types';
import {
  filterNonZeroAssets,
  formatCryptoPrecision,
  formatCurrency,
  formatPnL,
} from '../src/utils/format';

describe('Bybit API Signing & Query String', () => {
  it('should generate empty query string when no parameters are provided', () => {
    expect(buildQueryString()).toBe('');
    expect(buildQueryString({})).toBe('');
  });

  it('should sort query parameters alphabetically and format correctly', () => {
    const params = {
      settleCoin: 'USDT',
      category: 'linear',
      limit: 50,
    };
    const qs = buildQueryString(params);
    expect(qs).toBe('category=linear&limit=50&settleCoin=USDT');
  });

  it('should ignore undefined and null parameter values', () => {
    const params = {
      accountType: 'UNIFIED',
      coin: undefined,
      cursor: null,
    };
    const qs = buildQueryString(params);
    expect(qs).toBe('accountType=UNIFIED');
  });

  it('should generate a valid HMAC-SHA256 signature', () => {
    const params = {
      apiKey: 'testApiKey123',
      apiSecret: 'testApiSecret456',
      timestamp: 1672531200000,
      recvWindow: 5000,
      queryString: 'accountType=UNIFIED',
    };

    const signature = signBybitRequest(params);
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect(signature.length).toBe(64); // Hex string length for SHA256
  });
});

describe('Format Utilities', () => {
  it('should format currency with 2 decimal places', () => {
    expect(formatCurrency('1234.5678', 'USDT')).toBe('1,234.57 USDT');
    expect(formatCurrency(100, 'USD')).toBe('100.00 USD');
    expect(formatCurrency(0, 'USDT')).toBe('0.00 USDT');
    expect(formatCurrency(null)).toBe('0.00 USDT');
  });

  it('should format PnL with explicit + / - sign and 2 decimal places', () => {
    expect(formatPnL('128.42', 'USDT')).toBe('+128.42 USDT');
    expect(formatPnL('-37.15', 'USDT')).toBe('-37.15 USDT');
    expect(formatPnL(0, 'USDT')).toBe('0.00 USDT');
  });

  it('should format crypto values with dynamic precision', () => {
    expect(formatCryptoPrecision('0.00001234')).toBe('0.00001234');
    expect(formatCryptoPrecision('0.001234')).toBe('0.001234');
    expect(formatCryptoPrecision('0.54321')).toBe('0.5432');
    expect(formatCryptoPrecision('65432.10')).toBe('65,432.10');
    expect(formatCryptoPrecision(null)).toBe('--');
  });
});

describe('Asset Zero Balance Filtering', () => {
  it('should filter out assets with zero balance', () => {
    const assets: CoinBalance[] = [
      {
        coin: 'BTC',
        equity: '0.00',
        usdValue: '0',
        walletBalance: '0.00',
        free: '0',
        locked: '0',
        borrowAmount: '0',
        availableToBorrow: '0',
        availableToWithdraw: '0',
        accruedInterest: '0',
        totalOrderIM: '0',
        totalPositionIM: '0',
        totalPositionMM: '0',
        unrealisedPnl: '0',
        cumRealisedPnl: '0',
        bonus: '0',
      },
      {
        coin: 'USDT',
        equity: '150.00',
        usdValue: '150',
        walletBalance: '150.00',
        free: '150',
        locked: '0',
        borrowAmount: '0',
        availableToBorrow: '0',
        availableToWithdraw: '150',
        accruedInterest: '0',
        totalOrderIM: '0',
        totalPositionIM: '0',
        totalPositionMM: '0',
        unrealisedPnl: '0',
        cumRealisedPnl: '0',
        bonus: '0',
      },
      {
        coin: 'ETH',
        equity: '0.50',
        usdValue: '1800',
        walletBalance: '0.00',
        free: '0.5',
        locked: '0',
        borrowAmount: '0',
        availableToBorrow: '0',
        availableToWithdraw: '0.5',
        accruedInterest: '0',
        totalOrderIM: '0',
        totalPositionIM: '0',
        totalPositionMM: '0',
        unrealisedPnl: '0',
        cumRealisedPnl: '0',
        bonus: '0',
      },
    ];

    const filtered = filterNonZeroAssets(assets);
    expect(filtered.length).toBe(2);
    expect(filtered.map((a) => a.coin)).toEqual(['USDT', 'ETH']);
  });
});
