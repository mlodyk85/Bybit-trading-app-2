import { StatusBar } from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AppUpdater } from './src/update/AppUpdater';
import { APP_BUILD, APP_VERSION } from './src/version';

export { APP_BUILD, APP_VERSION } from './src/version';

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [authMessage, setAuthMessage] = useState('Sprawdzam zabezpieczenia urządzenia…');
  const [authBusy, setAuthBusy] = useState(true);

  const authenticate = async () => {
    setAuthBusy(true);
    try {
      const [hardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hardware || !enrolled) {
        setAuthMessage('Biometria nie jest skonfigurowana na tym urządzeniu.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Odblokuj Bybit Trading',
        cancelLabel: 'Anuluj',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setUnlocked(true);
        setAuthMessage('');
      } else {
        setAuthMessage('Aplikacja pozostaje zablokowana.');
      }
    } catch {
      setAuthMessage('Nie udało się uruchomić uwierzytelniania.');
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => { void authenticate(); }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style="light" backgroundColor="#121212" />
        <View style={styles.versionBar}>
          <Text style={styles.versionText}>Bybit Trading • v{APP_VERSION} • build {APP_BUILD}</Text>
        </View>
        <View style={styles.appBody}>
          {unlocked ? <AppNavigator /> : (
            <View style={styles.lock}>
              <Text style={styles.lockTitle}>Bybit Trading</Text>
              <Text style={styles.lockText}>{authMessage}</Text>
              {authBusy
                ? <ActivityIndicator />
                : <TouchableOpacity style={styles.unlockButton} onPress={() => void authenticate()}><Text style={styles.unlockText}>ODBLOKUJ BIOMETRIĄ</Text></TouchableOpacity>}
            </View>
          )}
        </View>
        {unlocked && <AppUpdater currentVersion={APP_VERSION} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  versionBar: { height: 28, justifyContent: 'center', alignItems: 'center', backgroundColor: '#181818', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2C2C2C' },
  versionText: { color: '#8E8E93', fontSize: 11, fontWeight: '600' },
  appBody: { flex: 1 },
  lock: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  lockTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', marginBottom: 12 },
  lockText: { color: '#A1A1AA', fontSize: 14, textAlign: 'center', marginBottom: 22 },
  unlockButton: { backgroundColor: '#F0B90B', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 14 },
  unlockText: { color: '#111111', fontWeight: '800' },
});
