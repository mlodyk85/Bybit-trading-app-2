# Adaptive Trading Roadmap — build 146+

Ten dokument zapisuje uzgodniony kierunek rozwoju Bybit Trading App. Jest specyfikacją funkcjonalną i techniczną; funkcje oznaczone jako planowane nie są jeszcze deklarowane jako gotowe.

## 1. Cel

Aplikacja ma przejść z prostego Smart Auto opartego na stałych progach do wielorynkowego, adaptacyjnego silnika Spot/USDT. Silnik ma samodzielnie klasyfikować stan rynku jako BUY / HOLD / SELL / WAIT, wykonywać zlecenia tylko w trybie LIVE, zbierać dane do uczenia i wyjaśniać użytkownikowi przyczynę decyzji.

Nie zakładamy gwarantowanego zysku. Priorytety: poprawność wykonania zleceń, ochrona kapitału, mierzalność strategii i możliwość audytu decyzji.

## 2. Dane rynkowe

- Docelowo Bybit public WebSocket zamiast głównej pętli REST polling.
- Obserwacja wszystkich kwalifikujących się par Spot/USDT, bez twardej listy BTC/XRP/PEPE/VELO.
- Lekki skaner całego rynku: cena, bid/ask, spread, obrót/wolumen, momentum i zmienność.
- Głębsza analiza tylko aktywnych pozycji oraz najlepszych kandydatów.
- Event-driven processing po otrzymaniu danych. Nie obiecujemy milisekundowego wykonania zlecenia, ponieważ opóźnienie sieci/API/giełdy pozostaje zewnętrzne.

## 3. Niezależny bot per symbol

Każdy symbol posiada osobny stan. BTC może być WAIT/BUY, XRP HOLD, SOL SELL, a PEPE równolegle analizowany.

Stan per symbol powinien obejmować:
- phase: WAIT / BUY_CANDIDATE / HOLD / SELL_CANDIDATE / SELL_PENDING / WAIT_REBUY / BUY_PENDING;
- workingQty, cost/entry, reservedUsdt;
- localHigh, localLow, peak, momentum, volatility, spread;
- orderId i partial fills;
- liczbę cykli, wynik netto oraz ilość zakumulowanego coina;
- timestamp ostatnich danych i decyzji.

Cykl jednego symbolu nie może blokować pozostałych.

## 4. Dynamiczna decyzja BUY / HOLD / SELL / WAIT

Stałe progi procentowe nie powinny być głównym źródłem decyzji.

BUY:
- wykrycie spadku i lokalnego minimum;
- wyhamowanie spadku;
- potwierdzenie zmiany krótkiego momentum/odbicia;
- akceptowalny spread i płynność;
- oczekiwany ruch musi mieć sens po kosztach.

HOLD:
- trend/momentum nadal wspierają pozycję;
- lokalny peak jest aktualizowany;
- bot nie sprzedaje tylko dlatego, że osiągnięto pierwszy mały plus.

SELL:
- pozycja ma dodatnią ekonomię po kosztach albo obowiązuje jawny risk exit;
- lokalna górka/trailing peak i osłabienie momentum wskazują na cofnięcie;
- wielkość sprzedaży jest dokładnie związana z zarządzanym lotem.

WAIT:
- brak potwierdzenia;
- zbyt duży spread, słaba płynność, nieaktualne dane albo niekorzystna relacja koszt/ruch.

## 5. Smart Accumulation

Cel: zwiększanie ilości konkretnego coina poprzez cykl SELL -> niższy BUY.

- niezależny cykl dla każdego coina;
- po SELL uzyskane USDT są rezerwowane dla tego samego symbolu;
- rezerwa nie może zostać wykorzystana przez zwykły Smart Auto ani inny coin;
- podczas dalszego spadku bot czeka; BUY BACK następuje po wykryciu lokalnego dołka i odbicia;
- jeden zakończony SELL -> BUY = jeden cykl akumulacji;
- kapitał/ilość robocza ma osobny limit bezpieczeństwa. Limit kapitału nie jest sygnałem wejścia/wyjścia.

## 6. Capital & Risk Manager

Centralny moduł ma:
- uniemożliwiać double-spend USDT;
- pilnować maksymalnej ekspozycji i wartości pojedynczego zlecenia;
- uwzględniać reservedUsdt;
- blokować duplicate orders;
- obsługiwać timeout, reconnect i niepewny status zlecenia bez automatycznego ponowienia mogącego utworzyć duplikat;
- uwzględniać fee, spread i slippage w wyniku netto;
- rozliczać partial fills;
- nie sprzedawać przypadkowo całego wallet balance zamiast zarządzanego lotu.

## 7. Learning / AI

AI nie znajduje się na krytycznej ścieżce każdego ticka. Szybkie decyzje wykonuje lokalny silnik numeryczny; ML/AI jest warstwą scoringu, uczenia i adaptacji.

Dla każdej obserwacji/kandydata zapisujemy feature snapshot:
- symbol, timestamp, price/bid/ask/spread;
- turnover/volume;
- momentum na kilku horyzontach;
- volatility;
- localHigh/localLow i odległość od nich;
- stan pozycji i decyzję BUY/HOLD/SELL/WAIT.

Etykiety wyniku są uzupełniane po np. 5 s, 30 s, 1 min i 5 min: przyszły zwrot, MAE/MFE oraz wynik hipotetycznej transakcji po kosztach.

Model ma z czasem nauczyć się zachowania osobno dla różnych rynków i reżimów. Confidence wyświetlane użytkownikowi musi pochodzić z modelu/scoringu i być kalibrowane historycznymi wynikami — nie może być losową liczbą.

## 8. Shadow learning

Równolegle z LIVE silnik może symulować decyzje bez składania zleceń. Pozwala to zbierać znacznie więcej przykładów i porównywać strategie bez ryzykowania całym saldem.

Raport powinien rozdzielać LIVE i SHADOW.

## 9. Zakładka ANALIZA

Nowa zakładka ma być panelem decyzyjnym użytkownika, korzystającym z dokładnie tego samego market engine co bot.

Sekcje:
- Potencjalne dołki;
- Potencjalne górki;
- Trend / HOLD;
- WAIT / odrzucone kandydatury z przyczyną.

Karta symbolu:
- aktualna cena;
- lokalny high/low;
- momentum i volatility;
- spread/płynność;
- status BUY/HOLD/SELL/WAIT;
- confidence/scoring;
- krótkie wyjaśnienie, np. "spadek -> wyhamowanie -> odbicie" albo "momentum nadal dodatnie — HOLD";
- akcje: Obserwuj / Otwórz trading / Dodaj do Smart Auto.

## 10. Kalkulator scenariusza

Użytkownik może podać:
- kapitał i oczekiwany ruch %, albo
- oczekiwany zysk netto i zakładany ruch %.

Aplikacja pokazuje:
- wymagany kapitał;
- wynik brutto;
- szacowane fee wejścia/wyjścia;
- spread/slippage estimate;
- wynik netto.

Podstawowa matematyka brutto:
profitGross = capital * movePct / 100
capitalForGrossTarget = targetProfit / (movePct / 100)

Wynik netto zawsze musi uwzględniać koszty; kalkulator nie może przedstawiać hipotetycznego wyniku jako gwarancji.

## 11. Background reliability

Docelowo silnik LIVE nie powinien zależeć od otwartego ekranu React Native.

Android:
- Foreground Service z trwałą notyfikacją;
- reconnect po utracie sieci;
- zapis/odtworzenie stanu botów i pending orders;
- ochrona przed podwójnym wykonaniem po restarcie;
- opcjonalny BOOT_COMPLETED po jawnej konfiguracji.

Alternatywa o najwyższej niezawodności: backend/VPS utrzymujący market engine i execution 24/7, a telefon jako panel sterowania. Wymaga to osobnej infrastruktury i bezpiecznego zarządzania kluczami.

## 12. Kolejność implementacji

1. Stabilizacja build 146: niezależne cykle per symbol i rezerwacja kapitału.
2. Usunięcie stale-closure i blokad globalnych.
3. Market data service/WebSocket + reconnect.
4. Per-symbol state machine i dynamiczny scoring BUY/HOLD/SELL/WAIT.
5. Fee/spread/slippage-aware execution i bezpieczne śledzenie lotów.
6. ANALIZA + kalkulator scenariusza.
7. Telemetria learning dataset + shadow outcomes.
8. Model ML/scoring i kalibracja confidence.
9. Foreground Service / persistence; później opcjonalny backend 24/7.
10. Testy paper/shadow, mały limit LIVE, dopiero potem stopniowe zwiększanie ekspozycji.

## 13. Kryteria jakości

- jeden coin nie blokuje drugiego;
- aktywny reservedUsdt nie jest wydawany przez inne strategie;
- brak duplicate orders;
- decyzja ma zapisane dane wejściowe i powód;
- UI pokazuje faktyczny stan silnika;
- statystyki raportują wynik po kosztach;
- LIVE i SHADOW są jednoznacznie rozdzielone;
- po restarcie stan zleceń jest rekoncyliowany z Bybit przed dalszym handlem;
- build/release jest uznany za gotowy dopiero po przejściu typecheck/test/build.
