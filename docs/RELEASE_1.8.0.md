# Bybit Trading App 1.8.0 (build 180)

## AI Strategy Advisor — Shadow Evaluation

Build 180 dodaje opcjonalną warstwę AI oceniającą kandydatów Adaptive Trading Engine. Integracja jest celowo ograniczona do trybu SHADOW: odpowiedź AI jest wyświetlana i zapisywana do późniejszej ewaluacji, ale nie może utworzyć, zmienić ani anulować zlecenia.

### Bezpieczeństwo

- Aplikacja nie przechowuje klucza OpenAI. Użytkownik konfiguruje wyłącznie HTTPS endpoint własnego backendu.
- Backend powinien przechowywać `OPENAI_API_KEY` jako sekret środowiskowy i używać Responses API ze Structured Outputs.
- Do backendu trafiają tylko zagregowane cechy rynku; klucze Bybit nie są wysyłane.
- Odpowiedź jest walidowana: decyzja, confidence, mnożniki ściśle ograniczone do bezpiecznych zakresów i TTL 1–300 s.
- Timeout, błąd HTTP lub niepoprawny JSON daje brak opinii AI i nie zatrzymuje lokalnej pętli.
- CORE jest odrzucany przed requestem AI.
- Build 180 ma programową blokadę `aiAdviceCanAuthorizeLiveTrade() === false`.

### Zakres danych SHADOW

Symbol, reżim, strategia, cena, spread, momentum, obrót, zmienność, szacowany koszt round-trip, liczba pozycji i wolny kapitał po rezerwie. Dziennik jest ograniczony do 250 ostatnich rekordów w SecureStore.

### Następny etap

Po zebraniu wystarczającej próbki należy uzupełnić rekordy o wyniki 1/5/15 min i porównać AI z lokalnym silnikiem: precision zyskownych sygnałów po kosztach, średni wynik NETTO, MAE/MFE oraz drawdown. Dopiero dodatni wynik walk-forward może uzasadnić tryb AI VETO; bezpośredni AI BUY pozostaje poza buildem 180.
