//+------------------------------------------------------------------+
//| CapitalRotationGoldEA.mq5                                        |
//| MT5 XAUUSD module - capital rotation / trend-pullback basket      |
//| No martingale. No averaging down.                                 |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Capital Rotation Gold EA for MT5"

#include <Trade/Trade.mqh>
CTrade trade;

input string InpSymbol               = "";
input ulong  InpMagic                = 850207;
input bool   InpAllowLong            = true;
input bool   InpAllowShort           = true;
input int    InpMaxPositions         = 3;
input int    InpCooldownMinutes      = 20;

input bool   InpUseRiskSizing        = true;
input double InpFixedLot             = 0.01;
input double InpRiskPerTradePct      = 0.50;
input double InpMaxMarginUsePct      = 25.0;
input double InpMinFreeMarginPct     = 60.0;

input ENUM_TIMEFRAMES InpSignalTF    = PERIOD_M5;
input ENUM_TIMEFRAMES InpTrendTF     = PERIOD_M15;
input int    InpEMAPeriod            = 50;
input int    InpRSIPeriod            = 14;
input int    InpATRPeriod            = 14;
input double InpATRStopMult          = 2.2;
input double InpATRMinMoveMult       = 0.15;
input double InpMaxSpreadPct         = 0.030;

input double InpBasketProfitTarget   = 1.00;
input double InpBasketLossLimit      = 3.00;
input double InpDailyProfitTarget    = 10.00;
input double InpDailyLossLimit       = 5.00;
input double InpMaxEquityDrawdownPct = 4.0;
input int    InpDeviationPoints      = 50;

int hEMA=INVALID_HANDLE, hRSI=INVALID_HANDLE, hATR=INVALID_HANDLE;
datetime lastBarTime=0, lastEntryTime=0, currentDayStart=0;
double dayPeakEquity=0.0;
bool dayLocked=false;

string TradeSymbol(){ return StringLen(InpSymbol)>0 ? InpSymbol : _Symbol; }

datetime DayStart(datetime t)
{
   MqlDateTime dt; TimeToStruct(t,dt);
   dt.hour=0; dt.min=0; dt.sec=0;
   return StructToTime(dt);
}

bool BufferValue(const int handle,const int shift,double &value)
{
   double data[]; ArraySetAsSeries(data,true);
   if(CopyBuffer(handle,0,shift,1,data)!=1) return false;
   value=data[0];
   return MathIsValidNumber(value);
}

double NormalizeVolume(const string symbol,double volume)
{
   double vmin=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   double vmax=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   if(step<=0.0) return MathMax(vmin,MathMin(vmax,volume));
   volume=MathMax(vmin,MathMin(vmax,volume));
   volume=MathFloor((volume+1e-12)/step)*step;
   int digits=2; if(step<0.01) digits=3; if(step<0.001) digits=4;
   return NormalizeDouble(volume,digits);
}

double CalculateVolume(const string symbol,const double stopDistance)
{
   if(!InpUseRiskSizing) return NormalizeVolume(symbol,InpFixedLot);
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney=equity*MathMax(0.01,InpRiskPerTradePct)/100.0;
   double tickSize=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   double tickValue=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_VALUE);
   if(stopDistance<=0.0 || tickSize<=0.0 || tickValue<=0.0)
      return NormalizeVolume(symbol,InpFixedLot);
   double lossPerLot=(stopDistance/tickSize)*tickValue;
   if(lossPerLot<=0.0) return NormalizeVolume(symbol,InpFixedLot);
   return NormalizeVolume(symbol,riskMoney/lossPerLot);
}

int ManagedPositions(const string symbol)
{
   int count=0;
   for(int i=PositionsTotal()-1;i>=0;--i)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;
      count++;
   }
   return count;
}

double BasketProfit(const string symbol)
{
   double pnl=0.0;
   for(int i=PositionsTotal()-1;i>=0;--i)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;
      pnl+=PositionGetDouble(POSITION_PROFIT);
      pnl+=PositionGetDouble(POSITION_SWAP);
   }
   return pnl;
}

ENUM_POSITION_TYPE BasketDirection(const string symbol)
{
   for(int i=PositionsTotal()-1;i>=0;--i)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;
      return (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   }
   return (ENUM_POSITION_TYPE)-1;
}

bool CloseAllManaged(const string symbol,const string reason)
{
   bool allOk=true;
   for(int i=PositionsTotal()-1;i>=0;--i)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0 || !PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;

      bool ok=trade.PositionClose(ticket,(ulong)InpDeviationPoints);
      uint rc=trade.ResultRetcode();
      if(!ok || (rc!=TRADE_RETCODE_DONE && rc!=TRADE_RETCODE_DONE_PARTIAL))
      {
         PrintFormat("MT5 ROTATION: close failed ticket=%I64u ret=%u %s",ticket,rc,trade.ResultRetcodeDescription());
         allOk=false;
      }
   }
   Print("MT5 ROTATION: basket close reason = ",reason);
   return allOk;
}

double TodayClosedPnl()
{
   datetime from=DayStart(TimeCurrent());
   if(!HistorySelect(from,TimeCurrent())) return 0.0;
   double pnl=0.0;
   int total=HistoryDealsTotal();
   for(int i=0;i<total;++i)
   {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0) continue;
      if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagic) continue;
      long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
      if(entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY) continue;
      pnl+=HistoryDealGetDouble(deal,DEAL_PROFIT);
      pnl+=HistoryDealGetDouble(deal,DEAL_SWAP);
      pnl+=HistoryDealGetDouble(deal,DEAL_COMMISSION);
   }
   return pnl;
}

void ResetDayIfNeeded()
{
   datetime ds=DayStart(TimeCurrent());
   if(ds==currentDayStart) return;
   currentDayStart=ds;
   dayPeakEquity=AccountInfoDouble(ACCOUNT_EQUITY);
   dayLocked=false;
}

bool RiskAllowsNewEntry()
{
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double freeMargin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double margin=AccountInfoDouble(ACCOUNT_MARGIN);
   if(equity<=0.0) return false;
   double freePct=100.0*freeMargin/equity;
   double marginPct=100.0*margin/equity;
   return freePct>=InpMinFreeMarginPct && marginPct<InpMaxMarginUsePct;
}

bool SpreadOk(const string symbol)
{
   MqlTick tick; if(!SymbolInfoTick(symbol,tick)) return false;
   double mid=(tick.ask+tick.bid)*0.5; if(mid<=0.0) return false;
   double spreadPct=(tick.ask-tick.bid)/mid*100.0;
   return spreadPct<=InpMaxSpreadPct;
}

bool ReadSignal(const string symbol,int &direction,double &atrValue)
{
   direction=0;
   double ema=0.0,rsi=0.0,atr=0.0;
   if(!BufferValue(hEMA,1,ema) || !BufferValue(hRSI,1,rsi) || !BufferValue(hATR,1,atr)) return false;
   if(atr<=0.0) return false;

   double close1=iClose(symbol,InpSignalTF,1);
   double close2=iClose(symbol,InpSignalTF,2);
   double low1=iLow(symbol,InpSignalTF,1);
   double high1=iHigh(symbol,InpSignalTF,1);
   if(close1<=0.0 || close2<=0.0) return false;

   double impulse=close1-close2;
   bool longTrend=close1>ema;
   bool shortTrend=close1<ema;
   bool longBounce=(close1-low1)>=atr*InpATRMinMoveMult && impulse>0.0;
   bool shortBounce=(high1-close1)>=atr*InpATRMinMoveMult && impulse<0.0;

   if(InpAllowLong && longTrend && longBounce && rsi>=50.0 && rsi<=68.0) direction=1;
   else if(InpAllowShort && shortTrend && shortBounce && rsi<=50.0 && rsi>=32.0) direction=-1;

   atrValue=atr;
   return true;
}

bool OpenPosition(const string symbol,const int direction,const double atrValue)
{
   MqlTick tick; if(!SymbolInfoTick(symbol,tick)) return false;
   double stopDistance=atrValue*InpATRStopMult;
   double volume=CalculateVolume(symbol,stopDistance);
   if(volume<=0.0) return false;

   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   double sl= direction>0 ? NormalizeDouble(tick.ask-stopDistance,digits)
                          : NormalizeDouble(tick.bid+stopDistance,digits);

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviationPoints);

   bool ok= direction>0
      ? trade.Buy(volume,symbol,0.0,sl,0.0,"CR-GOLD-LONG")
      : trade.Sell(volume,symbol,0.0,sl,0.0,"CR-GOLD-SHORT");

   uint rc=trade.ResultRetcode();
   if(!ok || (rc!=TRADE_RETCODE_DONE && rc!=TRADE_RETCODE_DONE_PARTIAL && rc!=TRADE_RETCODE_PLACED))
   {
      PrintFormat("MT5 ROTATION: entry failed ret=%u %s",rc,trade.ResultRetcodeDescription());
      return false;
   }

   lastEntryTime=TimeCurrent();
   return true;
}

void UpdateStatus(const string symbol)
{
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double balance=AccountInfoDouble(ACCOUNT_BALANCE);
   double freeMargin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double dayPnl=TodayClosedPnl();
   double basketPnl=BasketProfit(symbol);
   int positions=ManagedPositions(symbol);

   Comment(
      "MT5 CAPITAL ROTATION GOLD\n",
      "Symbol: ",symbol,"\n",
      "Equity: ",DoubleToString(equity,2),
      " | Balance: ",DoubleToString(balance,2),
      " | Free margin: ",DoubleToString(freeMargin,2),"\n",
      "Daily realized: ",DoubleToString(dayPnl,2),
      " | Basket PnL: ",DoubleToString(basketPnl,2),"\n",
      "Positions: ",positions,"/",InpMaxPositions,
      " | Day lock: ",(dayLocked?"YES":"NO")
   );
}

int OnInit()
{
   string symbol=TradeSymbol();
   if(!SymbolSelect(symbol,true))
   {
      Print("MT5 ROTATION: cannot select symbol ",symbol);
      return INIT_FAILED;
   }

   hEMA=iMA(symbol,InpTrendTF,InpEMAPeriod,0,MODE_EMA,PRICE_CLOSE);
   hRSI=iRSI(symbol,InpSignalTF,InpRSIPeriod,PRICE_CLOSE);
   hATR=iATR(symbol,InpSignalTF,InpATRPeriod);

   if(hEMA==INVALID_HANDLE || hRSI==INVALID_HANDLE || hATR==INVALID_HANDLE)
   {
      Print("MT5 ROTATION: indicator handle creation failed");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviationPoints);
   currentDayStart=DayStart(TimeCurrent());
   dayPeakEquity=AccountInfoDouble(ACCOUNT_EQUITY);
   dayLocked=false;

   Print("MT5 CAPITAL ROTATION GOLD initialized on ",symbol);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(hEMA!=INVALID_HANDLE) IndicatorRelease(hEMA);
   if(hRSI!=INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hATR!=INVALID_HANDLE) IndicatorRelease(hATR);
   Comment("");
}

void OnTick()
{
   string symbol=TradeSymbol();
   ResetDayIfNeeded();

   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity>dayPeakEquity) dayPeakEquity=equity;

   double dayPnl=TodayClosedPnl();
   double basketPnl=BasketProfit(symbol);

   if(ManagedPositions(symbol)>0)
   {
      if(basketPnl>=InpBasketProfitTarget) CloseAllManaged(symbol,"BASKET PROFIT TARGET");
      else if(basketPnl<=-MathAbs(InpBasketLossLimit)) CloseAllManaged(symbol,"BASKET LOSS LIMIT");
   }

   if(dayPnl>=InpDailyProfitTarget) dayLocked=true;

   if(dayPnl<=-MathAbs(InpDailyLossLimit))
   {
      dayLocked=true;
      if(ManagedPositions(symbol)>0) CloseAllManaged(symbol,"DAILY LOSS LIMIT");
   }

   if(dayPeakEquity>0.0)
   {
      double ddPct=(dayPeakEquity-equity)/dayPeakEquity*100.0;
      if(ddPct>=InpMaxEquityDrawdownPct)
      {
         dayLocked=true;
         if(ManagedPositions(symbol)>0) CloseAllManaged(symbol,"MAX EQUITY DRAWDOWN");
      }
   }

   UpdateStatus(symbol);
   if(dayLocked) return;

   datetime barTime=iTime(symbol,InpSignalTF,0);
   if(barTime<=0 || barTime==lastBarTime) return;
   lastBarTime=barTime;

   if(!SpreadOk(symbol) || !RiskAllowsNewEntry()) return;

   int positions=ManagedPositions(symbol);
   if(positions>=InpMaxPositions) return;
   if(lastEntryTime>0 && (TimeCurrent()-lastEntryTime)<InpCooldownMinutes*60) return;

   int direction=0;
   double atrValue=0.0;
   if(!ReadSignal(symbol,direction,atrValue) || direction==0) return;

   // Never average down. Add only to a non-losing basket and only in the same direction.
   if(positions>0)
   {
      if(BasketProfit(symbol)<0.0) return;
      ENUM_POSITION_TYPE basketDir=BasketDirection(symbol);
      if((direction>0 && basketDir!=POSITION_TYPE_BUY) ||
         (direction<0 && basketDir!=POSITION_TYPE_SELL)) return;
   }

   OpenPosition(symbol,direction,atrValue);
}
//+------------------------------------------------------------------+
