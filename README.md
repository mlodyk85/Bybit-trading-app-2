# Bybit Trading App (Android Portfolio Monitor)

Aplikacja mobilna na system Android do bieżącego monitorowania konta Bybit **Unified Trading Account (UTA)**. Łączy się bezpośrednio z oficjalnym interfejsem **Bybit API V5** bez żadnych serwerów pośredniczących ani backendu.

---

## 🔒 1. Bezpieczeństwo i Zasady Działania

- **100% READ-ONLY (Tylko do odczytu):** Pierwsza wersja (V1) służy wyłącznie do podglądu stanu konta. Aplikacja **nie zawiera** możliwości składania ani modyfikacji zleceń, zamykania pozycji, wypłat (withdrawals) ani transferów środków.
- **Bezpieczny Magazyn (Expo SecureStore):** API Key oraz API Secret są szyfrowane i przechowywane wyłącznie lokalnie w bezpiecznym magazynie urządzenia (`Expo SecureStore`).
- **Zero Logów i Sekretów:** Klucze API nigdy nie trafiają do logów, komunikatów o błędach, repozytorium git ani zewnętrznych usług analitycznych.
- **Komunikacja Bezpośrednia:** Telefon komunikuje się bezpośrednio z oficjalnymi serwerami Bybit (`https://api.bybit.com`). Brak pośredniczących serwerów.
- **Przycisk "Usuń dane API":** Pozwala w dowolnym momencie natychmiastowo i trwale usunąć klucze API z pamięci telefonu i wyczyścić stan aplikacji.

---

## 🔑 2. Jak utworzyć klucz Bybit API (Read-Only)

1. Zaloguj się na swoje konto na stronie [Bybit.com](https://www.bybit.com).
2. Przejdź do profilu użytkownika i wybierz zakładkę **API**.
3. Kliknij **Create New Key** (Utwórz nowy klucz) i wybierz **System-generated API Keys**.
4. Wybierz typ klucza: **API Transaction**.
5. Nadaj nazwę kluczowi (np. `Android Portfolio Monitor`).
6. W sekcji **API Key Permissions** (Uprawnienia):
   - Wybierz opcję **Read-Only** (Tylko do odczytu).
7. ⚠️ **BARDZO WAŻNE:**
   - **NIE WŁĄCZAJ** opcji **Withdrawal** (Wypłaty).
   - **NIE WŁĄCZAJ** uprawnień do tradingu ani transferów.
8. Zatwierdź tworzenie klucza kodem 2FA.
9. Skopiuj wygenerowany **API Key** oraz **API Secret** i wpisz je w aplikacji na telefonie.

---

## 📱 3. Funkcje Aplikacji

- **Konto Unified Trading Account (UTA):**
  - Total Equity (Suma aktywów w USD)
  - Wallet Balance (Saldo portfela)
  - Available Balance (Dostępne saldo)
  - Unrealized PnL (Niezrealizowany zysk/strata)
- **Aktywa na koncie (Assets):**
  - Lista wszystkich coinów na koncie z saldem wallet balance, equity i dostępną ilością.
  - Automatyczne ukrywanie aktywów z zerowym saldem.
- **Otwarte Pozycje (Open Positions):**
  - Pozycje **Linear** (USDT Perpetual) oraz **Inverse**.
  - Wskaźnik kierunku **LONG** (zielona etykieta) / **SHORT** (czerwona etykieta).
  - Dźwignia (Leverage), Rozmiar (Size), Cena wejścia (Entry), Mark Price, Niezrealizowany PnL.
  - Ceny Liquidation, Take Profit (TP) oraz Stop Loss (SL).
- **Auto-Refresh & Status:**
  - Status połączenia i czytelne komunikaty błędów po polsku.
  - Ręczne odświeżanie oraz auto-refresh co 15, 30 lub 60 sekund.
  - Ciemny motyw (Dark Theme).

---

## 💻 4. Uruchamianie Projektu Lokalnie

### Wymagania:
- Node.js >= 20.x
- npm >= 10.x

### Instrukcja:
```bash
# 1. Klonowanie repozytorium
git clone https://github.com/mlodyk85/Bybit-trading-app-2.git
cd Bybit-trading-app-2

# 2. Instalacja zależności
npm ci

# 3. Uruchomienie weryfikacji kodu (Lint, Typecheck, Testy)
npm run lint
npm run typecheck
npm test

# 4. Uruchomienie Expo w trybie deweloperskim
npm start
```

---

## 📦 5. Budowanie Pliku Instalacyjnego APK

### Opcja A: Automatyczny Build w GitHub Actions (Zalecane)
Projekt posiada skonfigurowany workflow w `.github/workflows/android-apk.yml`. Przy każdym wciśnięciu (push) do gałęzi `main`:
1. Uruchamiają się testy jednostkowe, linter oraz sprawdzanie typów TypeScript.
2. Generowany jest natywny projekt Android i kompilowany jest gotowy plik **`bybit-trading-app.apk`**.

#### Gdzie znaleźć plik APK na GitHubie:
1. Wejdź na stronę repozytorium na GitHubie: `https://github.com/mlodyk85/Bybit-trading-app-2`.
2. Kliknij zakładkę **Actions** na samej górze.
3. Kliknij w najnowszy wykonany workflow **Build Android APK**.
4. Na dole strony w sekcji **Artifacts** znajdziesz plik do pobrania: **`bybit-trading-app-apk`**.
5. Rozpakuj pobrane archiwum ZIP - w środku znajduje się plik `bybit-trading-app.apk`, który możesz zainstalować bezpośrednio na telefonie Android.

---

### Opcja B: Budowanie przez Expo EAS CLI
Projekt zawiera plik `eas.json` z profilem `preview` nastawionym na generowanie pliku APK (`buildType: "apk"`).

1. Zainstaluj EAS CLI:
   ```bash
   npm install -g eas-cli
   ```
2. Zaloguj się do swojego konta Expo:
   ```bash
   eas login
   ```
3. Uruchom budowanie APK:
   ```bash
   eas build --platform android --profile preview
   ```

#### Konfiguracja tokenu Expo w GitHub Actions (Opcjonalnie):
Jeśli chcesz używać `eas build` bezpośrednio w GitHub Actions:
1. Zaloguj się na [expo.dev](https://expo.dev), przejdź do **Account Settings** -> **Access Tokens**.
2. Stwórz nowy token i skopiuj jego wartość.
3. W swoim repozytorium GitHub wejdź w **Settings** -> **Secrets and variables** -> **Actions**.
4. Dodaj nowy sekret o nazwie `EXPO_TOKEN` i wklej wartość tokena z Expo.

---

## 🧪 6. Testy Jednostkowe

Aplikacja zawiera pełne testy jednostkowe obejmujące:
- Generowanie i sortowanie parametrów w Query String dla API V5.
- Poprawność generowania podpisu HMAC-SHA256 dla Bybit.
- Formowanie kwot, dynamiczną precyzję krypto oraz znaki zysków/strat (+ / -).
- Filtrowanie i ukrywanie tokenów z zerowym saldem.

Uruchamianie testów:
```bash
npm test
```

---

## 📜 Licencja
MIT - Projekt przeznaczony do użytku prywatnego. Używasz na własną odpowiedzialność.