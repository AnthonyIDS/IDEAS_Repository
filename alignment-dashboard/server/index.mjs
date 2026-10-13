// Small web service for the alignment dashboard.
//   GET  /api/health              what is configured
//   POST /api/review              run Claude on one assessment
//   POST /api/dashboards          create a saved dashboard, returns its ID
//   GET  /api/dashboards/:id      load a saved dashboard
//   PUT  /api/dashboards/:id      save changes
// It also serves the dashboard page itself, so the Render address works on its own.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { review, readReviewInput, MODEL, FRAMEWORK_VERSION } from './review.mjs';
import { createStore, newId, validId, MAX_DASHBOARD_BYTES } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..');
const STATIC = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css'], ['/config.js', 'config.js'], ['/example.json', 'example.json']]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const int = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);

export function createServer({ env = process.env, client, store = createStore(env), now = () => Date.now() } = {}) {
  const apiKey = env.ANTHROPIC_API_KEY;
  const claude = client || (apiKey ? new Anthropic({ apiKey }) : null);
  const accessCode = env.REVIEW_ACCESS_CODE || '';
  const passes = Math.min(int(env.REVIEW_PASSES, 2), 3);
  const limits = { daily: int(env.MAX_DAILY_REVIEWS, 60), hourly: int(env.MAX_HOURLY_REVIEWS, 15), concurrent: int(env.MAX_CONCURRENT_REVIEWS, 3) };
  const origins = new Set(String(env.ALLOWED_ORIGINS || 'https://anthonyids.github.io').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean));
  if (env.RENDER_EXTERNAL_URL) origins.add(env.RENDER_EXTERNAL_URL.replace(/\/$/, ''));

  let day = { key: '', count: 0 };
  const hourly = new Map();
  let running = 0;

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, error) => send(res, status, { error });

  const codeOk = given => {
    if (!accessCode) return true;
    const a = Buffer.from(String(given || '')), b = Buffer.from(accessCode);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const readJson = (req, max) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('That is too much text to send at once.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('The request was not valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });

  const quota = ip => {
    const t = now(), key = new Date(t).toISOString().slice(0, 10);
    if (day.key !== key) day = { key, count: 0 };
    if (day.count >= limits.daily) return 'The daily review limit for this site has been reached. Try again tomorrow.';
    const recent = (hourly.get(ip) || []).filter(x => t - x < 3600_000);
    if (recent.length >= limits.hourly) return 'You have run many reviews in the last hour. Wait a little and try again.';
    if (running >= limits.concurrent) return 'Several reviews are running right now. Try again in a minute.';
    recent.push(t); hourly.set(ip, recent); day.count++;
    return null;
  };

  async function handleReview(req, res) {
    if (!claude) return fail(res, 503, 'Claude is not connected yet. The site owner needs to add ANTHROPIC_API_KEY in Render.');
    if (!codeOk(req.headers['x-access-code'])) return fail(res, 401, 'That faculty access code is not right. Ask the site owner for the current code.');
    const input = readReviewInput(await readJson(req, 200_000));
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const blocked = quota(ip);
    if (blocked) return fail(res, 429, blocked);
    running++;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const result = await review(claude, input, { passes, signal: controller.signal });
      send(res, 200, result);
    } catch (e) {
      console.error('review failed:', e?.status || '', e?.constructor?.name || '', e?.message?.slice(0, 200));
      fail(res, e.status && e.status < 500 && e.status !== 401 ? e.status : 502, friendlyClaudeError(e));
    } finally { running--; }
  }

  async function handleDashboards(req, res, id) {
    if (req.method === 'POST' && !id) {
      if (!codeOk(req.headers['x-access-code'])) return fail(res, 401, 'Enter the faculty access code to save dashboards online.');
      const doc = await readJson(req, MAX_DASHBOARD_BYTES);
      const newDoc = { ...doc, id: newId(), savedAt: new Date(now()).toISOString() };
      await store.put(newDoc.id, newDoc);
      return send(res, 201, { id: newDoc.id, savedAt: newDoc.savedAt });
    }
    if (!validId(id)) return fail(res, 404, 'That dashboard link is not valid.');
    if (req.method === 'GET') {
      const doc = await store.get(id);
      return doc ? send(res, 200, doc) : fail(res, 404, 'No saved dashboard was found for that link.');
    }
    if (req.method === 'PUT') {
      const doc = await readJson(req, MAX_DASHBOARD_BYTES);
      if (!(await store.get(id))) return fail(res, 404, 'No saved dashboard was found for that link.');
      const saved = { ...doc, id, savedAt: new Date(now()).toISOString() };
      await store.put(id, saved);
      return send(res, 200, { id, savedAt: saved.savedAt });
    }
    return fail(res, 405, 'Method not allowed.');
  }

  async function serveStatic(req, res) {
    const file = STATIC.get(new URL(req.url, 'http://x').pathname);
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return fail(res, 404, 'Not found.');
    const body = await readFile(path.join(SITE, file));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '').replace(/\/$/, '');
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const { pathname } = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (pathname.startsWith('/api/') && origin && !origins.has(origin)) return fail(res, 403, 'This site is not allowed to use the review service. Add it to ALLOWED_ORIGINS in Render.');
      if (pathname === '/api/health') {
        return send(res, 200, { ok: true, claudeConnected: Boolean(claude), model: MODEL, passes, accessCodeRequired: Boolean(accessCode), storage: store.kind, storageDurable: store.durable, frameworkVersion: FRAMEWORK_VERSION });
      }
      if (pathname === '/api/review' && req.method === 'POST') return await handleReview(req, res);
      const m = pathname.match(/^\/api\/dashboards(?:\/([^/]+))?$/);
      if (m) return await handleDashboards(req, res, m[1]);
      if (pathname.startsWith('/api/')) return fail(res, 404, 'Not found.');
      return await serveStatic(req, res);
    } catch (e) {
      if (!res.headersSent) fail(res, e.status && e.status < 500 ? e.status : 500, e.status ? e.message : 'Something went wrong on the server. Try again.');
      if (!e.status) console.error(e);
    }
  });
}

// Fixed, readable messages. Provider messages are not passed through.
export function friendlyClaudeError(e) {
  if (e instanceof Anthropic.BadRequestError) return 'Claude could not accept this review request. Shorten the instructions or objectives and try again.';
  if (e instanceof Anthropic.AuthenticationError) return 'Claude rejected the API key. The site owner should check ANTHROPIC_API_KEY in Render.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This Anthropic API key is not allowed to use the configured model.';
  if (e instanceof Anthropic.NotFoundError) return 'The configured Claude model was not found. Check CLAUDE_MODEL in Render.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude is busy for this account right now. Wait a minute and try again.';
  if (e instanceof Anthropic.APIError && /credit|billing/i.test(e.message || '')) return 'The Anthropic account is out of credit. The site owner should add credit in the Claude Console.';
  if (e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) return 'The review was cancelled.';
  if (e instanceof Anthropic.APIError) return 'Claude is temporarily unavailable. Try again shortly.';
  return e?.message && e.message.length < 200 ? e.message : 'The review could not be completed. Try again.';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = int(process.env.PORT, 8787);
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.requestTimeout = 600_000;
  server.listen(port, host, () => console.log(`Alignment dashboard service on http://${host}:${port}`));
}
