import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface SetupScreenProps {
  onConnect: (apiKey: string, apiSecret: string, remember: boolean) => Promise<boolean>;
  onTest: (apiKey: string, apiSecret: string) => Promise<{ success: boolean; message: string }>;
  initialApiKey?: string;
  initialApiSecret?: string;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({
  onConnect,
  onTest,
  initialApiKey = '',
  initialApiSecret = '',
}) => {
  const [apiKey, setApiKey] = useState<string>(initialApiKey);
  const [apiSecret, setApiSecret] = useState<string>(initialApiSecret);
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [remember, setRemember] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);

  const handleConnect = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      Alert.alert('Błąd', 'Wprowadź klucz API Key oraz API Secret.');
      return;
    }

    setIsSubmitting(true);
    const success = await onConnect(apiKey, apiSecret, remember);
    setIsSubmitting(false);

    if (!success) {
      Alert.alert('Błąd połączenia', 'Nie udało się połączyć. Sprawdź klucze API i uprawnienia.');
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      Alert.alert('Błąd', 'Wprowadź klucz API Key oraz API Secret przed testem.');
      return;
    }

    setIsTesting(true);
    const result = await onTest(apiKey, apiSecret);
    setIsTesting(false);

    Alert.alert(result.success ? 'Sukces' : 'Błąd testu', result.message);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.headerContainer}>
        <Text style={styles.title}>Bybit Portfolio</Text>
        <Text style={styles.subtitle}>Konfiguracja połączenia API V5</Text>
      </View>

      <View style={styles.warningBox}>
        <Text style={styles.warningTitle}>BEZPIECZEŃSTWO KLUCZY API</Text>
        <Text style={styles.warningText}>
          Do handlu włącz wyłącznie uprawnienie Spot Trade.{'\n'}
          Withdrawal/Wypłaty pozostaw wyłączone.{'\n'}
          Nie udostępniaj klucza API ani secretu innym osobom.
        </Text>
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          placeholder="Wprowadź Bybit API Key"
          placeholderTextColor="#666666"
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>API Secret</Text>
        <View style={styles.secretInputContainer}>
          <TextInput
            style={styles.secretInput}
            placeholder="Wprowadź Bybit API Secret"
            placeholderTextColor="#666666"
            value={apiSecret}
            onChangeText={setApiSecret}
            secureTextEntry={!showSecret}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.toggleSecretButton}
            onPress={() => setShowSecret(!showSecret)}
          >
            <Text style={styles.toggleSecretText}>{showSecret ? 'Ukryj' : 'Pokaż'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Pamiętaj dane na tym urządzeniu</Text>
        <Switch
          value={remember}
          onValueChange={setRemember}
          trackColor={{ false: '#333333', true: '#F0B90B' }}
          thumbColor={remember ? '#FFFFFF' : '#888888'}
        />
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, isSubmitting && styles.disabledButton]}
        onPress={handleConnect}
        disabled={isSubmitting || isTesting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#000000" />
        ) : (
          <Text style={styles.primaryButtonText}>Połącz</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.secondaryButton, isTesting && styles.disabledButton]}
        onPress={handleTestConnection}
        disabled={isSubmitting || isTesting}
      >
        {isTesting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.secondaryButtonText}>Testuj połączenie</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  contentContainer: {
    padding: 20,
    justifyContent: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginVertical: 24,
  },
  title: {
    color: '#F0B90B',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 14,
    marginTop: 4,
  },
  warningBox: {
    backgroundColor: '#2A1F10',
    borderWidth: 1,
    borderColor: '#FF9800',
    borderRadius: 8,
    padding: 14,
    marginBottom: 24,
  },
  warningTitle: {
    color: '#FF9800',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  warningText: {
    color: '#FFE0B2',
    fontSize: 13,
    lineHeight: 18,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    color: '#CCCCCC',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  secretInputContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 8,
    alignItems: 'center',
  },
  secretInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  toggleSecretButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleSecretText: {
    color: '#F0B90B',
    fontSize: 13,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 16,
  },
  switchLabel: {
    color: '#CCCCCC',
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#F0B90B',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#F0B90B',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: '#F0B90B',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
