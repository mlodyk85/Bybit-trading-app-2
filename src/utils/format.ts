import { CoinBalance } from '../api/types';

/**
 * Formats a currency value with 2 decimal places.
 */
export function formatCurrency(value: string | number | undefined | null, currency = 'USDT'): string {
  if (value === undefined || value === null || value === '') {
    return `0.00 ${currency}`;
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) {
    return `0.00 ${currency}`;
  }
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * Formats PnL with explicit + or - sign and 2 decimal places.
 */
export function formatPnL(value: string | number | undefined | null, currency = 'USDT'): string {
  if (value === undefined || value === null || value === '') {
    return `+0.00 ${currency}`;
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) {
    return `+0.00 ${currency}`;
  }
  const formatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (num > 0) {
    return `+${formatted} ${currency}`;
  } else if (num < 0) {
    return `-${formatted} ${currency}`;
  }
  return `0.00 ${currency}`;
}

/**
 * Formats crypto prices or amounts with dynamic precision based on magnitude.
 */
export function formatCryptoPrecision(value: string | number | undefined | null, fallback = '--'): string {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) {
    return fallback;
  }

  const absNum = Math.abs(num);
  let decimals = 2;

  if (absNum < 0.0001) {
    decimals = 8;
  } else if (absNum < 0.01) {
    decimals = 6;
  } else if (absNum < 1) {
    decimals = 4;
  } else if (absNum < 1000) {
    decimals = 2;
  } else {
    decimals = 2;
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Filters out coin balances that have zero balance across equity and wallet balance.
 */
export function filterNonZeroAssets(assets: CoinBalance[] | undefined | null): CoinBalance[] {
  if (!assets || !Array.isArray(assets)) {
    return [];
  }
  return assets.filter((asset) => {
    const wb = parseFloat(asset.walletBalance || '0');
    const eq = parseFloat(asset.equity || '0');
    return wb > 0 || eq > 0;
  });
}

/**
 * Formats date into readable Polish time string (e.g. "14:32:05").
 */
export function formatTime(date: Date | null): string {
  if (!date) {
    return '--:--:--';
  }
  return date.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
