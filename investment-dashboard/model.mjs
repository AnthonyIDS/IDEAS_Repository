export const signature = config => JSON.stringify([config.benchmark,...config.holdings.map(h=>[h.ticker,h.apiSymbol||h.ticker,h.shares])]);
export function validate(c,p){
 const hs=c.holdings;if(!Array.isArray(hs)||!hs.length)throw Error('Holdings must be a nonempty array.');
 if(new Set(hs.map(h=>h.ticker)).size!==hs.length)throw Error('Duplicate ticker.');
 if(Math.abs(hs.reduce((s,h)=>s+h.target,0)-100)>.001)throw Error('Target weights must total 100%.');
 for(const h of hs){for(const k of ['target','shares','costBasis'])if(!Number.isFinite(h[k])||h[k]<=0)throw Error(`${h.ticker}: invalid ${k}.`);
 if(!['ETF','Stock'].includes(h.type)||!['Core','Satellite'].includes(h.sleeve))throw Error('Invalid holding type or sleeve.');
 for(const k of ['ticker','name','sector','assetClass','thesis','risk'])if(typeof h[k]!=='string'||!h[k])throw Error(`Missing ${k}.`);
 if(h.type==='ETF'&&h.assetClass!=='Bonds'){const xs=Object.values(h.sectorExposure||{});if(!xs.length||xs.some(x=>!Number.isFinite(x)||x<0)||Math.abs(xs.reduce((a,b)=>a+b,0)-100)>.01)throw Error(`${h.ticker}: sectorExposure must total 100%.`);}
 if(p){const q=p.quotes?.[h.ticker];if(!q||![q.price,q.previousClose].every(x=>Number.isFinite(x)&&x>0))throw Error(`Missing valid price for ${h.ticker}.`);}}
 if(p&&(!Array.isArray(p.history)||!['sample','live'].includes(p.mode)||p.history.some(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||![r.portfolio,r.benchmark].every(v=>Number.isFinite(v)&&v>0))))throw Error('Invalid history data.');
}
export function calculate(c,p){validate(c,p);const rows=c.holdings.map(h=>({...h,price:p.quotes[h.ticker].price,value:h.shares*p.quotes[h.ticker].price,previous:h.shares*p.quotes[h.ticker].previousClose,cost:h.shares*h.costBasis}));const total=rows.reduce((s,r)=>s+r.value,0),cost=rows.reduce((s,r)=>s+r.cost,0),previous=rows.reduce((s,r)=>s+r.previous,0);rows.forEach(r=>{r.weight=r.value/total*100;r.drift=r.weight-r.target;r.return=(r.price/r.costBasis-1)*100;});const sectors={},assets={};for(const r of rows){assets[r.assetClass]=(assets[r.assetClass]||0)+r.weight;const exp=r.assetClass==='Bonds'?{'Fixed income':100}:r.type==='ETF'?r.sectorExposure:{[r.sector]:100};for(const [s,w]of Object.entries(exp))sectors[s]=(sectors[s]||0)+r.weight*w/100;}
 const stocks=rows.filter(r=>r.type==='Stock'),core=rows.filter(r=>r.sleeve==='Core').reduce((s,r)=>s+r.weight,0),sectorMax=Math.max(0,...Object.entries(sectors).filter(([s])=>s!=='Fixed income').map(([,v])=>v));
 const checks=[['10–15 holdings',rows.length>=10&&rows.length<=15],['Core allocation 60–70%',core>=60&&core<=70],['5–8 satellite stocks',stocks.length>=5&&stocks.length<=8],['Direct stocks ≤8%',stocks.every(r=>r.weight<=8)],['Estimated equity sectors ≤25%',sectorMax<=25],['At least six stock sectors',new Set(stocks.map(r=>r.sector)).size>=6],['International exposure',(assets['International equity']||0)>0],['Bond exposure',(assets.Bonds||0)>0]];
 return {rows,total,cost,previous,sectors,assets,core,sectorMax,checks,score:Math.round(checks.filter(([,ok])=>ok).length/8*100),largest:rows.reduce((a,b)=>a.weight>b.weight?a:b),drift:rows.filter(r=>Math.abs(r.drift)>5)};
}
export function period(history,months){if(!history.length)return [];const end=new Date(history.at(-1).date+'T00:00:00Z'),start=new Date(end);start.setUTCMonth(start.getUTCMonth()-months);return history.filter(x=>new Date(x.date+'T00:00:00Z')>=start);}

export function projection(price,months,growthPercent,rangePercent,unit="months"){
 if(![price,months,growthPercent,rangePercent].every(Number.isFinite)||price<=0||months<=0||growthPercent < -50||growthPercent>50||rangePercent<0||rangePercent>100)throw Error('Use growth from −50 to 50% and range from 0 to 100%.');
 if(!["months","days"].includes(unit))throw Error("Invalid projection period unit.");
 const t=unit==="days"?months/365:months/12,base=price*Math.pow(1+growthPercent/100,t),width=rangePercent/100*Math.sqrt(t);
 return {base,lower:base*Math.exp(-width),upper:base*Math.exp(width)};
}
export function horizonDate(date,months,days=0){
 const d=new Date(date+'T00:00:00Z');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last)+days);return d.toISOString().slice(0,10);
}
