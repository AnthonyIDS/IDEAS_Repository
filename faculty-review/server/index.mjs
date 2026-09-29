import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {timingSafeEqual,createHash} from 'node:crypto';
import {LIMITS,validateInput} from '../public/model.mjs';
import {analyze} from './analysis.mjs';
const ROOT=fileURLToPath(new URL('../public/',import.meta.url));
const allowedFiles=new Set(['index.html','styles.css','app.mjs','model.mjs','files.mjs','report.mjs','config.json','example.json']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
export function buildServer({env=process.env,analyzeImpl=analyze,now=()=>Date.now()}={}){
 const allowed=new Set((env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean));
 if(env.RENDER_EXTERNAL_URL)allowed.add(new URL(env.RENDER_EXTERNAL_URL).origin);
 const positive=(v,f)=>Number.isInteger(Number(v))&&Number(v)>0?Number(v):f;
 const maxDaily=positive(env.MAX_DAILY_REVIEWS,50),maxHourly=positive(env.MAX_HOURLY_REVIEWS,10),maxConcurrent=positive(env.MAX_CONCURRENT_REVIEWS,2);
 let daily={day:0,count:0},active=0;const buckets=new Map();
 const configured=()=>!!env.OPENAI_API_KEY&&!!env.OPENAI_MODEL&&!!env.REVIEW_ACCESS_CODE&&env.REVIEW_ACCESS_CODE.length>=16&&allowed.size>0;
 function authorized(value){const supplied=String(value||'').replace(/^Bearer /,'');if(supplied.length>256)return false;const h=s=>createHash('sha256').update(s).digest();return !!env.REVIEW_ACCESS_CODE&&timingSafeEqual(h(supplied),h(env.REVIEW_ACCESS_CODE));}
 function headers(res,origin){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");if(allowed.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}}
 function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'';headers(res,origin);const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='OPTIONS'){if(!allowed.has(origin))return send(res,403,{error:'This website is not approved to use the review service.'});res.writeHead(204);return res.end();}
  if(pathname==='/api/health'&&req.method==='GET')return send(res,200,{ready:configured(),requiresAccessCode:true,version:1});
  if(pathname==='/api/review'){
   if(req.method!=='POST')return send(res,405,{error:'Use POST to request a review.'});
   if(!configured())return send(res,503,{error:'Automated reviews are not connected yet. Your coordinator must configure the secure service.'});
   if(!allowed.has(origin))return send(res,403,{error:'This website is not approved to use the review service.'});
   if(!authorized(req.headers.authorization))return send(res,401,{error:'Enter the faculty access code provided by your coordinator.'});
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(res,415,{error:'Submit a JSON review request.'});
   if(Number(req.headers['content-length'])>LIMITS.body)return send(res,413,{error:'The supplied material is too long. Shorten it before continuing.'});
   if(active>=maxConcurrent)return send(res,429,{error:'Other reviews are running. Please try again shortly.'});
   // No trusted forwarding headers by default. Limits apply to the socket address and the entire service.
   const ip=req.socket.remoteAddress||'unknown',time=now(),hour=Math.floor(time/3600000),day=Math.floor(time/86400000);
   if(daily.day!==day)daily={day,count:0};
   for(const [key,b] of buckets)if(b.hour!==hour)buckets.delete(key);
   let bucket=buckets.get(ip)||{hour,count:0};
   if(daily.count>=maxDaily||bucket.count>=maxHourly){res.setHeader('Retry-After','3600');return send(res,429,{error:'The review allowance has been reached. Please try later or contact your coordinator.'});}
   let size=0,chunks=[],input;
   try{for await(const c of req){size+=c.length;if(size>LIMITS.body){send(res,413,{error:'The supplied material is too long.'});return;}chunks.push(c);}input=validateInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){return send(res,400,{error:e instanceof SyntaxError?'The supplied review could not be read.':e.message});}
   // Recheck after body reading because another request may have reserved a slot meanwhile.
   bucket=buckets.get(ip)||{hour,count:0};
   if(active>=maxConcurrent||daily.count>=maxDaily||bucket.count>=maxHourly)return send(res,429,{error:'The review service is busy or its allowance was reached. Try again later.'});
   daily.count++;bucket.count++;buckets.set(ip,bucket);active++;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnected);
   try{const result=await analyzeImpl(input,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL,signal:controller.signal});if(!res.destroyed)send(res,200,{result});}
   catch(e){if(!res.destroyed)send(res,502,{error:controller.signal.aborted?'The review timed out. Try a smaller assignment or fewer objectives.':e.message});}
   finally{clearTimeout(timer);res.off('close',disconnected);active--;}
   return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed.'});
  const file=pathname==='/'?'index.html':pathname.slice(1);
  if(!allowedFiles.has(file))return send(res,404,{error:'Page not found.'});
  try{const bytes=await readFile(path.join(ROOT,file));res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:bytes);}catch{send(res,404,{error:'Page not found.'});}
 });
 server.requestTimeout=150000;server.headersTimeout=15000;return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const port=Number(process.env.PORT)||8787;buildServer().listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Faculty review service listening on port ${port}. No submitted content is logged.`));}
