export interface SpotTickerEvent {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  turnover24h: number;
  ts: number;
}

interface BybitTickerData {
  symbol?: string; lastPrice?: string; bid1Price?: string; ask1Price?: string;
  price24hPcnt?: string; highPrice24h?: string; lowPrice24h?: string; turnover24h?: string;
}
interface BybitWsMessage { topic?: string; ts?: number; data?: BybitTickerData | BybitTickerData[]; op?: string; success?: boolean; }

const WS_URL='wss://stream.bybit.com/v5/public/spot';
const clean=(symbols:string[])=>Array.from(new Set(symbols.map(s=>s.trim().toUpperCase()).filter(Boolean))).slice(0,80);
const number=(v?:string)=>{const n=Number(v);return Number.isFinite(n)?n:0;};

export class BybitSpotStream {
  private ws: WebSocket | null=null;
  private symbols:string[]=[];
  private stopped=true;
  private retry=0;
  private timer:ReturnType<typeof setTimeout>|null=null;
  constructor(private onTicker:(event:SpotTickerEvent)=>void, private onState?:(state:'connecting'|'open'|'reconnecting'|'closed')=>void) {}
  start(symbols:string[]) { this.symbols=clean(symbols); this.stopped=false; this.retry=0; this.connect(); }
  updateSymbols(symbols:string[]) { const next=clean(symbols); const changed=next.join('|')!==this.symbols.join('|'); this.symbols=next; if(changed&&!this.stopped){this.closeSocket();this.connect();} }
  stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=null;this.closeSocket();this.onState?.('closed');}
  private closeSocket(){if(this.ws){this.ws.onopen=null;this.ws.onmessage=null;this.ws.onerror=null;this.ws.onclose=null;try{this.ws.close();}catch{this.ws=null;}this.ws=null;}}
  private connect(){
    if(this.stopped||this.symbols.length===0)return;
    this.onState?.(this.retry?'reconnecting':'connecting');
    const ws=new WebSocket(WS_URL); this.ws=ws;
    ws.onopen=()=>{if(this.ws!==ws)return;this.retry=0;this.onState?.('open');ws.send(JSON.stringify({op:'subscribe',args:this.symbols.map(s=>'tickers.'+s)}));};
    ws.onmessage=(e)=>{try{const msg=JSON.parse(String(e.data)) as BybitWsMessage;if(!msg.topic?.startsWith('tickers.')||!msg.data)return;const d=Array.isArray(msg.data)?msg.data[0]:msg.data;if(!d?.symbol)return;this.onTicker({symbol:d.symbol,lastPrice:number(d.lastPrice),bid:number(d.bid1Price),ask:number(d.ask1Price),change24hPct:number(d.price24hPcnt)*100,high24h:number(d.highPrice24h),low24h:number(d.lowPrice24h),turnover24h:number(d.turnover24h),ts:msg.ts||Date.now()});}catch{ return; }};
    ws.onerror=()=>{try{ws.close();}catch{this.ws=null;}};
    ws.onclose=()=>{if(this.ws===ws)this.ws=null;if(this.stopped)return;this.retry+=1;const delay=Math.min(30000,1000*Math.pow(2,Math.min(this.retry,5)));this.onState?.('reconnecting');this.timer=setTimeout(()=>this.connect(),delay);};
  }
}
