import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { MAX_SPOT_ORDER_USDT } from '../api/bybit';
import { AssetSmartAutoSeed } from '../components/AssetRow';
import { useBybitAccount } from '../hooks/useBybitAccount';
import { PortfolioScreen } from '../screens/PortfolioScreen';
import { PositionsScreen } from '../screens/PositionsScreen';
import { ReportScreen } from '../screens/ReportScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { SmartScoreScreen } from '../screens/SmartScoreScreen';
import { TradeScreen } from '../screens/TradeScreen';
import { loadMaxOrderUsdt, saveMaxOrderUsdt } from '../services/tradingPreferences';

const Tab = createBottomTabNavigator();

export const AppNavigator: React.FC = () => {
  const [selectedTradeSymbol, setSelectedTradeSymbol] = useState('BTCUSDT');
  const [smartSeed, setSmartSeed] = useState<AssetSmartAutoSeed | null>(null);
  const [maxOrderUsdt, setMaxOrderUsdt] = useState(MAX_SPOT_ORDER_USDT);
  const {
    credentials, account, positions, connectionState, errorMessage, isLoading, isRefreshing,
    lastRefreshTime, autoRefreshEnabled, autoRefreshInterval, setAutoRefreshEnabled,
    setAutoRefreshInterval, connect, testConnection, disconnect, refresh,
  } = useBybitAccount();

  useEffect(() => {
    let mounted = true;
    void loadMaxOrderUsdt().then((value) => { if (mounted) setMaxOrderUsdt(value); });
    return () => { mounted = false; };
  }, []);

  const updateMaxOrder = async (value: number) => {
    const saved = await saveMaxOrderUsdt(value);
    setMaxOrderUsdt(saved);
  };

  if (isLoading && !credentials) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#F0B90B" /><Text style={styles.loadingText}>Ładowanie aplikacji...</Text></View>;
  }

  if (!credentials || connectionState === 'disconnected') {
    return <SetupScreen onConnect={connect} onTest={testConnection} initialApiKey={credentials?.apiKey || ''} initialApiSecret={credentials?.apiSecret || ''} />;
  }

  return (
    <NavigationContainer theme={{ dark: true, colors: { primary: '#F0B90B', background: '#121212', card: '#1E1E1E', text: '#FFFFFF', border: '#2C2C2C', notification: '#F0B90B' } }}>
      <Tab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { backgroundColor: '#1E1E1E', borderTopColor: '#2C2C2C', height: 62, paddingBottom: 7, paddingTop: 6 }, tabBarActiveTintColor: '#F0B90B', tabBarInactiveTintColor: '#8E8E93', tabBarLabelStyle: { fontSize: 9, fontWeight: '600' } }}>
        <Tab.Screen name="Portfolio" options={{ tabBarLabel: 'Portfel', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>📊</Text> }}>
          {({ navigation }) => <PortfolioScreen credentials={credentials} account={account} connectionState={connectionState} errorMessage={errorMessage} isRefreshing={isRefreshing} lastRefreshTime={lastRefreshTime} autoRefreshEnabled={autoRefreshEnabled} onRefresh={refresh} onToggleAutoRefresh={setAutoRefreshEnabled} onOpenSmartAuto={(seed) => { setSelectedTradeSymbol(seed.symbol); setSmartSeed(seed); navigation.navigate('Trade'); }} />}
        </Tab.Screen>
        <Tab.Screen name="Positions" options={{ tabBarLabel: 'Pozycje', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>📈</Text> }}>{() => <PositionsScreen positions={positions} account={account} isRefreshing={isRefreshing} onRefresh={refresh} />}</Tab.Screen>
        <Tab.Screen name="Trade" options={{ tabBarLabel: 'Trade', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>⚡</Text> }}>{() => <TradeScreen credentials={credentials} initialSymbol={selectedTradeSymbol} initialHolding={smartSeed} maxOrderUsdt={maxOrderUsdt} onHoldingConsumed={() => setSmartSeed(null)} />}</Tab.Screen>
        <Tab.Screen name="Score" options={{ tabBarLabel: 'Score', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>🎯</Text> }}>{({ navigation }) => <SmartScoreScreen onUseSymbol={(nextSymbol) => { setSelectedTradeSymbol(nextSymbol); setSmartSeed(null); navigation.navigate('Trade'); }} />}</Tab.Screen>
        <Tab.Screen name="Report" options={{ tabBarLabel: 'Raport', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>🧾</Text> }}>{() => <ReportScreen credentials={credentials} />}</Tab.Screen>
        <Tab.Screen name="Settings" options={{ tabBarLabel: 'Ustaw.', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 17 }}>⚙️</Text> }}>{() => <SettingsScreen credentials={credentials} connectionState={connectionState} autoRefreshInterval={autoRefreshInterval} maxOrderUsdt={maxOrderUsdt} onSetAutoRefreshInterval={setAutoRefreshInterval} onSetMaxOrderUsdt={updateMaxOrder} onUpdateCredentials={async (key, secret) => await connect(key, secret, true)} onTestConnection={testConnection} onDisconnect={disconnect} />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({ loadingContainer: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' }, loadingText: { color: '#8E8E93', fontSize: 14, marginTop: 12 } });
