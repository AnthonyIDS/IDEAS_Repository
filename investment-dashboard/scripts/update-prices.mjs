// Node 22+, built-ins only. Never runs in the browser.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {validate,signature} from '../model.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function quote(symbol,key,fetcher=fetch){
 for(let attempt=0;attempt<3;attempt++){
  try{const res=await fetcher(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`,{headers:{'X-Finnhub-Token':key},signal:AbortSignal.timeout(20000)});
   if(!res.ok)throw Error(`HTTP ${res.status}`);const q=await res.json();
   if(![q.c,q.pc,q.t].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid or unavailable quote');
   const now=Date.now()/1000;if(q.t>now+300||now-q.t>5*86400)throw Error('Stale quote');
   return {price:q.c,previousClose:q.pc,timestamp:q.t};
  }catch{if(attempt===2)throw Error(`Quote failed for ${symbol}; previous prices.json preserved.`);await new Promise(r=>setTimeout(r,2000*(attempt+1)));}
 }
}
export function snapshot(config,old,quotes,now=new Date()){
 const sig=signature(config), dates=new Set(Object.values(quotes).map(q=>new Date(q.timestamp*1000).toLocaleDateString('en-CA',{timeZone:'America/New_York'})));
 if(dates.size!==1)throw Error('Mixed quote sessions; previous snapshot preserved.');
 const date=[...dates][0],value=config.holdings.reduce((s,h)=>s+h.shares*quotes[h.ticker].price,0),benchmark=quotes[config.benchmark].price;
 const history=old.mode==='live'&&old.signature===sig?old.history.filter(r=>r.date!==date):[];
 if(history.length&&date<history.at(-1).date)throw Error('Quote date moved backwards.');
 const result={mode:'live',basis:config.basis==='actual'?'actual':'sample',asOf:now.toISOString(),quoteDate:date,source:'Finnhub quote API; scheduled snapshot',signature:sig,quotes,history:[...history,{date,portfolio:value,benchmark}].slice(-1600)};
 validate(config,result);return result;
}
async function main(){const key=process.env.FINNHUB_API_KEY;if(!key)throw Error('Set FINNHUB_API_KEY in GitHub Actions Secrets.');const config=JSON.parse(await readFile(root+'holdings.json','utf8'));validate(config);const old=JSON.parse(await readFile(root+'prices.json','utf8'));const quotes={};for(const h of [...config.holdings,{ticker:config.benchmark}]){if(quotes[h.ticker])continue;quotes[h.ticker]=await quote(h.apiSymbol||h.ticker,key);await new Promise(r=>setTimeout(r,1100));}
 const result=snapshot(config,old,quotes);await writeFile(root+'prices.json.tmp',JSON.stringify(result,null,2)+'\n');await rename(root+'prices.json.tmp',root+'prices.json');console.log(`Saved ${Object.keys(quotes).length} quotes for ${result.quoteDate}.`);}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
