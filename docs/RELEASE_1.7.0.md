# Bybit Trading App 1.7.0 (build 170)

## Cel wydania

Wydanie zastępuje prosty skaner Happy Hour adaptacyjnym silnikiem rynku. Celem jest poprawa oczekiwanej wartości wyniku netto przy ograniczonej ekspozycji. Strategia nie gwarantuje zysku i nadal wymaga wdrożenia etapowego: DEMO, mały limit LIVE, analiza wyników po kosztach.

## Zmiany

- Reżimy `TREND_UP`, `TREND_DOWN`, `RANGE`, `HIGH_VOLATILITY`.
- Momentum/breakout wyłącznie w potwierdzonym trendzie wzrostowym.
- Range/grid tylko przy płynności, odbiciu i amplitudzie uzasadniającej koszty.
- Brak nowych spekulacyjnych Spot BUY w trendzie spadkowym i przy nadmiernej zmienności.
- Ranking płynnych par non-CORE i maksymalnie dwie aktywne pozycje Happy Hour.
- Twardy CORE lock w polityce oraz na granicy API autonomicznego SELL dla XRP/BTC/ETH/SOL/PEPE/FLOKI/VELO.
- Happy Hour i SMART mają osobne flagi stop/start, lifecycle i pętle. SMART nie wywołuje już kroku Happy Hour.
- Centralny Capital Manager uwzględnia rezerwę USDT, otwarte zlecenia BUY, rezerwę SMART oraz lokalne rezerwacje in-flight.
- Dust guard używa `qtyStep`, `minOrderQty`, `minNotional` i estymowanej prowizji pobieranej w base asset. Bot śledzi i sprzedaje wyłącznie własny lot.
- Wynik zrealizowany jest liczony z rzeczywistych `execValue`, `execQty`, `execFee` i `feeCurrency`; ceny fill zawierają faktyczny wpływ spreadu i slippage. Bramka NETTO działa przed autonomicznym wyjściem.
- Dynamiczne TP i trailing zależą od reżimu i zmienności. Pierwszy TP jest zleceniem GTC na Bybit; trailing przed fallback SELL wymaga potwierdzonego anulowania zlecenia GTC.
- Brak automatycznej dźwigni (`isLeverage: 0`).
- Cleanup przy unmount zatrzymuje obie pętle; ref-guard blokuje podwójny start.

## Testy regresyjne

Dodano testy: niezależność Happy Hour/SMART, CORE lock dla wszystkich siedmiu symboli, reżim spadkowy bez BUY, ranking top 1–2, sizing bez dustu, fee w base asset, minNotional, bramka zysku NETTO, rezerwa kapitału i double-spend.

Status lokalny:

- lint: PASS (0 błędów; 4 wcześniejsze ostrzeżenia React hooks),
- TypeScript: PASS,
- Jest: PASS, 23/23,
- Expo Android prebuild: PASS,
- Gradle `assembleRelease`: BLOCKED na hoście — brak lokalnego JDK/Android SDK,
- APK: nie wygenerowano lokalnie. Workflow `.github/workflows/android-apk.yml` pozostaje przygotowany do budowy po pushu na GitHub Actions (Java 17 jest konfigurowana w pipeline).
