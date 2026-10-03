# MT5 Capital Rotation Gold

Standalone Expert Advisor for the **Bybit MT5 CFD Account**. It is separate from the native Bybit Spot/Futures/TradFi Perpetual engines.

## Core logic

- XAUUSD / gold symbol available in Bybit MT5 CFD. Leave `InpSymbol` empty and attach it to the gold chart exposed by Bybit MT5.
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
4. Log in to the **Bybit MT5 CFD Account** in MetaTrader 5 and open its XAUUSD/gold chart.
5. Attach the EA and enable Algo Trading.
6. Start on the Bybit MT5 demo environment/account if available, because symbol specification, tick value, minimum lot and spread can differ from native Bybit XAUUSDT TradFi Perpetual.

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


## Bridge / sterowanie z telefonu

EA może połączyć się z `mt5-bridge`, który jest w tym samym repo.

W parametrach EA:
- `InpBridgeEnabled = true`
- `InpBridgeUrl = http://IP_LUB_HOST:8787`
- `InpBridgeToken = ten sam token co MT5_BRIDGE_TOKEN`

W MT5 dodaj URL Bridge do **Tools → Options → Expert Advisors → Allow WebRequest for listed URL**.

Po uruchomieniu Bridge i EA zakładka **MT5** w aplikacji pokazuje telemetrykę i pozwala wysłać:
`START`, `STOP`, `CLOSE_ALL`, `RESET_DAY_LOCK`.

STOP blokuje tylko nowe wejścia. Nie zamyka pozycji. `CLOSE_ALL` zamyka pozycje zarządzane przez EA o tym samym magic number.

Do dostępu przez Internet użyj HTTPS/VPN/firewalla. Nie wystawiaj surowego portu Bridge bez zabezpieczenia.


## Bybit product distinction

- **This EA / MT5 module**: Bybit **MT5 CFD Account**, executed inside MetaTrader 5.
- **GOLD SCALPER in the Android app**: native Bybit **XAUUSDT TradFi Perpetual 24/7**, executed directly through Bybit V5. It does not need MT5 Bridge.

The two products may both represent gold exposure, but they are different trading engines, balances and execution paths.
