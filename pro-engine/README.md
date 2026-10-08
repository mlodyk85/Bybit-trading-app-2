# Bybit AI PRO Engine

External autonomous 24/7 Spot execution engine with an adaptive online-learning layer for the mobile app.

This is intentionally separate from React Native so trading does not stop when Android suspends the app. The phone is a controller/monitor; the engine runs continuously on a MacBook or VPS.

## Architecture

Bybit public WebSocket (ticker + L1 order book) -> PRO Engine strategy/risk/order manager -> Bybit V5 REST orders -> mobile PRO tab.

The design borrows mature patterns rather than copying code:
- WebSocket-driven market data and exchange reconciliation similar to Hummingbot connectors.
- Pair cooldowns, loss locks and max-drawdown/day locks similar to Freqtrade protections.
- The engine only manages lots it opened itself. It does not sell your pre-existing BTC/XRP/other holdings.

## AI decision layer

The engine uses a lightweight online logistic model rather than an LLM. The model scores every technically valid setup using normalized market features:

- 1m, 5m and 15m trend alignment,
- RSI balance,
- short momentum and 5m momentum,
- ATR relative to spread,
- discount from EMA,
- 24h liquidity,
- setup type.

The initial model uses conservative bootstrap weights. After every fully closed engine-owned trade it updates the weights using the actual net PnL as reward/penalty. The model state is persisted in `state.json`, so learning survives restarts.

The AI is not allowed to bypass hard risk controls. Daily loss, drawdown, USDT reserve, position count, pair cooldowns and pair loss locks remain deterministic.

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

## Autonomous MacBook service

After the normal setup below, install the macOS LaunchAgent:

```bash
cd Bybit-trading-app-2/pro-engine
/bin/zsh install-macos-launchagent.sh
```

This configures **RunAtLoad + KeepAlive**. The process starts after macOS login and is restarted if it exits. Logs are written to `pro-engine/logs/`.

The MacBook still needs power, internet access and must not be in deep sleep for true 24/7 operation. For uninterrupted operation, a VPS remains the better host.

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
   - keep `AUTO_START=true` for autonomous trading after process startup/restart
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


## Autonomous mode

`AUTO_START=true` is the default. On the first start the engine begins trading automatically as soon as it has valid Bybit credentials and market data.

The mobile app does not need to remain open. The engine keeps scanning, opening trades, placing exits, reconciling orders and managing risk on the MacBook/VPS.

An explicit **STOP** command is persisted in `state.json`; after a manual STOP, a process restart does not silently re-enable trading. Use **START** from the PRO tab to resume.


## AI tuning

- `AI_MIN_CONFIDENCE=0.62` — minimum model probability after the bootstrap period.
- `AI_LEARNING_RATE=0.035` — online update step.

Do not raise position size just because model confidence is high. The engine already applies only a bounded confidence multiplier to the stake.


## Autonomous market selection

The engine no longer relies only on a fixed symbol list. Every few minutes it refreshes a liquid USDT universe from Bybit Spot tickers and filters for:

- minimum 24h turnover,
- narrow spread,
- non-stablecoin base assets,
- avoidance of extreme 24h pumps/dumps,
- existing engine-owned positions so exits are never abandoned.

The current universe is pushed to the Android AI panel.

## Smart exit plan immediately after BUY

Before opening a position the engine estimates:

- round-trip fee cost,
- live spread,
- ATR,
- average absolute 1m movement,
- AI confidence.

It derives a dynamic profit target and expected holding time from those inputs. If the projected **net** profit is below `MIN_EXPECTED_NET_USDT`, the trade is skipped.

After the BUY fill is confirmed, the engine immediately places a PostOnly LIMIT SELL above the actual average entry. This is the primary exit. Trailing-profit and recovery exits remain secondary fallbacks.
