# MT5 Capital Rotation Gold

Standalone MetaTrader 5 Expert Advisor. This is separate from the Bybit Spot/Futures engines.

## Core logic

- XAUUSD / broker gold symbol (leave `InpSymbol` empty and attach it to the broker's gold chart).
- M5 signal + M15 EMA trend filter.
- ATR volatility sizing and ATR stop.
- RSI confirmation.
- LONG and SHORT.
- Basket profit target / basket loss limit.
- Daily realized-profit target, daily loss limit and peak-equity drawdown lock.
- Margin and free-margin guards.
- Entry cooldown and maximum position count.
- No martingale.
- No averaging down. Additional layers are allowed only when the current basket is non-negative and the signal is still in the same direction.

## Install

1. Open MetaEditor from MT5.
2. Copy `CapitalRotationGoldEA.mq5` into `MQL5/Experts/`.
3. Compile it.
4. Open your broker's XAUUSD chart.
5. Attach the EA and enable Algo Trading.
6. Start on demo because broker symbol specs, tick value, minimum lot and spread differ.

## Initial demo settings

- Max positions: 2
- Risk per trade: 0.25–0.50%
- Basket profit target: 1.00 account currency
- Basket loss limit: 3.00
- Daily profit target: 10.00
- Daily loss limit: 5.00
- Max equity drawdown: 4%

These are risk-control defaults, not guaranteed returns.

The EA checks MT5 trade result codes after requests and uses account equity, margin and free margin directly from MT5.
