import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useBybitAccount } from '../hooks/useBybitAccount';
import { PortfolioScreen } from '../screens/PortfolioScreen';
import { PositionsScreen } from '../screens/PositionsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SetupScreen } from '../screens/SetupScreen';

const Tab = createBottomTabNavigator();

export const AppNavigator: React.FC = () => {
  const {
    credentials,
    account,
    positions,
    connectionState,
    errorMessage,
    isLoading,
    isRefreshing,
    lastRefreshTime,
    autoRefreshEnabled,
    autoRefreshInterval,
    setAutoRefreshEnabled,
    setAutoRefreshInterval,
    connect,
    testConnection,
    disconnect,
    refresh,
  } = useBybitAccount();

  if (isLoading && !credentials) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F0B90B" />
        <Text style={styles.loadingText}>Ładowanie aplikacji...</Text>
      </View>
    );
  }

  // If no credentials saved or state is disconnected, show Setup Screen
  if (!credentials || connectionState === 'disconnected') {
    return (
      <SetupScreen
        onConnect={connect}
        onTest={testConnection}
        initialApiKey={credentials?.apiKey || ''}
        initialApiSecret={credentials?.apiSecret || ''}
      />
    );
  }

  return (
    <NavigationContainer
      theme={{
        dark: true,
        colors: {
          primary: '#F0B90B',
          background: '#121212',
          card: '#1E1E1E',
          text: '#FFFFFF',
          border: '#2C2C2C',
          notification: '#F0B90B',
        },
      }}
    >
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#1E1E1E',
            borderTopColor: '#2C2C2C',
            height: 60,
            paddingBottom: 8,
            paddingTop: 8,
          },
          tabBarActiveTintColor: '#F0B90B',
          tabBarInactiveTintColor: '#8E8E93',
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
          },
        }}
      >
        <Tab.Screen
          name="Portfolio"
          options={{
            tabBarLabel: 'Portfolio',
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📊</Text>,
          }}
        >
          {() => (
            <PortfolioScreen
              account={account}
              connectionState={connectionState}
              errorMessage={errorMessage}
              isRefreshing={isRefreshing}
              lastRefreshTime={lastRefreshTime}
              autoRefreshEnabled={autoRefreshEnabled}
              onRefresh={refresh}
              onToggleAutoRefresh={setAutoRefreshEnabled}
            />
          )}
        </Tab.Screen>

        <Tab.Screen
          name="Positions"
          options={{
            tabBarLabel: 'Pozycje',
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📈</Text>,
          }}
        >
          {() => (
            <PositionsScreen
              positions={positions}
              isRefreshing={isRefreshing}
              onRefresh={refresh}
            />
          )}
        </Tab.Screen>

        <Tab.Screen
          name="Settings"
          options={{
            tabBarLabel: 'Ustawienia',
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚙️</Text>,
          }}
        >
          {() => (
            <SettingsScreen
              credentials={credentials}
              connectionState={connectionState}
              autoRefreshInterval={autoRefreshInterval}
              onSetAutoRefreshInterval={setAutoRefreshInterval}
              onUpdateCredentials={async (key, secret) => {
                return await connect(key, secret, true);
              }}
              onTestConnection={testConnection}
              onDisconnect={disconnect}
            />
          )}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#8E8E93',
    fontSize: 14,
    marginTop: 12,
  },
});
