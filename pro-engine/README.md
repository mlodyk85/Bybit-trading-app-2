# Bybit PRO Engine

External 24/7 Spot execution engine for the mobile app.

This is intentionally separate from React Native so trading does not stop when Android suspends the app. The phone is a controller/monitor; the engine runs continuously on a MacBook or VPS.

## Architecture

Bybit public WebSocket (ticker + L1 order book) -> PRO Engine strategy/risk/order manager -> Bybit V5 REST orders -> mobile PRO tab.

The design borrows mature patterns rather than copying code:
- WebSocket-driven market data and exchange reconciliation similar to Hummingbot connectors.
- Pair cooldowns, loss locks and max-drawdown/day locks similar to Freqtrade protections.
- The engine only manages lots it opened itself. It does not sell your pre-existing BTC/XRP/other holdings.

## Strategy

Two entry setups:
1. DIP_REBOUND: price is below EMA21, RSI is discounted, then short-term rebound is confirmed.
2. TREND_PULLBACK: 1m and 5m EMA trend is positive, price pulls back near EMA9 and resumes.

A BUY is blocked when:
- spread is too wide,
- 24h turnover is too low,
- 5m momentum is a hard downtrend,
- pair is cooling down / loss-locked,
- maximum positions are already open,
- the USDT reserve would be violated,
- daily profit target, daily loss limit or max drawdown lock is active.

After BUY:
- actual fill and fee are read from Bybit,
- a PostOnly limit SELL is placed immediately,
- TP is dynamic from fees + spread + ATR,
- a trailing positive market exit can release profit before the resting target,
- stale trades returning to a small positive net result get a lower recovery target,
- a hard stop prevents one bad coin from freezing capital indefinitely.

## Daily target

Default: `DAILY_PROFIT_TARGET_USDT=10`.

This is a stopping/goal condition, not a guaranteed daily return. If the engine reaches +10 USDT realized PnL, it stops opening new positions for the rest of the UTC day.

## MacBook setup

1. Install Node.js 20+.
2. Open Terminal:
   ```bash
   cd Bybit-trading-app-2/pro-engine
   npm install
   cp .env.example .env
   ```
3. Edit `.env` and set:
   - `BYBIT_API_KEY`
   - `BYBIT_API_SECRET`
   - `PRO_ENGINE_TOKEN`
4. Export the file and start:
   ```bash
   set -a
   source .env
   set +a
   npm start
   ```
5. Terminal should show:
   ```
   PRO ENGINE listening on :8790
   ```
6. Find MacBook LAN IP, for example:
   ```bash
   ipconfig getifaddr en0
   ```
7. In the Android app open **PRO** and enter:
   - Address: `http://MACBOOK_IP:8790`
   - Token: exactly the same `PRO_ENGINE_TOKEN`

Phone and MacBook must be on the same LAN for a private `192.168.x.x` address.

For 24/7 use, move the engine to a VPS or keep the MacBook awake. Do not expose the raw port to the public internet without VPN/firewall/HTTPS.

## Bybit API key permissions

Use a dedicated API key for the engine:
- Spot trading enabled.
- Withdrawals disabled.

Never put the API secret into the Android app or commit `.env`.

## Defaults

- Daily profit target: +10 USDT
- Daily loss limit: -5 USDT
- Max drawdown: 4%
- Minimum USDT reserve: 35% equity
- Max positions: 3
- Stake: 15% equity, clamped to 8-35 USDT
- Cooldown: 10 minutes
- Pair loss lock: 120 minutes after repeated losses

Tune only after observing several days of fills and realized/unrealized PnL.
