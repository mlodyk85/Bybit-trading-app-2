import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AppUpdater } from './src/update/AppUpdater';

export const APP_VERSION = '1.3.1';
export const APP_BUILD = 131;

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style="light" backgroundColor="#121212" />
        <View style={styles.versionBar}>
          <Text style={styles.versionText}>Bybit Trading • v{APP_VERSION} • build {APP_BUILD}</Text>
        </View>
        <View style={styles.appBody}>
          <AppNavigator />
        </View>
        <AppUpdater currentVersion={APP_VERSION} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  versionBar: { height: 28, justifyContent: 'center', alignItems: 'center', backgroundColor: '#181818', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2C2C2C' },
  versionText: { color: '#8E8E93', fontSize: 11, fontWeight: '600' },
  appBody: { flex: 1 },
});
