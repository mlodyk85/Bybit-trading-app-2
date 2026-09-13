import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ABSOLUTE_MAX_SPOT_ORDER_USDT } from '../api/bybit';
import { ApiCredentials, ConnectionState } from '../api/types';
import { AutoRefreshInterval } from '../hooks/useBybitAccount';

interface SettingsScreenProps {
  credentials: ApiCredentials | null;
  connectionState: ConnectionState;
  autoRefreshInterval: AutoRefreshInterval;
  maxOrderUsdt: number;
  onSetAutoRefreshInterval: (interval: AutoRefreshInterval) => void;
  onSetMaxOrderUsdt: (limit: number) => Promise<void>;
  onUpdateCredentials: (apiKey: string, apiSecret: string) => Promise<boolean>;
  onTestConnection: (apiKey: string, apiSecret: string) => Promise<{ success: boolean; message: string }>;
  onDisconnect: () => Promise<void>;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  credentials,
  connectionState,
  autoRefreshInterval,
  maxOrderUsdt,
  onSetAutoRefreshInterval,
  onSetMaxOrderUsdt,
  onUpdateCredentials,
  onTestConnection,
  onDisconnect,
}) => {
  const [apiKey, setApiKey] = useState<string>(credentials?.apiKey || '');
  const [apiSecret, setApiSecret] = useState<string>(credentials?.apiSecret || '');
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [orderLimitText, setOrderLimitText] = useState(String(maxOrderUsdt));

  useEffect(() => setOrderLimitText(String(maxOrderUsdt)), [maxOrderUsdt]);

  const handleUpdate = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      Alert.alert('Błąd', 'Wprowadź klucz API Key oraz API Secret.');
      return;
    }
    setIsUpdating(true);
    const success = await onUpdateCredentials(apiKey, apiSecret);
    setIsUpdating(false);

    if (success) Alert.alert('Sukces', 'Klucze API zostały pomyślnie zaktualizowane.');
    else Alert.alert('Błąd', 'Nie udało się połączyć przy użyciu podanych kluczy.');
  };

  const handleTest = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      Alert.alert('Błąd', 'Wprowadź klucz API Key oraz API Secret.');
      return;
    }
    setIsTesting(true);
    const result = await onTestConnection(apiKey, apiSecret);
    setIsTesting(false);
    Alert.alert(result.success ? 'Sukces' : 'Błąd testu', result.message);
  };

  const saveOrderLimit = () => {
    const value = Number(orderLimitText.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > ABSOLUTE_MAX_SPOT_ORDER_USDT) {
      Alert.alert('Nieprawidłowy limit', `Podaj wartość większą od 0 i maksymalnie ${ABSOLUTE_MAX_SPOT_ORDER_USDT} USDT.`);
      return;
    }
    Alert.alert(
      'Zmiana limitu transakcji',
      `Ustawiasz maksymalną wartość pojedynczego zlecenia Spot na ${value.toFixed(2)} USDT. Wyższy limit oznacza większą możliwą stratę przy błędnym sygnale, poślizgu lub gwałtownym ruchu rynku.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Rozumiem ryzyko — zapisz',
          style: 'destructive',
          onPress: async () => {
            await onSetMaxOrderUsdt(value);
            Alert.alert('Zapisano', `Limit pojedynczej transakcji: ${value.toFixed(2)} USDT.`);
          },
        },
      ]
    );
  };

  const handleRemoveData = () => {
    Alert.alert(
      'Usuń dane API',
      'Czy na pewno chcesz usunąć zapisaną konfigurację klucza API? Dane zostaną trwale wyczyszczone z pamięci urządzenia.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            await onDisconnect();
            Alert.alert('Wyczyszczono', 'Dane API zostały usunięte.');
          },
        },
      ]
    );
  };

  const intervals: AutoRefreshInterval[] = [15, 30, 60];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.headerTitle}>Ustawienia</Text>

      <View style={styles.readOnlyBanner}>
        <Text style={styles.readOnlyBadge}>SPOT TRADING MODE</Text>
        <Text style={styles.readOnlyText}>
          Klucz API może mieć uprawnienie Spot Trade. Withdrawal/Wypłaty pozostaw wyłączone. Aktualny limit pojedynczego zlecenia: {maxOrderUsdt.toFixed(2)} USDT.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Limit pojedynczej transakcji Spot</Text>
        <Text style={styles.riskText}>
          Domyślnie 10 USDT. Zwiększaj tylko świadomie — Smart Auto i ręczne BUY używają tego samego limitu bezpieczeństwa.
        </Text>
        <TextInput
          style={styles.input}
          value={orderLimitText}
          onChangeText={setOrderLimitText}
          keyboardType="decimal-pad"
          placeholder="np. 10"
          placeholderTextColor="#666666"
        />
        <TouchableOpacity style={styles.limitButton} onPress={saveOrderLimit}>
          <Text style={styles.limitButtonText}>Zapisz limit z potwierdzeniem ryzyka</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status Połączenia API</Text>
        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>Stan:</Text>
          <Text style={[styles.statusValue, { color: connectionState === 'connected' ? '#00E676' : '#FF5252' }]}>
            {connectionState === 'connected' ? 'Aktywne i Autoryzowane' : connectionState === 'connecting' ? 'Łączenie...' : 'Błąd połączenia'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Częstotliwość Auto-Refresh</Text>
        <View style={styles.intervalRow}>
          {intervals.map((sec) => (
            <TouchableOpacity
              key={sec}
              style={[styles.intervalOption, autoRefreshInterval === sec && styles.intervalOptionSelected]}
              onPress={() => onSetAutoRefreshInterval(sec)}
            >
              <Text style={[styles.intervalOptionText, autoRefreshInterval === sec && styles.intervalOptionTextSelected]}>{sec} sec</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Edycja Klucza API</Text>
        <Text style={styles.inputLabel}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} placeholder="Nowy API Key" placeholderTextColor="#666666" />

        <Text style={styles.inputLabel}>API Secret</Text>
        <View style={styles.secretContainer}>
          <TextInput style={styles.secretInput} value={apiSecret} onChangeText={setApiSecret} secureTextEntry={!showSecret} autoCapitalize="none" autoCorrect={false} placeholder="Nowy API Secret" placeholderTextColor="#666666" />
          <TouchableOpacity style={styles.toggleSecretButton} onPress={() => setShowSecret(!showSecret)}>
            <Text style={styles.toggleSecretText}>{showSecret ? 'Ukryj' : 'Pokaż'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.saveButton, isUpdating && styles.disabledButton]} onPress={handleUpdate} disabled={isUpdating || isTesting}>
            {isUpdating ? <ActivityIndicator color="#000000" /> : <Text style={styles.saveButtonText}>Zapisz Zmiany</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.testButton, isTesting && styles.disabledButton]} onPress={handleTest} disabled={isUpdating || isTesting}>
            {isTesting ? <ActivityIndicator color="#F0B90B" /> : <Text style={styles.testButtonText}>Testuj</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.section, styles.dangerSection]}>
        <Text style={styles.dangerTitle}>Strefa Bezpieczeństwa</Text>
        <Text style={styles.dangerDescription}>
          Usunięcie danych API wyloguje aplikację i wyczyści zapisany klucz oraz secret z bezpiecznego magazynu pamięci (Expo SecureStore).
        </Text>
        <TouchableOpacity style={styles.deleteButton} onPress={handleRemoveData}>
          <Text style={styles.deleteButtonText}>Usuń dane API</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  contentContainer: { padding: 16, paddingBottom: 40 },
  headerTitle: { color: '#F0B90B', fontSize: 24, fontWeight: '800', marginVertical: 12 },
  readOnlyBanner: { backgroundColor: '#1A2A1A', borderWidth: 1, borderColor: '#00E676', borderRadius: 8, padding: 12, marginBottom: 20 },
  readOnlyBadge: { color: '#00E676', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  readOnlyText: { color: '#CCCCCC', fontSize: 12, lineHeight: 18 },
  section: { backgroundColor: '#1E1E1E', borderRadius: 10, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#2C2C2C' },
  sectionTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  riskText: { color: '#F0B90B', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  statusBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  statusLabel: { color: '#AAAAAA', fontSize: 14 },
  statusValue: { fontSize: 14, fontWeight: '700' },
  intervalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  intervalOption: { flex: 1, paddingVertical: 10, backgroundColor: '#121212', borderWidth: 1, borderColor: '#333333', borderRadius: 6, alignItems: 'center', marginHorizontal: 4 },
  intervalOptionSelected: { backgroundColor: '#F0B90B', borderColor: '#F0B90B' },
  intervalOptionText: { color: '#CCCCCC', fontSize: 13, fontWeight: '600' },
  intervalOptionTextSelected: { color: '#000000', fontWeight: '700' },
  inputLabel: { color: '#CCCCCC', fontSize: 13, marginBottom: 4, marginTop: 8 },
  input: { backgroundColor: '#121212', borderWidth: 1, borderColor: '#333333', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, color: '#FFFFFF', fontSize: 13 },
  limitButton: { backgroundColor: '#F0B90B', borderRadius: 6, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  limitButtonText: { color: '#000000', fontSize: 13, fontWeight: '800' },
  secretContainer: { flexDirection: 'row', backgroundColor: '#121212', borderWidth: 1, borderColor: '#333333', borderRadius: 6, alignItems: 'center' },
  secretInput: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, color: '#FFFFFF', fontSize: 13 },
  toggleSecretButton: { paddingHorizontal: 12, paddingVertical: 10 },
  toggleSecretText: { color: '#F0B90B', fontSize: 12, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  saveButton: { flex: 2, backgroundColor: '#F0B90B', borderRadius: 6, paddingVertical: 12, alignItems: 'center', marginRight: 8 },
  saveButtonText: { color: '#000000', fontSize: 14, fontWeight: '700' },
  testButton: { flex: 1, borderWidth: 1, borderColor: '#F0B90B', borderRadius: 6, paddingVertical: 12, alignItems: 'center' },
  testButtonText: { color: '#F0B90B', fontSize: 14, fontWeight: '600' },
  dangerSection: { borderColor: '#FF5252', backgroundColor: '#221010' },
  dangerTitle: { color: '#FF5252', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  dangerDescription: { color: '#FFA8A8', fontSize: 12, lineHeight: 16, marginBottom: 14 },
  deleteButton: { backgroundColor: '#FF5252', borderRadius: 6, paddingVertical: 12, alignItems: 'center' },
  deleteButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
});
