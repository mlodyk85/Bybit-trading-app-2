/* eslint-disable @typescript-eslint/no-var-requires */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { URL } = require('url');
const AI = require('./aiModel');

const API_KEY = String(process.env.BYBIT_API_KEY || '').trim();
const API_SECRET = String(process.env.BYBIT_API_SECRET || '').trim();
const TOKEN = String(process.env.PRO_ENGINE_TOKEN || '').trim();
const PORT = Number(process.env.PORT || 8790);
const TESTNET = String(process.env.BYBIT_TESTNET || 'false').toLowerCase() === 'true';
const AUTO_START = String(process.env.AUTO_START || 'true').toLowerCase() === 'true';
const SYMBOLS = String(process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,LINKUSDT,DOGEUSDT,SUIUSDT')
  .split(',').map(v => v.trim().toUpperCase()).filter(Boolean);

const CFG = {
  dailyProfitTarget: Number(process.env.DAILY_PROFIT_TARGET_USDT || 10),
  dailyLossLimit: Number(process.env.DAILY_LOSS_LIMIT_USDT || 5),
  maxDrawdownPct: Number(process.env.MAX_DRAWDOWN_PCT || 4),
  minFreePct: Number(process.env.MIN_FREE_USDT_PCT || 35),
  maxOpen: Math.max(1, Number(process.env.MAX_OPEN_POSITIONS || 3)),
  stakePct: Number(process.env.STAKE_EQUITY_PCT || 15),
  minStake: Number(process.env.MIN_STAKE_USDT || 8),
  maxStake: Number(process.env.MAX_STAKE_USDT || 35),
  cooldownMs: Number(process.env.COOLDOWN_MINUTES || 10) * 60_000,
  lossLockMs: Number(process.env.PAIR_LOSS_LOCK_MINUTES || 120) * 60_000,
  aiMinConfidence: Number(process.env.AI_MIN_CONFIDENCE || 0.62),
  aiLearningRate: Number(process.env.AI_LEARNING_RATE || 0.035),
};

if (!API_KEY || !API_SECRET || !TOKEN) {
  console.error('BYBIT_API_KEY, BYBIT_API_SECRET and PRO_ENGINE_TOKEN are required.');
  process.exit(1);
}

const REST = TESTNET ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
const WS_PUBLIC = TESTNET ? 'wss://stream-testnet.bybit.com/v5/public/spot' : 'wss://stream.bybit.com/v5/public/spot';
const STATE_PATH = path.join(__dirname, 'state.json');
const RECV_WINDOW = '5000';
const ORDER_PREFIX = 'pro';

const market = new Map();
const rules = new Map();
const feeRates = new Map();
const pairStats = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function defaultState() {
  return {
    day: todayKey(),
    running: AUTO_START,
    dayLocked: false,
    realizedToday: 0,
    tradesToday: 0,
    winsToday: 0,
    lossesToday: 0,
    startEquity: 0,
    peakEquity: 0,
    lastAction: 'INIT',
    positions: [],
    closed: [],
    cooldowns: {},
    aiModel: AI.defaultModel(),
    lastAiDecision: null,
  };
}

let state = defaultState();
try {
  if (fs.existsSync(STATE_PATH)) {
    state = { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
  }
} catch (e) {
  console.error('state load failed', e.message);
}
state.aiModel = AI.ensureModel(state.aiModel);

function saveState() {
  const tmp = STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

function resetDayIfNeeded() {
  const day = todayKey();
  if (state.day === day) return;
  state.day = day;
  state.dayLocked = false;
  state.realizedToday = 0;
  state.tradesToday = 0;
  state.winsToday = 0;
  state.lossesToday = 0;
  state.startEquity = 0;
  state.peakEquity = 0;
  state.lastAction = 'NEW DAY';
  saveState();
}

function hmac(payload) {
  return crypto.createHmac('sha256', API_SECRET).update(payload).digest('hex');
}

function qs(params = {}) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function bybitGet(endpoint, params = {}, auth = false) {
  const query = qs(params);
  const url = `${REST}${endpoint}${query ? '?' + query : ''}`;
  const headers = {};
  if (auth) {
    const ts = String(Date.now());
    headers['X-BAPI-API-KEY'] = API_KEY;
    headers['X-BAPI-TIMESTAMP'] = ts;
    headers['X-BAPI-RECV-WINDOW'] = RECV_WINDOW;
    headers['X-BAPI-SIGN'] = hmac(ts + API_KEY + RECV_WINDOW + query);
  }
  const res = await fetch(url, { headers });
  const json = await res.json();
  if (!res.ok || json.retCode !== 0) throw new Error(`${endpoint}: ${json.retMsg || res.status}`);
  return json.result;
}

async function bybitPost(endpoint, body) {
  const payload = JSON.stringify(body);
  const ts = String(Date.now());
  const headers = {
    'Content-Type': 'application/json',
    'X-BAPI-API-KEY': API_KEY,
    'X-BAPI-TIMESTAMP': ts,
    'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    'X-BAPI-SIGN': hmac(ts + API_KEY + RECV_WINDOW + payload),
  };
  const res = await fetch(REST + endpoint, { method: 'POST', headers, body: payload });
  const json = await res.json();
  if (!res.ok || json.retCode !== 0) throw new Error(`${endpoint}: ${json.retMsg || res.status}`);
  return json.result;
}

async function wallet() {
  const result = await bybitGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' }, true);
  const account = result?.list?.[0] || {};
  const coins = account.coin || [];
  const usdt = coins.find(c => c.coin === 'USDT') || {};
  const walletBalance = Number(usdt.walletBalance || 0);
  const locked = Number(usdt.locked || 0);
  const free = Math.max(0, walletBalance - Math.max(0, locked), Number(usdt.free || 0), Number(usdt.availableToWithdraw || 0));
  return {
    equity: Number(account.totalEquity || 0),
    balance: Number(account.totalWalletBalance || 0),
    freeUsdt: Number.isFinite(free) ? free : 0,
    coins,
  };
}

async function instrument(symbol) {
  if (rules.has(symbol)) return rules.get(symbol);
  const result = await bybitGet('/v5/market/instruments-info', { category: 'spot', symbol });
  const item = result?.list?.[0];
  if (!item) throw new Error(`No instrument rules for ${symbol}`);
  const out = {
    tickSize: Number(item.priceFilter?.tickSize || 0.00000001),
    qtyStep: Number(item.lotSizeFilter?.basePrecision || item.lotSizeFilter?.qtyStep || 0.00000001),
    minQty: Number(item.lotSizeFilter?.minOrderQty || 0),
    minAmt: Number(item.lotSizeFilter?.minOrderAmt || 5),
  };
  rules.set(symbol, out);
  return out;
}

async function feeRate(symbol) {
  if (feeRates.has(symbol)) return feeRates.get(symbol);
  try {
    const result = await bybitGet('/v5/account/fee-rate', { category: 'spot', symbol }, true);
    const row = result?.list?.[0] || {};
    const value = {
      taker: Math.abs(Number(row.takerFeeRate || 0.001)),
      maker: Math.abs(Number(row.makerFeeRate || 0.001)),
    };
    feeRates.set(symbol, value);
    return value;
  } catch {
    const fallback = { taker: 0.001, maker: 0.001 };
    feeRates.set(symbol, fallback);
    return fallback;
  }
}

function decimals(step) {
  const s = String(step);
  if (!s.includes('.')) return 0;
  return Math.min(12, s.replace(/0+$/, '').split('.')[1]?.length || 0);
}
function floorStep(value, step) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!step || step <= 0) return value;
  const d = decimals(step);
  const stepped = Math.floor((value + Number.EPSILON) / step) * step;
  return Number(stepped.toFixed(d));
}
function ceilStep(value, step) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!step || step <= 0) return value;
  const d = decimals(step);
  const stepped = Math.ceil((value - Number.EPSILON) / step) * step;
  return Number(stepped.toFixed(d));
}

async function klines(symbol, interval, limit = 80) {
  const result = await bybitGet('/v5/market/kline', { category: 'spot', symbol, interval, limit });
  return (result?.list || []).map(r => ({
    ts: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]), turnover: Number(r[6]),
  })).reverse();
}
function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let v = values[0];
  for (let i = 1; i < values.length; i++) v = values[i] * k + v * (1 - k);
  return v;
}
function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    if (i <= 0) continue;
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses += -diff;
  }
  if (losses <= 1e-12) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}
function atrPct(rows, period = 14) {
  if (rows.length < 2) return 0;
  const tr = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].close;
    tr.push(Math.max(rows[i].high - rows[i].low, Math.abs(rows[i].high - prev), Math.abs(rows[i].low - prev)));
  }
  const slice = tr.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
  const close = rows[rows.length - 1].close;
  return close > 0 ? atr / close * 100 : 0;
}
function pct(a, b) {
  return a > 0 ? (b - a) / a * 100 : 0;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

async function signalFor(symbol) {
  const m = market.get(symbol);
  if (!m || !m.bid || !m.ask || !m.last) return null;
  const spreadPct = (m.ask - m.bid) / m.last * 100;
  if (spreadPct < 0 || spreadPct > 0.14) return null;
  if ((m.turnover24h || 0) < 5_000_000) return null;

  const [one, five, fifteen] = await Promise.all([
    klines(symbol, '1', 90),
    klines(symbol, '5', 70),
    klines(symbol, '15', 60),
  ]);
  if (one.length < 40 || five.length < 35 || fifteen.length < 30) return null;

  const c1 = one.map(x => x.close);
  const c5 = five.map(x => x.close);
  const c15 = fifteen.map(x => x.close);
  const last = c1[c1.length - 1];
  const last5 = c5[c5.length - 1];
  const last15 = c15[c15.length - 1];
  const ema9 = ema(c1.slice(-60), 9);
  const ema21 = ema(c1.slice(-70), 21);
  const ema9_5 = ema(c5.slice(-60), 9);
  const ema21_5 = ema(c5.slice(-70), 21);
  const ema20_15 = ema(c15.slice(-60), 20);
  const ema50_15 = ema(c15.slice(-60), 50);
  const rsi14 = rsi(c1, 14);
  const atr = atrPct(one, 14);
  const mom3 = pct(c1[c1.length - 4], last);
  const mom5m = pct(c5[c5.length - 4], last5);
  const enoughRange = atr >= Math.max(0.035, spreadPct * 2.2);
  if (!enoughRange || mom5m < -0.85) return null;

  const discountPct = ema21 > 0 ? (ema21 - last) / ema21 * 100 : 0;
  const meanReversion = discountPct >= 0.05 && discountPct <= 1.10
    && rsi14 >= 34 && rsi14 <= 54
    && mom3 >= 0.025
    && last5 >= ema21_5 * 0.992
    && last15 >= ema50_15 * 0.985;

  const distanceToFast = ema9 > 0 ? Math.abs(last - ema9) / ema9 * 100 : 99;
  const trendPullback = ema9 > ema21
    && ema9_5 >= ema21_5
    && ema20_15 >= ema50_15
    && distanceToFast <= 0.22
    && rsi14 >= 48 && rsi14 <= 67
    && mom3 >= 0.02;

  if (!meanReversion && !trendPullback) return null;

  const features = {
    trend1m: clamp(((ema9 - ema21) / Math.max(last, 1e-9) * 100) / 0.30, -1, 1),
    trend5m: clamp(((ema9_5 - ema21_5) / Math.max(last5, 1e-9) * 100) / 0.45, -1, 1),
    trend15m: clamp(((ema20_15 - ema50_15) / Math.max(last15, 1e-9) * 100) / 0.75, -1, 1),
    rsiBalance: clamp(1 - Math.abs(rsi14 - 55) / 25, -1, 1),
    momentum1m: clamp(mom3 / 0.30, -1, 1),
    momentum5m: clamp(mom5m / 0.65, -1, 1),
    atrVsSpread: clamp((atr / Math.max(0.01, spreadPct) - 2) / 5, -1, 1),
    discount: clamp(discountPct / 1.0, -1, 1),
    liquidity: clamp((Math.log10(Math.max(1, m.turnover24h)) - 6.7) / 2.0, -1, 1),
    setupBias: meanReversion ? 0.45 : 0.80,
  };

  const aiConfidence = AI.predict(state.aiModel, features);
  const learned = Number(state.aiModel.tradesLearned || 0);
  const adaptiveThreshold = learned < 20
    ? Math.max(0.58, CFG.aiMinConfidence - 0.04)
    : clamp(CFG.aiMinConfidence - Number(state.aiModel.rollingReward || 0) * 0.03, 0.58, 0.70);

  state.lastAiDecision = {
    symbol,
    confidence: aiConfidence,
    threshold: adaptiveThreshold,
    setup: meanReversion ? 'DIP_REBOUND' : 'TREND_PULLBACK',
    at: Date.now(),
    accepted: aiConfidence >= adaptiveThreshold,
  };

  if (aiConfidence < adaptiveThreshold) {
    state.lastAction = `AI REJECT ${symbol} • confidence ${(aiConfidence * 100).toFixed(1)}% < ${(adaptiveThreshold * 100).toFixed(1)}%`;
    saveState();
    return null;
  }

  const score = aiConfidence * 100
    + clamp(mom3, 0, 0.30) * 8
    + clamp(atr, 0, 0.40) * 2
    - spreadPct * 8;

  return {
    symbol,
    score,
    setup: meanReversion ? 'DIP_REBOUND' : 'TREND_PULLBACK',
    spreadPct,
    rsi14,
    atrPct: atr,
    mom3Pct: mom3,
    mom5mPct: mom5m,
    bid: m.bid,
    ask: m.ask,
    last,
    aiConfidence,
    aiThreshold: adaptiveThreshold,
    aiFeatures: features,
  };
}

async function createOrder(body) {
  return bybitPost('/v5/order/create', body);
}
async function cancelOrder(symbol, orderId) {
  return bybitPost('/v5/order/cancel', { category: 'spot', symbol, orderId });
}
async function orderState(symbol, orderId) {
  const result = await bybitGet('/v5/order/realtime', { category: 'spot', symbol, orderId }, true);
  return result?.list?.[0] || null;
}
async function executions(symbol, orderId) {
  const result = await bybitGet('/v5/execution/list', { category: 'spot', symbol, orderId, limit: 100 }, true);
  return result?.list || [];
}
async function waitFill(symbol, orderId, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await executions(symbol, orderId);
    if (rows.length) {
      const qty = rows.reduce((s, r) => s + Number(r.execQty || 0), 0);
      const quote = rows.reduce((s, r) => s + Number(r.execQty || 0) * Number(r.execPrice || 0), 0);
      const avg = qty > 0 ? quote / qty : 0;
      const fees = {};
      for (const r of rows) {
        const c = String(r.feeCurrency || r.feeCoin || '').toUpperCase();
        if (c) fees[c] = (fees[c] || 0) + Math.abs(Number(r.execFee || 0));
      }
      const st = await orderState(symbol, orderId).catch(() => null);
      if (!st || ['Filled', 'PartiallyFilled'].includes(st.orderStatus)) {
        if (st?.orderStatus === 'Filled' || Number(st?.leavesQty || 0) <= qty * 0.001) return { qty, quote, avg, fees };
      }
    }
    await new Promise(r => setTimeout(r, 350));
  }
  throw new Error(`Fill timeout ${symbol} ${orderId}`);
}

function link(kind, symbol) {
  return `${ORDER_PREFIX}-${kind}-${symbol.slice(0, 8)}-${Date.now().toString(36)}`.slice(0, 36);
}

function estimateNet(position, bid, exitFeeRate) {
  const proceeds = position.qty * bid * (1 - exitFeeRate);
  return proceeds - position.costUsdt;
}

async function placeExit(position, targetPct) {
  const r = await instrument(position.symbol);
  const fee = await feeRate(position.symbol);
  const raw = position.entryPrice * (1 + targetPct / 100);
  const current = market.get(position.symbol);
  const price = ceilStep(Math.max(raw, (current?.ask || raw) + r.tickSize), r.tickSize);
  const qty = floorStep(position.qty, r.qtyStep);
  if (qty < r.minQty || qty * price < r.minAmt) throw new Error(`Exit below minimum for ${position.symbol}`);
  const result = await createOrder({
    category: 'spot', symbol: position.symbol, side: 'Sell', orderType: 'Limit',
    qty: qty.toFixed(decimals(r.qtyStep)), price: price.toFixed(decimals(r.tickSize)),
    timeInForce: 'PostOnly', orderLinkId: link('sell', position.symbol),
  });
  position.exitOrderId = result.orderId;
  position.targetPrice = price;
  position.targetPct = targetPct;
  position.exitMakerFee = fee.maker;
  position.updatedAt = Date.now();
  saveState();
}

async function openPosition(sig, account) {
  const equity = account.equity;
  const reserve = equity * CFG.minFreePct / 100;
  const rawStake = equity * CFG.stakePct / 100;
  const confidenceFactor = clamp(0.75 + (Number(sig.aiConfidence || 0.5) - 0.5) * 1.7, 0.75, 1.35);
  const rewardFactor = clamp(1 + Number(state.aiModel.rollingReward || 0) * 0.20, 0.80, 1.15);
  const stake = clamp(rawStake * confidenceFactor * rewardFactor, CFG.minStake, CFG.maxStake);
  if (account.freeUsdt - reserve < stake) {
    state.lastAction = `BUY BLOCKED: reserve ${CFG.minFreePct}%`;
    return false;
  }
  if (state.positions.length >= CFG.maxOpen) return false;
  if (state.positions.some(p => p.symbol === sig.symbol)) return false;
  const cooldown = Number(state.cooldowns[sig.symbol] || 0);
  if (cooldown > Date.now()) return false;

  const lossLock = pairStats.get(sig.symbol)?.lockUntil || 0;
  if (lossLock > Date.now()) return false;

  const fee = await feeRate(sig.symbol);
  const result = await createOrder({
    category: 'spot', symbol: sig.symbol, side: 'Buy', orderType: 'Market',
    qty: stake.toFixed(2), marketUnit: 'quoteCoin', isLeverage: 0,
    orderLinkId: link('buy', sig.symbol),
  });
  const fill = await waitFill(sig.symbol, result.orderId);
  const base = sig.symbol.replace(/USDT$/, '');
  const baseFee = Number(fill.fees[base] || 0);
  const usdtFee = Number(fill.fees.USDT || 0);
  const qty = Math.max(0, fill.qty - baseFee);
  const cost = fill.quote + usdtFee + baseFee * fill.avg;

  // Dynamic TP: fees + spread + volatility. The engine tries to rotate capital rather than wait for huge moves.
  const roundTripPct = (fee.taker + fee.maker) * 100;
  const targetPct = clamp(Math.max(0.30, roundTripPct + sig.spreadPct + 0.10, sig.atrPct * 0.75), 0.30, 1.05);
  const stopPct = clamp(Math.max(0.75, sig.atrPct * 2.3), 0.75, 1.80);

  const position = {
    id: result.orderId, symbol: sig.symbol, qty, costUsdt: cost, entryPrice: fill.avg,
    openedAt: Date.now(), updatedAt: Date.now(), setup: sig.setup,
    targetPct, stopPct, peakPct: 0, exitOrderId: null, targetPrice: 0,
    entryTakerFee: fee.taker, exitMakerFee: fee.maker,
    aiConfidence: Number(sig.aiConfidence || 0),
    aiThreshold: Number(sig.aiThreshold || 0),
    aiFeatures: sig.aiFeatures || null,
  };
  state.positions.push(position);
  state.lastAction = `AI BUY ${sig.symbol} ${stake.toFixed(2)} USDT • ${sig.setup} • confidence ${(Number(sig.aiConfidence || 0) * 100).toFixed(1)}%`;
  saveState();
  await placeExit(position, targetPct);
  return true;
}

async function marketClose(position, reason) {
  if (position.exitOrderId) {
    try { await cancelOrder(position.symbol, position.exitOrderId); } catch { /* best-effort cleanup */ }
    position.exitOrderId = null;
  }
  const r = await instrument(position.symbol);
  const qty = floorStep(position.qty, r.qtyStep);
  if (qty <= 0) return false;
  const result = await createOrder({
    category: 'spot', symbol: position.symbol, side: 'Sell', orderType: 'Market',
    qty: qty.toFixed(decimals(r.qtyStep)), marketUnit: 'baseCoin',
    orderLinkId: link('close', position.symbol),
  });
  const fill = await waitFill(position.symbol, result.orderId);
  const base = position.symbol.replace(/USDT$/, '');
  const feeQuote = Number(fill.fees.USDT || 0) + Number(fill.fees[base] || 0) * fill.avg;
  const net = fill.quote - feeQuote - position.costUsdt;
  recordClosed(position, net, reason);
  return true;
}

function recordClosed(position, pnl, reason) {
  state.positions = state.positions.filter(p => p.id !== position.id);
  if (position.aiFeatures) {
    state.aiModel = AI.update(
      state.aiModel,
      position.aiFeatures,
      pnl,
      Number(position.costUsdt || 0),
      CFG.aiLearningRate
    );
  }
  state.realizedToday += pnl;
  state.tradesToday += 1;
  if (pnl >= 0) state.winsToday += 1; else state.lossesToday += 1;
  state.closed.unshift({ symbol: position.symbol, pnl, reason, openedAt: position.openedAt, closedAt: Date.now(), setup: position.setup, aiConfidence: position.aiConfidence || 0 });
  state.closed = state.closed.slice(0, 200);
  state.cooldowns[position.symbol] = Date.now() + CFG.cooldownMs;

  const stats = pairStats.get(position.symbol) || { recent: [], lockUntil: 0 };
  stats.recent.push({ at: Date.now(), pnl });
  stats.recent = stats.recent.filter(x => x.at > Date.now() - 6 * 60 * 60_000).slice(-10);
  const losses = stats.recent.filter(x => x.pnl < 0).length;
  const sum = stats.recent.reduce((s, x) => s + x.pnl, 0);
  if (pnl < 0 && losses >= 2) stats.lockUntil = Date.now() + CFG.lossLockMs;
  else if (stats.recent.length >= 3 && sum <= 0) stats.lockUntil = Date.now() + 60 * 60_000;
  pairStats.set(position.symbol, stats);

  state.lastAction = `CLOSE ${position.symbol} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} • ${reason}`;
  saveState();
}

async function reconcilePositions() {
  for (const position of [...state.positions]) {
    const m = market.get(position.symbol);
    if (!m?.bid) continue;
    const fee = await feeRate(position.symbol);
    const currentPct = pct(position.entryPrice, m.bid);
    position.peakPct = Math.max(position.peakPct || 0, currentPct);

    if (position.exitOrderId) {
      const st = await orderState(position.symbol, position.exitOrderId).catch(() => null);
      if (st?.orderStatus === 'Filled') {
        const fill = await executions(position.symbol, position.exitOrderId);
        const quote = fill.reduce((s, r) => s + Number(r.execQty || 0) * Number(r.execPrice || 0), 0);
        const base = position.symbol.replace(/USDT$/, '');
        let feeQuote = 0;
        for (const row of fill) {
          const fc = String(row.feeCurrency || row.feeCoin || '').toUpperCase();
          const fv = Math.abs(Number(row.execFee || 0));
          if (fc === 'USDT') feeQuote += fv;
          else if (fc === base) feeQuote += fv * Number(row.execPrice || 0);
        }
        const pnl = quote - feeQuote - position.costUsdt;
        recordClosed(position, pnl, 'TARGET_LIMIT');
        continue;
      }
      if (st && ['Cancelled', 'Rejected', 'Deactivated'].includes(st.orderStatus)) {
        position.exitOrderId = null;
      }
    }

    const estNet = estimateNet(position, m.bid, fee.taker);
    const ageH = (Date.now() - position.openedAt) / 3_600_000;

    // Hard stop prevents a single bad coin from freezing capital for days.
    if (currentPct <= -Math.abs(position.stopPct)) {
      await marketClose(position, 'HARD_STOP');
      continue;
    }

    // Trailing positive exit: once a decent move occurred, protect actual profit instead of waiting forever.
    if (position.peakPct >= Math.max(0.28, position.targetPct * 0.65)
        && position.peakPct - currentPct >= 0.12
        && estNet >= Math.max(0.05, position.costUsdt * 0.0015)) {
      await marketClose(position, 'TRAILING_PROFIT');
      continue;
    }

    // Capital release: after 4h, if a stale trade is back to a small positive net result,
    // lower the maker target so capital rotates instead of sitting idle for days.
    if (ageH >= 4 && estNet >= Math.max(0.06, position.costUsdt * 0.0015)) {
      if (position.exitOrderId) {
        try { await cancelOrder(position.symbol, position.exitOrderId); } catch { /* best-effort cleanup */ }
        position.exitOrderId = null;
      }
      const recoveryPct = clamp((fee.taker + fee.maker) * 100 + 0.12, 0.24, 0.45);
      await placeExit(position, recoveryPct);
      state.lastAction = `RECOVERY SELL ${position.symbol} target ${recoveryPct.toFixed(2)}%`;
      saveState();
      continue;
    }

    if (!position.exitOrderId) await placeExit(position, position.targetPct);
  }
}

async function riskGate(account) {
  resetDayIfNeeded();
  if (!state.startEquity && account.equity > 0) state.startEquity = account.equity;
  if (account.equity > state.peakEquity) state.peakEquity = account.equity;
  const ddPct = state.peakEquity > 0 ? (state.peakEquity - account.equity) / state.peakEquity * 100 : 0;
  if (state.realizedToday >= CFG.dailyProfitTarget) {
    state.dayLocked = true;
    state.lastAction = `DAILY TARGET +${state.realizedToday.toFixed(2)} reached`;
  }
  if (state.realizedToday <= -Math.abs(CFG.dailyLossLimit)) {
    state.dayLocked = true;
    state.lastAction = `DAILY LOSS ${state.realizedToday.toFixed(2)} reached`;
  }
  if (ddPct >= CFG.maxDrawdownPct) {
    state.dayLocked = true;
    state.lastAction = `MAX DRAWDOWN ${ddPct.toFixed(2)}%`;
  }
  saveState();
  return { ddPct };
}

let symbolIndex = 0;
let loopBusy = false;

async function engineTick() {
  if (loopBusy) return;
  loopBusy = true;
  try {
    const account = await wallet();
    await riskGate(account);
    await reconcilePositions();

    if (!state.running || state.dayLocked) return;
    if (state.positions.length >= CFG.maxOpen) return;
    if (account.equity <= 0 || account.freeUsdt <= 0) return;

    const symbol = SYMBOLS[symbolIndex++ % SYMBOLS.length];
    if (state.positions.some(p => p.symbol === symbol)) return;
    if (Number(state.cooldowns[symbol] || 0) > Date.now()) return;
    if ((pairStats.get(symbol)?.lockUntil || 0) > Date.now()) return;

    const sig = await signalFor(symbol);
    if (!sig) return;
    await openPosition(sig, account);
  } catch (e) {
    state.lastAction = `ERROR: ${e.message}`;
    saveState();
  } finally {
    loopBusy = false;
  }
}

function wsConnect() {
  const ws = new WebSocket(WS_PUBLIC);
  ws.on('open', () => {
    const args = [];
    for (const s of SYMBOLS) {
      args.push(`tickers.${s}`);
      args.push(`orderbook.1.${s}`);
    }
    ws.send(JSON.stringify({ op: 'subscribe', args }));
  });
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(String(raw));
      if (!msg.topic || !msg.data) return;
      if (msg.topic.startsWith('tickers.')) {
        const d = msg.data;
        const symbol = d.symbol || msg.topic.split('.')[1];
        const prev = market.get(symbol) || {};
        market.set(symbol, {
          ...prev,
          symbol,
          bid: Number(d.bid1Price || prev.bid || 0),
          ask: Number(d.ask1Price || prev.ask || 0),
          last: Number(d.lastPrice || prev.last || 0),
          turnover24h: Number(d.turnover24h || prev.turnover24h || 0),
          ts: Date.now(),
        });
      } else if (msg.topic.startsWith('orderbook.1.')) {
        const d = msg.data;
        const symbol = d.s || msg.topic.split('.')[2];
        const prev = market.get(symbol) || {};
        const bid = Number(d.b?.[0]?.[0] || prev.bid || 0);
        const ask = Number(d.a?.[0]?.[0] || prev.ask || 0);
        market.set(symbol, { ...prev, symbol, bid, ask, last: prev.last || (bid + ask) / 2, ts: Date.now() });
      }
    } catch { /* best-effort cleanup */ }
  });
  ws.on('close', () => setTimeout(wsConnect, 1500));
  ws.on('error', () => { try { ws.close(); } catch { /* best-effort cleanup */ } });
}

async function closeAll(reason = 'REMOTE_CLOSE_ALL') {
  for (const p of [...state.positions]) {
    try { await marketClose(p, reason); } catch (e) { state.lastAction = `CLOSE ERROR ${p.symbol}: ${e.message}`; }
  }
  saveState();
}

async function closeProfitable() {
  for (const p of [...state.positions]) {
    const m = market.get(p.symbol);
    if (!m?.bid) continue;
    const fee = await feeRate(p.symbol);
    const net = estimateNet(p, m.bid, fee.taker);
    if (net > 0.05) {
      try { await marketClose(p, 'REMOTE_CLOSE_PROFITABLE'); } catch { /* best-effort cleanup */ }
    }
  }
}

function statusSnapshot() {
  const unrealized = state.positions.reduce((sum, p) => {
    const m = market.get(p.symbol);
    if (!m?.bid) return sum;
    return sum + (p.qty * m.bid - p.costUsdt);
  }, 0);
  return {
    service: 'PRO_ENGINE',
    running: state.running,
    dayLocked: state.dayLocked,
    day: state.day,
    dailyTarget: CFG.dailyProfitTarget,
    dailyLossLimit: CFG.dailyLossLimit,
    realizedToday: state.realizedToday,
    unrealized,
    tradesToday: state.tradesToday,
    winsToday: state.winsToday,
    lossesToday: state.lossesToday,
    openPositions: state.positions.map(p => {
      const m = market.get(p.symbol);
      const mark = m?.bid || p.entryPrice;
      return {
        symbol: p.symbol, qty: p.qty, entryPrice: p.entryPrice, markPrice: mark,
        pnl: p.qty * mark - p.costUsdt, openedAt: p.openedAt,
        targetPct: p.targetPct, stopPct: p.stopPct, setup: p.setup,
        aiConfidence: Number(p.aiConfidence || 0),
      };
    }),
    maxOpen: CFG.maxOpen,
    reservePct: CFG.minFreePct,
    stakePct: CFG.stakePct,
    ai: {
      mode: 'ONLINE_LOGISTIC',
      minConfidence: CFG.aiMinConfidence,
      tradesLearned: Number(state.aiModel.tradesLearned || 0),
      winsLearned: Number(state.aiModel.winsLearned || 0),
      lossesLearned: Number(state.aiModel.lossesLearned || 0),
      rollingReward: Number(state.aiModel.rollingReward || 0),
      lastUpdateAt: Number(state.aiModel.lastUpdateAt || 0),
      lastDecision: state.lastAiDecision,
      topWeights: AI.topWeights(state.aiModel, 4),
    },
    lastAction: state.lastAction,
    recentClosed: state.closed.slice(0, 10),
  };
}

function auth(req) {
  return String(req.headers.authorization || '') === `Bearer ${TOKEN}`;
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 128000) reject(new Error('payload too large')); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const app = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'PRO_ENGINE' });
    if (!auth(req)) return json(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const account = await wallet().catch(() => ({ equity: 0, balance: 0, freeUsdt: 0 }));
      return json(res, 200, { ...statusSnapshot(), account });
    }

    if (req.method === 'POST' && url.pathname === '/api/command') {
      const payload = JSON.parse((await readBody(req)) || '{}');
      const command = String(payload.command || '').toUpperCase();
      if (command === 'START') {
        state.running = true; state.dayLocked = false; state.lastAction = 'REMOTE START'; saveState();
      } else if (command === 'STOP') {
        state.running = false; state.lastAction = 'REMOTE STOP'; saveState();
      } else if (command === 'CLOSE_ALL') {
        await closeAll();
      } else if (command === 'CLOSE_PROFITABLE') {
        await closeProfitable();
      } else if (command === 'RESET_DAY') {
        const keepRunning = state.running;
        state = { ...defaultState(), running: keepRunning, positions: state.positions, closed: state.closed, cooldowns: state.cooldowns };
        saveState();
      } else {
        return json(res, 400, { error: 'invalid command' });
      }
      return json(res, 202, { accepted: true, command });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

wsConnect();
setInterval(() => { void engineTick(); }, 1500);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI PRO ENGINE listening on :${PORT} • Bybit ${TESTNET ? 'TESTNET' : 'MAINNET'} • online model • daily target ${CFG.dailyProfitTarget} USDT`);
});
