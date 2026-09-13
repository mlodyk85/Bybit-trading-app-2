import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CoinBalance } from '../api/types';
import { formatCryptoPrecision, formatCurrency } from '../utils/format';

interface AssetRowProps {
  asset: CoinBalance;
}

export const AssetRow: React.FC<AssetRowProps> = ({ asset }) => {
  return (
    <View style={styles.container}>
      <View style={styles.coinHeader}>
        <Text style={styles.coinName}>{asset.coin}</Text>
        <Text style={styles.usdValue}>{formatCurrency(asset.usdValue, 'USD')}</Text>
      </View>

      <View style={styles.detailsRow}>
        <View style={styles.detailCol}>
          <Text style={styles.detailLabel}>Wallet Balance</Text>
          <Text style={styles.detailValue}>{formatCryptoPrecision(asset.walletBalance)}</Text>
        </View>

        <View style={styles.detailCol}>
          <Text style={styles.detailLabel}>Equity</Text>
          <Text style={styles.detailValue}>{formatCryptoPrecision(asset.equity)}</Text>
        </View>

        <View style={styles.detailColRight}>
          <Text style={styles.detailLabel}>Available</Text>
          <Text style={styles.detailValue}>
            {formatCryptoPrecision(asset.availableToWithdraw || asset.free || asset.walletBalance)}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  coinHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  coinName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  usdValue: {
    color: '#F0B90B', // Bybit yellow accent
    fontSize: 14,
    fontWeight: '600',
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailCol: {
    flex: 1,
  },
  detailColRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  detailLabel: {
    color: '#8E8E93',
    fontSize: 11,
    marginBottom: 2,
  },
  detailValue: {
    color: '#E0E0E0',
    fontSize: 13,
    fontWeight: '500',
  },
});
