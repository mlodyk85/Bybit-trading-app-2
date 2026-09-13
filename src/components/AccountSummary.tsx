import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WalletAccountResult } from '../api/types';
import { formatCurrency, formatPnL } from '../utils/format';

interface AccountSummaryProps {
  account: WalletAccountResult | null;
}

export const AccountSummary: React.FC<AccountSummaryProps> = ({ account }) => {
  const totalEquity = account?.totalEquity || '0.00';
  const totalWalletBalance = account?.totalWalletBalance || '0.00';
  const totalAvailableBalance = account?.totalAvailableBalance || '0.00';
  const totalPerpUPL = account?.totalPerpUPL || '0.00';

  const uplNumber = parseFloat(totalPerpUPL || '0');
  const uplColor = uplNumber > 0 ? '#00E676' : uplNumber < 0 ? '#FF5252' : '#FFFFFF';

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Konto Unified Trading</Text>

      <View style={styles.mainEquityContainer}>
        <Text style={styles.equityLabel}>Total Equity</Text>
        <Text style={styles.equityValue}>{formatCurrency(totalEquity, 'USD')}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.grid}>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Wallet Balance</Text>
          <Text style={styles.gridValue}>{formatCurrency(totalWalletBalance, 'USD')}</Text>
        </View>

        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Available Balance</Text>
          <Text style={styles.gridValue}>{formatCurrency(totalAvailableBalance, 'USD')}</Text>
        </View>

        <View style={styles.gridItemFull}>
          <Text style={styles.gridLabel}>Unrealized PnL</Text>
          <Text style={[styles.gridValue, { color: uplColor, fontWeight: '700' }]}>
            {formatPnL(totalPerpUPL, 'USD')}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#2C2C2C',
  },
  cardTitle: {
    color: '#8E8E93',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  mainEquityContainer: {
    marginBottom: 12,
  },
  equityLabel: {
    color: '#AAAAAA',
    fontSize: 13,
    marginBottom: 4,
  },
  equityValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#2C2C2C',
    marginVertical: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItem: {
    width: '48%',
    marginBottom: 12,
  },
  gridItemFull: {
    width: '100%',
    marginTop: 4,
  },
  gridLabel: {
    color: '#AAAAAA',
    fontSize: 12,
    marginBottom: 2,
  },
  gridValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
