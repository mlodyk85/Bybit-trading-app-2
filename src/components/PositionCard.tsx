import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Position } from '../api/types';
import { formatCryptoPrecision, formatPnL } from '../utils/format';

interface PositionCardProps {
  position: Position;
}

export const PositionCard: React.FC<PositionCardProps> = ({ position }) => {
  const isBuy = position.side === 'Buy' || position.side === 'LONG' || position.side === 'Long';
  const sideLabel = isBuy ? 'LONG' : 'SHORT';
  const sideBadgeBg = isBuy ? '#00E676' : '#FF5252'; // Green for LONG, Red for SHORT

  const pnlNum = parseFloat(position.unrealisedPnl || '0');
  const pnlColor = pnlNum > 0 ? '#00E676' : pnlNum < 0 ? '#FF5252' : '#FFFFFF';

  const categoryLabel = position.category === 'inverse' ? 'INVERSE' : 'LINEAR';

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.symbol}>{position.symbol}</Text>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{categoryLabel}</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={[styles.sideBadge, { backgroundColor: sideBadgeBg }]}>
            <Text style={styles.sideText}>{sideLabel}</Text>
          </View>
          {position.leverage ? (
            <Text style={styles.leverageText}>{position.leverage}x</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.divider} />

      {/* Grid Details */}
      <View style={styles.grid}>
        <View style={styles.gridItem}>
          <Text style={styles.label}>Size</Text>
          <Text style={styles.value}>{formatCryptoPrecision(position.size)}</Text>
        </View>

        <View style={styles.gridItem}>
          <Text style={styles.label}>Entry Price</Text>
          <Text style={styles.value}>{formatCryptoPrecision(position.avgPrice)}</Text>
        </View>

        <View style={styles.gridItem}>
          <Text style={styles.label}>Mark Price</Text>
          <Text style={styles.value}>{formatCryptoPrecision(position.markPrice)}</Text>
        </View>

        <View style={styles.gridItem}>
          <Text style={styles.label}>Unrealized PnL</Text>
          <Text style={[styles.value, { color: pnlColor, fontWeight: '700' }]}>
            {formatPnL(position.unrealisedPnl, 'USDT')}
          </Text>
        </View>

        <View style={styles.gridItem}>
          <Text style={styles.label}>Liq Price</Text>
          <Text style={styles.value}>
            {position.liqPrice && parseFloat(position.liqPrice) > 0
              ? formatCryptoPrecision(position.liqPrice)
              : '--'}
          </Text>
        </View>

        <View style={styles.gridItem}>
          <Text style={styles.label}>Take Profit (TP)</Text>
          <Text style={styles.value}>
            {position.takeProfit && parseFloat(position.takeProfit) > 0
              ? formatCryptoPrecision(position.takeProfit)
              : '--'}
          </Text>
        </View>

        <View style={styles.gridItem}>
          <Text style={styles.label}>Stop Loss (SL)</Text>
          <Text style={styles.value}>
            {position.stopLoss && parseFloat(position.stopLoss) > 0
              ? formatCryptoPrecision(position.stopLoss)
              : '--'}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  symbol: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginRight: 8,
  },
  categoryBadge: {
    backgroundColor: '#333333',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryText: {
    color: '#AAAAAA',
    fontSize: 10,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  sideText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  leverageText: {
    color: '#F0B90B',
    fontSize: 14,
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
    marginBottom: 10,
  },
  label: {
    color: '#8E8E93',
    fontSize: 11,
    marginBottom: 2,
  },
  value: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
