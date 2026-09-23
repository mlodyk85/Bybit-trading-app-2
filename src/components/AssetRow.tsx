import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CoinBalance, SpotExecution } from '../api/types';
import { formatCryptoPrecision, formatCurrency } from '../utils/format';

export interface AssetSmartAutoSeed { symbol: string; baseQty: number; buyPrice: number; buyCostUsdt: number; }
interface AssetRowProps { asset: CoinBalance; executions?: SpotExecution[]; onOpenTrade?: (seed: AssetSmartAutoSeed) => void; sellLocked?: boolean; onToggleSellLock?: (symbol: string, locked: boolean) => void; }
function formatUsdt(value: number): string { if (!Number.isFinite(value)) return '-'; return `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`; }
function formatPrice(value: number): string { if (!Number.isFinite(value)) return '-'; return value >= 1000 ? value.toFixed(2) : value >= 1 ? value.toFixed(5) : value.toFixed(8); }

export const AssetRow: React.FC<AssetRowProps> = ({ asset, executions = [], onOpenTrade, sellLocked = false, onToggleSellLock }) => {
  const coin = asset.coin.toUpperCase();
  const symbol = `${coin}USDT`;
  const rows = executions.filter((item) => item.symbol.toUpperCase() === symbol).sort((a, b) => Number(b.execTime) - Number(a.execTime));
  const lastBuy = rows.find((item) => item.side === 'Buy');
  const lastSell = rows.find((item) => item.side === 'Sell');
  const buyValue = lastBuy ? Number(lastBuy.execValue) : NaN;
  const buyPrice = lastBuy ? Number(lastBuy.execPrice) : NaN;
  const sellValue = lastSell ? Number(lastSell.execValue) : NaN;
  const sellPrice = lastSell ? Number(lastSell.execPrice) : NaN;
  const currentValue = Number(asset.usdValue);
  const walletQty = Number(asset.availableToWithdraw || asset.free || asset.walletBalance || 0);
  const lastBuyQty = lastBuy ? Number(lastBuy.execQty) : NaN;
  const baseFee = lastBuy?.feeCurrency?.toUpperCase() === coin ? Number(lastBuy.execFee) || 0 : 0;
  const quoteFee = lastBuy?.feeCurrency?.toUpperCase() === 'USDT' ? Number(lastBuy.execFee) || 0 : 0;
  const convertedBaseFee = Number.isFinite(buyPrice) ? baseFee * buyPrice : 0;
  const managedQty = Number.isFinite(lastBuyQty) ? Math.max(0, Math.min(walletQty, lastBuyQty - baseFee)) : 0;
  const buyCostUsdt = Number.isFinite(buyValue) ? buyValue + quoteFee + convertedBaseFee : NaN;
  const deltaFromLastBuy = Number.isFinite(currentValue) && Number.isFinite(buyValue) ? currentValue - buyValue : NaN;
  const tradable = coin !== 'USDT';
  const canOpenSmart = tradable && Boolean(onOpenTrade) && managedQty > 0 && Number.isFinite(buyPrice) && buyPrice > 0 && Number.isFinite(buyCostUsdt) && buyCostUsdt > 0;

  return <TouchableOpacity activeOpacity={canOpenSmart ? 0.78 : 1} disabled={!canOpenSmart} onPress={() => canOpenSmart && onOpenTrade?.({ symbol, baseQty: managedQty, buyPrice, buyCostUsdt })} style={[styles.container, sellLocked && styles.lockedContainer]}>
    <View style={styles.coinHeader}>
      <View><Text style={styles.coinName}>{asset.coin}</Text>{canOpenSmart && <Text style={styles.openHint}>SMART ACCUMULATE {coin} →</Text>}</View>
      <View style={styles.headerActions}>
        <Text style={styles.usdValue}>{formatCurrency(asset.usdValue, 'USD')}</Text>
        {tradable && onToggleSellLock && <TouchableOpacity
          style={[styles.lockButton, sellLocked && styles.lockButtonActive]}
          onPress={() => onToggleSellLock(symbol, !sellLocked)}
        >
          <Text style={[styles.lockButtonText, sellLocked && styles.lockButtonTextActive]}>{sellLocked ? '🔒 SELL ZABLOKOWANY' : '🔓 BLOKUJ SELL'}</Text>
        </TouchableOpacity>}
      </View>
    </View>
    <View style={styles.detailsRow}><View style={styles.detailCol}><Text style={styles.detailLabel}>Wallet Balance</Text><Text style={styles.detailValue}>{formatCryptoPrecision(asset.walletBalance)}</Text></View><View style={styles.detailCol}><Text style={styles.detailLabel}>Equity</Text><Text style={styles.detailValue}>{formatCryptoPrecision(asset.equity)}</Text></View><View style={styles.detailColRight}><Text style={styles.detailLabel}>Available</Text><Text style={styles.detailValue}>{formatCryptoPrecision(asset.availableToWithdraw || asset.free || asset.walletBalance)}</Text></View></View>
    {tradable && <View style={styles.tradeBox}>
      <View style={styles.tradeLine}><Text style={styles.tradeLabel}>Ostatni zakup</Text><Text style={styles.buyValue}>{lastBuy ? `${formatUsdt(buyValue)} @ ${formatPrice(buyPrice)}` : 'brak danych'}</Text></View>
      <View style={styles.tradeLine}><Text style={styles.tradeLabel}>Ostatnia sprzedaż</Text><Text style={styles.sellValue}>{lastSell ? `${formatUsdt(sellValue)} @ ${formatPrice(sellPrice)}` : 'brak danych'}</Text></View>
      <View style={styles.tradeLine}><Text style={styles.tradeLabel}>Obecna wartość</Text><Text style={styles.currentValue}>{Number.isFinite(currentValue) ? formatUsdt(currentValue) : '-'}</Text></View>
      {Number.isFinite(deltaFromLastBuy) && <View style={styles.tradeLine}><Text style={styles.tradeLabel}>Różnica vs ostatni BUY</Text><Text style={[styles.currentValue, deltaFromLastBuy >= 0 ? styles.positive : styles.negative]}>{deltaFromLastBuy >= 0 ? '+' : ''}{formatUsdt(deltaFromLastBuy)}</Text></View>}
      <Text style={styles.tradeNote}>{canOpenSmart ? `Dotknij, aby zarządzać tylko przypisaną partią ${coin}. Pozostałe saldo pozostaje rezerwą.` : 'Brak kompletnego ostatniego BUY — automatyczna sprzedaż tej pozycji pozostaje zablokowana.'}</Text>
    </View>}
  </TouchableOpacity>;
};

const styles = StyleSheet.create({
  container: { backgroundColor: '#1E1E1E', borderRadius: 8, padding: 12, marginVertical: 4, borderWidth: 1, borderColor: '#2A2A2A' }, coinHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }, coinName: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' }, openHint: { color: '#F0B90B', fontSize: 10, marginTop: 2, fontWeight: '800' }, usdValue: { color: '#F0B90B', fontSize: 14, fontWeight: '600' }, detailsRow: { flexDirection: 'row', justifyContent: 'space-between' }, detailCol: { flex: 1 }, detailColRight: { flex: 1, alignItems: 'flex-end' }, detailLabel: { color: '#8E8E93', fontSize: 11, marginBottom: 2 }, detailValue: { color: '#E0E0E0', fontSize: 13, fontWeight: '500' }, tradeBox: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#333333' }, tradeLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }, tradeLabel: { color: '#8E8E93', fontSize: 11 }, buyValue: { color: '#22C55E', fontSize: 12, fontWeight: '700' }, sellValue: { color: '#F59E0B', fontSize: 12, fontWeight: '700' }, currentValue: { color: '#D4D4D8', fontSize: 12, fontWeight: '700' }, positive: { color: '#22C55E' }, negative: { color: '#EF4444' }, tradeNote: { color: '#66666B', fontSize: 10, marginTop: 8, lineHeight: 14 }, lockedContainer: { borderColor: '#7F1D1D' }, headerActions: { alignItems: 'flex-end', gap: 6 }, lockButton: { borderWidth: 1, borderColor: '#52525B', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: '#242424' }, lockButtonActive: { borderColor: '#EF4444', backgroundColor: '#2A1717' }, lockButtonText: { color: '#D4D4D8', fontSize: 9, fontWeight: '800' }, lockButtonTextActive: { color: '#FF6B6B' },
});