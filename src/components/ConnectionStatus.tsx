import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from '../api/types';

interface ConnectionStatusProps {
  state: ConnectionState;
  errorMessage?: string | null;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ state, errorMessage }) => {
  let statusText = 'Niezalogowany';
  let badgeColor = '#757575';
  let backgroundColor = '#1E1E1E';

  switch (state) {
    case 'connected':
      statusText = 'Połączono z Bybit (Klucz API Aktywny)';
      badgeColor = '#00E676';
      backgroundColor = '#102A1A';
      break;
    case 'connecting':
      statusText = 'Łączenie z Bybit...';
      badgeColor = '#FFC107';
      backgroundColor = '#2A2410';
      break;
    case 'error':
      statusText = 'Błąd połączenia / Autoryzacji';
      badgeColor = '#FF5252';
      backgroundColor = '#2A1010';
      break;
    case 'disconnected':
      statusText = 'Brak zapisanego klucza API';
      badgeColor = '#FF9800';
      backgroundColor = '#2A1A10';
      break;
  }

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: badgeColor }]} />
        <Text style={styles.statusText}>{statusText}</Text>
      </View>
      {state === 'error' && errorMessage && (
        <Text style={styles.errorDetailText}>{errorMessage}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#333333',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  errorDetailText: {
    color: '#FF8A80',
    fontSize: 12,
    marginTop: 4,
  },
});
