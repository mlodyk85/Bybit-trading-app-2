import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ApiCredentials, TradeAck } from '../api/types';
import {
  fetchSpotMarketSnapshot,
  fetchSpotUsdtSymbols,
  MAX_SPOT_ORDER_USDT,
  placeSpotMarketOrder,
  placeSpotMarketSellBase,
  SpotMarketSnapshot,
  waitForSpotFill,
} from '../api/bybit';

interface Props { credentials: ApiCredentials }

const FALLBACK_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','PEPEUSDT','SUIUSDT','LINKUSDT','AVAXUSDT'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toNumber = (v: string) => Number(v.replace(',', '.'));
const priceText = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(5) : v.toFixed(8);

export const TradeScreen: React.FC<Props> = ({ credentials }) => {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [lastAck, setLastAck] = useState<TradeAck | null>(null);
  const [error, setError] = useState('');
  const [pairPickerOpen, setPairPickerOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [pairs, setPairs] = useState<string[]>(FALLBACK_SYMBOLS);
  const [pairsLoading, setPairsLoading] = useState(true);
  const [market, setMarket] = useState<SpotMarketSnapshot | null>(null);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [targetProfit, setTargetProfit] = useState('1');
  const [takeProfitPct, setTakeProfitPct] = useState('0.8');
  const [stopLossPct, setStopLossPct] = useState('0.5');
  const [maxLoss, setMaxLoss] = useState('2');
  const [maxCycles, setMaxCycles] = useState('20');
  const [sessionProfit, setSessionProfit] = useState(0);
  const [cycleCount, setCycleCount] = useState(0);
  const [autoStatus, setAutoStatus] = useState('Gotowy');
  const stopRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    fetchSpotUsdtSymbols()
      .then((list) => { if (mounted && list.length) setPairs(list); })
      .catch(() => undefined)
      .finally(() => { if (mounted) setPairsLoading(false); });
    return () => { mounted = false; stopRef.current = true; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const snapshot = await fetchSpotMarketSnapshot(symbol);
        if (mounted) setMarket(snapshot);
      } catch { /* keep last quote */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { mounted = false; clearInterval(timer); };
  }, [symbol]);

  const filteredPairs = useMemo(() => {
    const q = pairSearch.trim().toUpperCase();
    return q ? pairs.filter((p) => p.includes(q)) : pairs;
  }, [pairSearch, pairs]);

  const selectPair = (next: string) => {
    if (autoRunning) return;
    setSymbol(next);
    setPairSearch('');
    setPairPickerOpen(false);
  };

  const submit = (side: 'Buy' | 'Sell') => {
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_SPOT_ORDER_USDT) {
      setError(`Kwota musi być > 0 i <= ${MAX_SPOT_ORDER_USDT} USDT.`);
      return;
    }
    Alert.alert(
      side === 'Buy' ? 'Potwierdź zakup' : 'Potwierdź sprzedaż',
      `${side.toUpperCase()} ${symbol} za ${value.toFixed(2)} USDT po cenie rynkowej?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Wykonaj', style: side === 'Sell' ? 'destructive' : 'default', onPress: async () => {
          setBusy(true); setError('');
          try { setLastAck(await placeSpotMarketOrder(credentials, symbol, side, value)); }
          catch (e: unknown) { setError(e instanceof Error ? e.message : 'Błąd zlecenia.'); }
          finally { setBusy(false); }
        }},
      ]
    );
  };

  const stopAuto = () => {
    stopRef.current = true;
    setAutoStatus('STOP: zamykam bieżącą pozycję po rynku...');
  };

  const startAuto = () => {
    const trade = toNumber(amount);
    const target = toNumber(targetProfit);
    const tp = toNumber(takeProfitPct);
    const sl = toNumber(stopLossPct);
    const loss = toNumber(maxLoss);
    const cycles = Math.floor(toNumber(maxCycles));

    if (!Number.isFinite(trade) || trade <= 0 || trade > MAX_SPOT_ORDER_USDT) return setError(`Kwota AUTO: 0-${MAX_SPOT_ORDER_USDT} USDT.`);
    if (![target, tp, sl, loss].every((x) => Number.isFinite(x) && x > 0)) return setError('Cel zysku, TP, SL i max strata muszą być > 0.');
    if (!Number.isFinite(cycles) || cycles < 1 || cycles > 100) return setError('Max cykli: 1-100.');

    Alert.alert(
      'AUTO LIVE — prawdziwe pieniądze',
      `Bot będzie cyklicznie kupował ${symbol} za ${trade.toFixed(2)} USDT i sprzedawał przy TP ${tp}% lub SL ${sl}%. Zatrzyma się przy wyniku +${target.toFixed(2)} USDT, -${loss.toFixed(2)} USDT lub po ${cycles} cyklach. Zysk nie jest gwarantowany.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'START LIVE', onPress: async () => {
          stopRef.current = false;
          setAutoRunning(true); setError(''); setSessionProfit(0); setCycleCount(0);
          let total = 0;
          try {
            for (let cycle = 1; cycle <= cycles; cycle += 1) {
              if (stopRef.current || total >= target || total <= -loss) break;
              setCycleCount(cycle);
              setAutoStatus(`Cykl ${cycle}: BUY ${symbol} za ${trade.toFixed(2)} USDT`);

              const buyAck = await placeSpotMarketOrder(credentials, symbol, 'Buy', trade);
              setLastAck(buyAck);
              const buy = await waitForSpotFill(credentials, buyAck.orderId);
              const baseCoin = symbol.replace(/USDT$/, '');
              const qty = Math.max(0, buy.baseQty - (buy.feeByCurrency[baseCoin] || 0));
              const cost = buy.quoteValue + (buy.feeByCurrency.USDT || 0);
              const entry = buy.avgPrice;
              const tpPrice = entry * (1 + tp / 100);
              const slPrice = entry * (1 - sl / 100);
              if (qty <= 0) throw new Error('Brak ilości do sprzedaży po BUY.');

              let reason = 'STOP';
              while (!stopRef.current) {
                const snapshot = await fetchSpotMarketSnapshot(symbol);
                setMarket(snapshot);
                setAutoStatus(`${symbol} ${priceText(snapshot.lastPrice)} | wejście ${priceText(entry)} | TP ${priceText(tpPrice)} | SL ${priceText(slPrice)}`);
                if (snapshot.lastPrice >= tpPrice) { reason = 'TAKE PROFIT'; break; }
                if (snapshot.lastPrice <= slPrice) { reason = 'STOP LOSS'; break; }
                await sleep(2000);
              }

              setAutoStatus(`${reason}: SELL ${symbol}`);
              const sellAck = await placeSpotMarketSellBase(credentials, symbol, qty);
              const sell = await waitForSpotFill(credentials, sellAck.orderId);
              const proceeds = sell.quoteValue - (sell.feeByCurrency.USDT || 0);
              const pnl = proceeds - cost;
              total += pnl;
              setSessionProfit(total);
              setAutoStatus(`${reason} | cykl ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} USDT | sesja ${total >= 0 ? '+' : ''}${total.toFixed(4)} USDT`);
              if (stopRef.current || total >= target || total <= -loss) break;
              await sleep(1200);
            }

            if (total >= target) setAutoStatus(`CEL OSIĄGNIĘTY: +${total.toFixed(4)} USDT`);
            else if (total <= -loss) setAutoStatus(`MAX STRATA: ${total.toFixed(4)} USDT — AUTO STOP`);
            else if (stopRef.current) setAutoStatus(`AUTO zatrzymane | wynik ${total >= 0 ? '+' : ''}${total.toFixed(4)} USDT`);
            else setAutoStatus(`Koniec limitu cykli | wynik ${total >= 0 ? '+' : ''}${total.toFixed(4)} USDT`);
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Błąd AUTO.';
            setError(message); setAutoStatus(`AUTO przerwane: ${message}`);
          } finally {
            setAutoRunning(false); stopRef.current = false;
          }
        }},
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Trading Spot</Text>
        <Text style={styles.subtitle}>LIVE Bybit • Market • max {MAX_SPOT_ORDER_USDT} USDT / zlecenie</Text>

        <View style={styles.quoteCard}>
          <View style={styles.quoteTop}><Text style={styles.quoteSymbol}>{symbol}</Text><Text style={[styles.change, { color: (market?.change24hPct || 0) >= 0 ? '#22C55E' : '#EF4444' }]}>{market ? `${market.change24hPct >= 0 ? '+' : ''}${market.change24hPct.toFixed(2)}% 24h` : '...'}</Text></View>
          <Text style={styles.quotePrice}>{market ? `${priceText(market.lastPrice)} USDT` : 'Pobieranie ceny...'}</Text>
          {market && <Text style={styles.quoteDetails}>Bid {priceText(market.bid)} • Ask {priceText(market.ask)} • 24h H/L {priceText(market.high24h)} / {priceText(market.low24h)}</Text>}
        </View>

        <Text style={styles.label}>Para</Text>
        <TouchableOpacity style={styles.pairSelector} onPress={() => !autoRunning && setPairPickerOpen(true)}>
          <View><Text style={styles.pairValue}>{symbol}</Text><Text style={styles.hint}>{autoRunning ? 'Zablokowana podczas AUTO' : 'Dotknij, aby zmienić'}</Text></View><Text style={styles.arrow}>⌄</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Kwota pojedynczej transakcji (USDT)</Text>
        <TextInput value={amount} onChangeText={setAmount} editable={!autoRunning} keyboardType="decimal-pad" style={styles.input} />
        {!!error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.row}>
          <TouchableOpacity disabled={busy || autoRunning} style={[styles.button, styles.buy]} onPress={() => submit('Buy')}><Text style={styles.buttonText}>{busy ? '...' : 'BUY'}</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy || autoRunning} style={[styles.button, styles.sell]} onPress={() => submit('Sell')}><Text style={styles.buttonText}>{busy ? '...' : 'SELL'}</Text></TouchableOpacity>
        </View>

        <View style={styles.autoCard}>
          <View style={styles.autoHeader}><View style={{ flex: 1 }}><Text style={styles.autoTitle}>AUTONOMOUS</Text><Text style={styles.autoSub}>Prawdziwy handel • jedna pozycja naraz</Text></View><Switch value={autoEnabled} onValueChange={(v) => !autoRunning && setAutoEnabled(v)} disabled={autoRunning} /></View>
          {autoEnabled && <>
            <Text style={styles.autoNotice}>Bot używa realnego konta Bybit. Cel zysku jest warunkiem zatrzymania, a nie gwarancją zarobku.</Text>
            <View style={styles.grid}>
              <View style={styles.field}><Text style={styles.smallLabel}>Cel zysku (USDT)</Text><TextInput value={targetProfit} onChangeText={setTargetProfit} editable={!autoRunning} keyboardType="decimal-pad" style={styles.smallInput} /></View>
              <View style={styles.field}><Text style={styles.smallLabel}>Max strata (USDT)</Text><TextInput value={maxLoss} onChangeText={setMaxLoss} editable={!autoRunning} keyboardType="decimal-pad" style={styles.smallInput} /></View>
            </View>
            <View style={styles.grid}>
              <View style={styles.field}><Text style={styles.smallLabel}>Take Profit %</Text><TextInput value={takeProfitPct} onChangeText={setTakeProfitPct} editable={!autoRunning} keyboardType="decimal-pad" style={styles.smallInput} /></View>
              <View style={styles.field}><Text style={styles.smallLabel}>Stop Loss %</Text><TextInput value={stopLossPct} onChangeText={setStopLossPct} editable={!autoRunning} keyboardType="decimal-pad" style={styles.smallInput} /></View>
            </View>
            <Text style={styles.smallLabel}>Maksymalna liczba cykli</Text><TextInput value={maxCycles} onChangeText={setMaxCycles} editable={!autoRunning} keyboardType="number-pad" style={styles.smallInput} />
            <View style={styles.stats}><Text style={styles.stat}>Cykl {cycleCount}</Text><Text style={[styles.stat,{color:sessionProfit>=0?'#22C55E':'#EF4444'}]}>PnL {sessionProfit>=0?'+':''}{sessionProfit.toFixed(4)} USDT</Text></View>
            <Text style={styles.status}>{autoStatus}</Text>
            {autoRunning ? <TouchableOpacity style={styles.stopButton} onPress={stopAuto}><Text style={styles.buttonText}>STOP AUTO</Text></TouchableOpacity> : <TouchableOpacity style={styles.autoButton} onPress={startAuto}><Text style={styles.autoButtonText}>START AUTO LIVE</Text></TouchableOpacity>}
          </>}
        </View>

        {lastAck && <View style={styles.card}><Text style={styles.cardTitle}>Ostatnie zlecenie</Text><Text style={styles.line}>{lastAck.side} {lastAck.symbol} • {lastAck.quoteAmountUsdt.toFixed(2)} USDT</Text><Text style={styles.line}>Order ID: {lastAck.orderId}</Text><Text style={styles.line}>API: {lastAck.requestLatencyMs} ms</Text></View>}
      </ScrollView>

      <Modal visible={pairPickerOpen} animationType="slide" transparent onRequestClose={() => setPairPickerOpen(false)}>
        <View style={styles.backdrop}><View style={styles.modal}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Wybierz parę Spot/USDT</Text><TouchableOpacity onPress={() => setPairPickerOpen(false)}><Text style={styles.close}>✕</Text></TouchableOpacity></View>
          <TextInput value={pairSearch} onChangeText={setPairSearch} placeholder="BTC, XRP, ETH..." placeholderTextColor="#666" style={styles.search}/>
          {pairsLoading && <ActivityIndicator color="#F0B90B" />}
          <FlatList data={filteredPairs} keyExtractor={(x)=>x} renderItem={({item})=><TouchableOpacity style={styles.pairRow} onPress={()=>selectPair(item)}><Text style={styles.pairRowText}>{item}</Text>{item===symbol&&<Text style={styles.check}>✓</Text>}</TouchableOpacity>} />
        </View></View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#121212'}, container:{padding:18,paddingBottom:40}, title:{color:'#fff',fontSize:28,fontWeight:'800'}, subtitle:{color:'#8E8E93',marginTop:5,marginBottom:16},
  quoteCard:{backgroundColor:'#1E1E1E',borderRadius:14,padding:16,borderWidth:1,borderColor:'#333',marginBottom:14}, quoteTop:{flexDirection:'row',justifyContent:'space-between'}, quoteSymbol:{color:'#fff',fontSize:18,fontWeight:'800'}, quotePrice:{color:'#F0B90B',fontSize:27,fontWeight:'800',marginTop:8}, change:{fontWeight:'700'}, quoteDetails:{color:'#8E8E93',fontSize:11,marginTop:7},
  label:{color:'#D4D4D8',fontSize:13,marginTop:12,marginBottom:6}, input:{backgroundColor:'#1E1E1E',color:'#fff',borderRadius:12,padding:14,fontSize:17}, pairSelector:{backgroundColor:'#1E1E1E',borderRadius:12,padding:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderWidth:1,borderColor:'#333'}, pairValue:{color:'#fff',fontSize:18,fontWeight:'800'}, hint:{color:'#8E8E93',fontSize:11,marginTop:3}, arrow:{color:'#F0B90B',fontSize:25},
  error:{color:'#FF6B6B',marginTop:10}, row:{flexDirection:'row',gap:12,marginTop:18}, button:{flex:1,minHeight:52,borderRadius:12,alignItems:'center',justifyContent:'center'}, buy:{backgroundColor:'#15803D'}, sell:{backgroundColor:'#B91C1C'}, buttonText:{color:'#fff',fontSize:17,fontWeight:'800'},
  autoCard:{backgroundColor:'#191919',borderWidth:1,borderColor:'#F0B90B',borderRadius:14,padding:15,marginTop:22}, autoHeader:{flexDirection:'row',alignItems:'center'}, autoTitle:{color:'#F0B90B',fontSize:18,fontWeight:'900'}, autoSub:{color:'#8E8E93',fontSize:11,marginTop:2}, autoNotice:{color:'#D4D4D8',fontSize:12,lineHeight:17,marginVertical:12}, grid:{flexDirection:'row',gap:10}, field:{flex:1}, smallLabel:{color:'#A1A1AA',fontSize:11,marginTop:8,marginBottom:4}, smallInput:{backgroundColor:'#242424',color:'#fff',borderRadius:8,paddingHorizontal:10,paddingVertical:9,borderWidth:1,borderColor:'#333'}, stats:{flexDirection:'row',justifyContent:'space-between',marginTop:14}, stat:{color:'#fff',fontWeight:'700'}, status:{color:'#D4D4D8',fontSize:12,lineHeight:17,marginVertical:12}, autoButton:{backgroundColor:'#F0B90B',padding:14,borderRadius:10,alignItems:'center'}, autoButtonText:{color:'#111',fontWeight:'900'}, stopButton:{backgroundColor:'#B91C1C',padding:14,borderRadius:10,alignItems:'center'},
  card:{backgroundColor:'#1E1E1E',borderRadius:14,padding:15,marginTop:18}, cardTitle:{color:'#fff',fontWeight:'800',marginBottom:8}, line:{color:'#D4D4D8',marginTop:4},
  backdrop:{flex:1,backgroundColor:'rgba(0,0,0,.75)',justifyContent:'flex-end'}, modal:{height:'80%',backgroundColor:'#181818',borderTopLeftRadius:20,borderTopRightRadius:20,padding:18}, modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}, modalTitle:{color:'#fff',fontSize:20,fontWeight:'800'}, close:{color:'#fff',fontSize:22}, search:{backgroundColor:'#242424',color:'#fff',borderRadius:10,padding:12,marginVertical:12}, pairRow:{paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#333',flexDirection:'row',justifyContent:'space-between'}, pairRowText:{color:'#fff',fontWeight:'700'}, check:{color:'#F0B90B',fontWeight:'900'}
});
