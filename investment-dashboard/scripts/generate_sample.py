"""Deterministic FICTIONAL demo; never called by the production updater."""
import datetime as dt, json, math, random
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
rng=random.Random(42)
c=json.loads((ROOT/'holdings.json').read_text())
ends=[300,60,75,500,160,500,160,250,120,80,400]
quotes={h['ticker']:{'price':p,'previousClose':round(p/1.0032,2),'timestamp':1790884800} for h,p in zip(c['holdings'],ends)}
start=dt.date(2021,10,1);end=dt.date(2026,10,1);day=start;p=b=100;history=[]
while day<=end:
 if day.weekday()<5:
  shock=rng.gauss(0,.008)
  p*=math.exp(.00022+.7*shock+rng.gauss(0,.002))
  b*=math.exp(.0003+shock)
  history.append({'date':str(day),'portfolio':round(p,6),'benchmark':round(b,6)})
 day+=dt.timedelta(days=1)
out={'mode':'sample','basis':'sample','asOf':'2026-10-01T21:30:00Z','quoteDate':'2026-10-01','source':'Deterministic fictional sample; not market data','quotes':quotes,'history':history[::5]+([history[-1]] if history[-1] != history[::5][-1] else [])}
(ROOT/'prices.json').write_text(json.dumps(out,indent=2)+'\n')
