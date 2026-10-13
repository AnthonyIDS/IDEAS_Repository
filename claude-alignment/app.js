// Course alignment dashboard: faculty build their course, Claude reviews each
// assessment through the Render service, and the dashboard is saved so it can be
// resumed later from a private link (and always in this browser as a backup).

const CFG = window.ALIGNMENT_CONFIG || {};
// null = no review service configured; '' = same address as this page.
const API = (CFG.apiBaseUrl || '').replace(/\/$/, '') ||
  (location.hostname.endsWith('github.io') || location.protocol === 'file:' ? null : '');

const KEY = 'claude-alignment:';
const SCALE = [
  { value: 1, label: 'No alignment', description: 'The instructions do not require students to do what the objective states. Topic overlap alone is not alignment.' },
  { value: 2, label: 'Slightly aligned', description: 'Related content, but the required work does not ask students to perform the objective’s action.' },
  { value: 3, label: 'Moderately aligned', description: 'Requires part of the objective, or the action at a lower level than stated.' },
  { value: 4, label: 'Mostly aligned', description: 'Directly requires the objective’s action, with minor gaps.' },
  { value: 5, label: 'Fully aligned', description: 'Directly and completely requires students to demonstrate the objective, and the criteria show how it is judged.' },
];
const ARMS = [
  { level: 1, risk: 'Very Low', resilience: 'Very Resilient', description: 'Highly unlikely that AI can produce this type of assessment.' },
  { level: 2, risk: 'Low', resilience: 'Resilient', description: 'AI could be used, but is very unlikely to have a significant impact on quality or originality.' },
  { level: 3, risk: 'Moderate', resilience: 'Somewhat Resilient', description: 'Moderate likelihood of AI use, with a possible moderate impact on quality or originality.' },
  { level: 4, risk: 'High', resilience: 'Vulnerable', description: 'Easy to use AI to produce the work, with a possible significant impact on quality or originality.' },
  { level: 5, risk: 'Very High', resilience: 'Highly Vulnerable', description: 'Very easy to use AI; the work can be produced entirely by AI, with a significant impact on quality or originality.' },
];
const AIAS = ['No AI', 'AI-assisted idea generation and structuring', 'AI-assisted editing', 'AI task completion, human evaluation', 'Full AI'];
const DELIVERY = ['Online, unsupervised', 'Online, proctored', 'In class, supervised', 'Live presentation or oral defense', 'Hands-on lab or field work', 'Mixed or other'];
const TYPES = ['Discussion', 'Essay or paper', 'Project', 'Lab', 'Quiz or exam', 'Presentation', 'Concept sketch or diagram', 'Reflection', 'Case study', 'Other'];

// ---------- small helpers ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(KEY + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(KEY + k); } catch { /* ignore */ } },
};
const uid = () => Math.random().toString(36).slice(2, 9);
const hash = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const scaleLabel = n => SCALE.find(s => s.value === n)?.label || 'Not yet reviewed';
const armsInfo = n => ARMS.find(a => a.level === n);
let toastTimer;
function toast(msg) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- workspace ----------
const emptyWorkspace = () => ({ schema: 1, id: null, course: { code: '', title: '', subject: '' }, outcomes: [], assignments: [], updatedAt: null });
let ws = emptyWorkspace();
let health = null; // result of /api/health
const ui = { editing: null, reviewing: new Set(), errors: {}, module: 'all', outcome: 'all', search: '', saveState: 'local', saveMsg: '', pasteOpen: false };

const hasContent = w => Boolean(w.course.code || w.course.title || w.outcomes.length || w.assignments.length);
const outcomeOf = id => ws.outcomes.find(o => o.id === id);
const parents = () => ws.outcomes.filter(o => !o.parent);
const childrenOf = id => ws.outcomes.filter(o => o.parent === id);
// Items counted in summaries: objectives, or an outcome that has no objectives under it.
const leaves = () => ws.outcomes.filter(o => o.parent || !childrenOf(o.id).length);
const modules = () => [...new Set(ws.assignments.map(a => a.module).filter(m => m !== '' && m != null))].sort((x, y) => x - y);
const reviewed = () => ws.assignments.filter(a => a.review);

function inputHash(a) {
  return hash(JSON.stringify([a.instructions, a.rubric, a.delivery, a.deliveryNotes, ws.outcomes.map(o => [o.id, o.text])]));
}
const isStale = a => a.review && a.review.inputHash !== inputHash(a);
function rating(a, id) {
  if (a.overrides && a.overrides[id]) return { score: a.overrides[id], adjusted: true, item: a.review?.alignment.find(x => x.objectiveId === id) };
  const item = a.review?.alignment.find(x => x.objectiveId === id);
  return item ? { score: item.score, adjusted: false, item } : { score: null, adjusted: false, item: null };
}
function best(id) {
  const scores = ws.assignments.map(a => rating(a, id).score).filter(Boolean);
  return scores.length ? Math.max(...scores) : null;
}

// ---------- saving and resuming ----------
let remoteTimer = null, remoteBusy = false, remoteAgain = false;
const accessCode = () => store.get('accessCode') || '';
const canSaveOnline = () => API !== null && health?.ok;

function persistLocal() {
  store.set('current', ws);
  if (ws.id) {
    store.set('dash:' + ws.id, ws);
    const recent = (store.get('recent') || []).filter(r => r.id !== ws.id);
    recent.unshift({ id: ws.id, title: [ws.course.code, ws.course.title].filter(Boolean).join(' · ') || 'Untitled course', savedAt: ws.updatedAt });
    store.set('recent', recent.slice(0, 12));
  }
}
function changed({ rerender = true } = {}) {
  ws.updatedAt = new Date().toISOString();
  persistLocal();
  if (canSaveOnline() && hasContent(ws)) {
    ui.saveState = 'pending';
    clearTimeout(remoteTimer); remoteTimer = setTimeout(saveRemote, 3000);
  }
  if (rerender) render(); else renderSidebar();
}
async function api(path, opts = {}, timeoutMs = 60000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API + path, { ...opts, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(accessCode() ? { 'X-Access-Code': accessCode() } : {}), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `The service answered with an error (${res.status}).`), { status: res.status });
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The review service took too long to answer. If it was asleep, try again in a minute.');
    if (e instanceof TypeError) throw new Error('Could not reach the review service. Check your connection and try again.');
    throw e;
  } finally { clearTimeout(t); }
}
async function saveRemote() {
  if (remoteBusy) { remoteAgain = true; return; }
  remoteBusy = true; ui.saveState = 'saving'; renderSidebar();
  try {
    if (!ws.id) {
      const out = await api('/api/dashboards', { method: 'POST', body: JSON.stringify(ws) });
      ws.id = out.id;
      history.replaceState(null, '', `?d=${out.id}${location.hash}`);
      persistLocal();
      toast('Saved online. Copy your resume link from the side panel to come back later.');
    } else {
      await api(`/api/dashboards/${ws.id}`, { method: 'PUT', body: JSON.stringify(ws) });
    }
    ui.saveState = 'online'; ui.saveMsg = '';
  } catch (e) {
    if (e.status === 401) { ui.saveState = 'needs-code'; ui.saveMsg = e.message; }
    else if (e.status === 404 && ws.id) {
      // The service no longer has this dashboard (for example after a restart): save it again under a new link.
      store.del('dash:' + ws.id); ws.id = null; remoteBusy = false; return saveRemote();
    } else { ui.saveState = 'error'; ui.saveMsg = e.message; }
  } finally {
    remoteBusy = false; renderSidebar();
    if (remoteAgain) { remoteAgain = false; saveRemote(); }
  }
}
const resumeLink = () => ws.id ? `${location.origin}${location.pathname}?d=${ws.id}` : '';

function normalizeWorkspace(doc) {
  const w = { ...emptyWorkspace(), ...doc };
  w.course = { ...emptyWorkspace().course, ...(doc.course || {}) };
  w.outcomes = (doc.outcomes || []).filter(o => o && o.id).map(o => ({ id: String(o.id), text: String(o.text || ''), parent: o.parent ? String(o.parent) : null }));
  w.assignments = (doc.assignments || []).map(a => ({ id: a.id || uid(), module: a.module ?? '', title: a.title || 'Untitled assessment', type: a.type || '', points: a.points ?? '', instructions: a.instructions || '', rubric: a.rubric || '', delivery: a.delivery || DELIVERY[0], deliveryNotes: a.deliveryNotes || '', permission: a.permission ?? null, review: a.review || null, overrides: a.overrides || {} }));
  return w;
}
async function loadInitial() {
  const id = new URLSearchParams(location.search).get('d');
  if (API !== null) {
    try { health = await api('/api/health', {}, 70000); } catch (e) { health = { ok: false, error: e.message }; }
  }
  if (id) {
    const local = store.get('dash:' + id);
    try {
      if (!canSaveOnline()) throw new Error('offline');
      const remote = normalizeWorkspace(await api(`/api/dashboards/${id}`));
      // Keep whichever copy was changed most recently.
      ws = local && local.updatedAt > (remote.updatedAt || '') ? normalizeWorkspace({ ...local, id }) : remote;
      ws.id = id;
      if (ws === remote) ui.saveState = 'online'; else changed({ rerender: false });
    } catch (e) {
      if (local && e.status === 404) {
        // The service lost this dashboard (for example a free Render restart): save this browser's copy under a new link.
        ws = normalizeWorkspace({ ...local, id: null }); store.del('dash:' + id);
        history.replaceState(null, '', location.pathname + location.hash);
        ui.saveMsg = 'The online copy was missing, so this browser’s copy was saved again with a new resume link.';
        saveRemote();
      } else if (local) { ws = normalizeWorkspace({ ...local, id }); ui.saveState = 'local'; ui.saveMsg = 'Opened the copy saved in this browser. The online copy could not be loaded.'; }
      else { ws = emptyWorkspace(); toast(e.message === 'offline' ? 'The review service is not connected, so this saved link cannot be opened right now.' : e.message); history.replaceState(null, '', location.pathname + location.hash); }
    }
  } else {
    const cur = store.get('current');
    ws = cur ? normalizeWorkspace(cur) : emptyWorkspace();
    if (ws.id) { history.replaceState(null, '', `?d=${ws.id}${location.hash}`); ui.saveState = 'online'; }
  }
  persistLocal();
  if (!location.hash) location.hash = ws.assignments.some(a => a.review) ? '#overview' : '#build';
  render();
}

// ---------- Claude reviews ----------
async function runReview(id) {
  const a = ws.assignments.find(x => x.id === id);
  if (!a || ui.reviewing.has(id)) return;
  if (!canSaveOnline()) return toast('The review service is not connected yet.');
  if (health?.accessCodeRequired && !accessCode()) { location.hash = '#build'; render(); toast('Enter the faculty access code in step 4 first.'); $('#access-code')?.focus(); return; }
  if (!ws.outcomes.length) return toast('Add your learning outcomes or objectives first.');
  if ((a.instructions || '').trim().length < 40) return toast(`Paste the full instructions for “${a.title}” first.`);
  ui.reviewing.add(id); delete ui.errors[id]; render();
  try {
    const result = await api('/api/review', {
      method: 'POST',
      body: JSON.stringify({
        course: [ws.course.code, ws.course.title].filter(Boolean).join(' '),
        objectives: ws.outcomes.map(o => ({ id: o.id, text: o.text, parent: o.parent })),
        assignment: { title: a.title, type: a.type, instructions: a.instructions, rubric: a.rubric, delivery: a.delivery, deliveryNotes: a.deliveryNotes },
      }),
    }, 600000);
    a.review = { ...result, inputHash: inputHash(a) };
    a.overrides = {};
    toast(`Review finished: ${a.title}`);
  } catch (e) {
    ui.errors[id] = e.message;
  } finally {
    ui.reviewing.delete(id);
    changed();
  }
}
async function reviewAll() {
  const todo = ws.assignments.filter(a => !a.review || isStale(a));
  if (!todo.length) return toast('Every assessment already has a current review.');
  // Two at a time keeps things quick without tripping the service's limits.
  const queue = [...todo];
  const worker = async () => { while (queue.length) await runReview(queue.shift().id); };
  await Promise.all([worker(), worker()]);
}

// ---------- outcome parsing ----------
// Lines like "1." or "Outcome 2" start an outcome; indented lines, "a.", "1.1", "-", or "•" are objectives under it.
function parseOutcomes(text) {
  const out = []; let current = null, n = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const indented = /^\s{2,}|\t/.test(rawLine);
    const line = rawLine.trim();
    const sub = line.match(/^(?:[a-z][.)]|\d+\.\d+\.?|[-•*–]|\(?[ivx]+[.)])\s*/i);
    if (current && (indented || sub)) {
      const k = out.filter(o => o.parent === current.id).length + 1;
      out.push({ id: `${current.id}.${k}`, text: line.replace(sub ? sub[0] : '', '').trim(), parent: current.id });
    } else {
      n++;
      current = { id: String(n), text: line.replace(/^(?:outcome|slo|clo|objective)?\s*\d+\s*[.:)-]?\s*/i, '').trim() || line, parent: null };
      out.push(current);
    }
  }
  return out;
}
function renumber() {
  const map = {}; let n = 0;
  const result = [];
  for (const p of parents()) {
    n++; map[p.id] = String(n); result.push({ ...p, id: String(n) });
    childrenOf(p.id).forEach((c, i) => { map[c.id] = `${n}.${i + 1}`; result.push({ ...c, id: `${n}.${i + 1}`, parent: String(n) }); });
  }
  ws.outcomes = result;
  for (const a of ws.assignments) {
    if (a.review) a.review.alignment.forEach(x => { x.objectiveId = map[x.objectiveId] || x.objectiveId; });
    a.overrides = Object.fromEntries(Object.entries(a.overrides || {}).map(([k, v]) => [map[k] || k, v]));
  }
}

// ---------- shared pieces ----------
function heading(eyebrow, title, intro) {
  return `<div class="heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${intro ? `<p>${intro}</p>` : ''}</div><a class="btn" href="#help">How to read this page</a></div>`;
}
const notice = `<div class="notice"><strong>Claude’s ratings are suggestions for faculty review, not final decisions.</strong> Each assessment is reviewed twice, independently; scores above 1 are kept only when Claude can quote the instructions that support them.</div>`;
function chip(score, { adjusted = false, compact = false } = {}) {
  if (!score) return `<span class="rating r0">${compact ? 'Not yet reviewed' : 'Not yet reviewed'}</span>`;
  return `<span class="rating r${score}${adjusted ? ' adjusted' : ''}"><b>${score}</b> ${esc(scaleLabel(score))}</span>`;
}
function ring(a) {
  const n = a.review?.ai.armsLevel, l = armsInfo(n);
  return `<div class="ringrow"><div class="ring risk${n || 0}" style="--fill:${n ? (6 - n) * 20 : 0}" role="img" aria-label="${esc(l ? `${l.resilience}. ARMS risk level ${n}, ${l.risk}.` : 'AI vulnerability not yet reviewed')}"><div class="ringinside"><strong>${esc(l?.resilience || 'Not yet reviewed')}</strong><span>${n ? `ARMS ${n} / 5` : 'No rating'}</span></div></div><div class="ringcopy"><p><strong>${n ? `${esc(l.risk)} AI risk` : 'AI risk not reviewed'}</strong></p>${a.review?.ai.agreement === 'differed' ? '<p class="agree warn">The two reviews disagreed; the higher risk is shown.</p>' : ''}<p class="muted">Fuller ring = more resilient</p></div></div>`;
}
function permissionBadge(a) {
  return a.permission ? `<span class="badge">AI permission · Level ${a.permission}: ${esc(AIAS[a.permission - 1])}</span>` : `<span class="badge policy">AI permission · not set by instructor</span>`;
}
function aiasBox(a) {
  const s = a.review?.ai.aiasSuggestion; if (!s?.level) return '';
  return `<div class="aiasbox"><h4>Suggested AI use level <span class="muted">(suggestion)</span></h4><p><span class="levelchip">Level ${s.level}</span> ${esc(AIAS[s.level - 1])}</p><p><strong>AI may help:</strong> ${esc(s.aiMayHelp)}</p><p><strong>Students must do:</strong> ${esc(s.studentMustDo)}</p></div>`;
}
function reviewStatus(a) {
  if (ui.reviewing.has(a.id)) return `<span class="status"><span class="spinner" aria-hidden="true"></span>Claude is reviewing… (1–3 minutes)</span>`;
  if (ui.errors[a.id]) return `<span class="status err">Review failed</span>`;
  if (!a.review) return `<span class="status">Not reviewed yet</span>`;
  if (isStale(a)) return `<span class="status warn">Changed since review · rerun</span>`;
  return `<span class="status ok">Reviewed ${new Date(a.review.reviewedAt).toLocaleDateString()}</span>`;
}
const moduleSelect = () => `<label>Module<select data-filter="module"><option value="all">All modules</option>${modules().map(m => `<option value="${esc(m)}" ${String(ui.module) === String(m) ? 'selected' : ''}>Module ${esc(m)}</option>`).join('')}</select></label>`;
const filtered = () => ws.assignments.filter(a => ui.module === 'all' || String(a.module) === String(ui.module));
function emptyState(msg) {
  return `<div class="panel empty"><p>${msg}</p><a class="btn primary" href="#build">Build your dashboard →</a></div>`;
}

// ---------- views ----------
function buildView() {
  const svc = serviceLine();
  const recent = (store.get('recent') || []).filter(r => r.id !== ws.id);
  const welcome = !hasContent(ws) ? `<section class="welcome"><div class="panel"><h2>Start your course dashboard</h2><p>Add your course, paste your learning outcomes and objectives, then paste each assessment’s instructions. Claude reviews every assessment for alignment (Quality Matters) and AI vulnerability (ARMS) and the dashboard fills in.</p><div class="lead-actions"><button class="btn primary" data-action="focus-course">Start a new course</button><button class="btn" data-action="load-example">Try the ESC1000C example</button></div></div><div class="panel"><h2>Come back to a dashboard</h2><form class="inline-form" data-form="open"><label class="field">Resume link or code<input name="link" placeholder="Paste your resume link" autocomplete="off"></label><button class="btn">Open</button></form>${recent.length ? `<p class="small" style="margin-top:16px"><strong>Saved on this computer</strong></p><ul class="recent">${recent.map(r => `<li><a href="?d=${esc(r.id)}#overview">${esc(r.title)}</a></li>`).join('')}</ul>` : ''}<p class="small muted" style="margin-top:12px">You can also <button class="textbutton" data-action="import">load a backup file</button>.</p></div></section>` : '';
  const outcomeRows = parents().map(p => `<div class="outcome-edit">${outcomeRow(p)}${childrenOf(p.id).map(outcomeRow).join('')}<button class="btn small" data-action="add-objective" data-id="${esc(p.id)}">+ Add objective under ${esc(p.id)}</button></div>`).join('');
  return heading('Faculty workspace', 'Build your dashboard', 'Four steps. Your work saves as you go.') + svc + welcome + `
  <section class="panel"><div class="stephead"><span class="stepnum">1</span><h2>Your course</h2></div>
    <div class="fieldrow" id="course-fields">
      <label class="field">Course code<input data-course="code" value="${esc(ws.course.code)}" placeholder="ESC1000C"></label>
      <label class="field">Course title<input data-course="title" value="${esc(ws.course.title)}" placeholder="Earth Science"></label>
      <label class="field">Department or note <span class="hint">Optional</span><input data-course="subject" value="${esc(ws.course.subject)}"></label>
    </div></section>
  <section class="panel"><div class="stephead"><span class="stepnum">2</span><h2>Learning outcomes and objectives</h2></div>
    <p class="muted">Use the official wording. Each assessment is rated against every item here.</p>
    ${outcomeRows || '<p class="empty">No outcomes yet. Paste a list below or add one at a time.</p>'}
    <div class="formfoot"><button class="btn" data-action="add-outcome">+ Add outcome</button></div>
    <details ${ui.pasteOpen || !ws.outcomes.length ? 'open' : ''}><summary>Paste a list instead</summary>
      <form data-form="paste"><label class="field">One per line. Put objectives under their outcome, indented or starting with a., 1.1, or a dash.<textarea name="list" class="tall" placeholder="1. Students will use critical thinking to recognize the rigorous standards of scientific theories by:
   a. describing the steps and principles involved in the scientific method.
   b. evaluating different methods of measurement of natural phenomena.
2. Students will analyze and synthesize earth science data by:
   a. ..."></textarea></label>
      <button class="btn primary">${ws.outcomes.length ? 'Replace my list with this' : 'Add these'}</button></form></details>
  </section>
  <section class="panel"><div class="stephead"><span class="stepnum">3</span><h2>Assessments</h2></div>
    <p class="muted">Paste the complete instructions students see, plus the rubric if you have one. Claude judges only what is written.</p>
    ${ui.editing ? assessmentForm() : ''}
    <div class="alist">${ws.assignments.map(a => `<div class="aitem"><div><h3>${esc(a.title)}</h3><p>${a.module !== '' ? `Module ${esc(a.module)} · ` : ''}${esc(a.type || 'Assessment')} · ${(a.instructions || '').length.toLocaleString()} characters of instructions${a.rubric ? ' + rubric' : ''}</p><p style="margin-top:6px">${reviewStatus(a)}</p>${ui.errors[a.id] ? `<p class="status err" style="margin-top:6px;border-radius:7px">${esc(ui.errors[a.id])}</p>` : ''}</div><div class="actions"><button class="btn small" data-action="edit" data-id="${a.id}">Edit</button><button class="btn small primary" data-action="review" data-id="${a.id}" ${ui.reviewing.has(a.id) || !canSaveOnline() ? 'disabled' : ''}>${a.review ? 'Rerun review' : 'Run review'}</button>${a.review ? `<a class="btn small" href="#assignment-${a.id}">See results</a>` : ''}</div></div>`).join('') || '<p class="empty">No assessments yet.</p>'}</div>
    ${ui.editing ? '' : '<div class="formfoot"><button class="btn primary" data-action="new-assessment">+ Add an assessment</button></div>'}
  </section>
  <section class="panel"><div class="stephead"><span class="stepnum">4</span><h2>Run Claude’s review</h2></div>
    ${health?.accessCodeRequired ? `<form class="inline-form" data-form="code"><label class="field">Faculty access code <span class="hint">From your instructional design team. Remembered on this computer.</span><input id="access-code" name="code" type="password" value="${esc(accessCode())}" autocomplete="off"></label><button class="btn">Save code</button></form>` : ''}
    <p style="margin-top:16px">Each review takes one to three minutes. You can keep working while it runs, but keep this page open.</p>
    <div class="lead-actions"><button class="btn primary" data-action="review-all" ${!canSaveOnline() || !ws.assignments.length ? 'disabled' : ''}>Review every assessment that needs it</button><a class="btn" href="#overview">See the big picture →</a></div>
  </section>
  <section class="panel"><h2>Keep a copy</h2><p class="muted">Your dashboard saves online when the review service is connected, and always in this browser. A backup file lets you move it anywhere.</p><div class="lead-actions"><button class="btn" data-action="export">Download backup file</button><button class="btn" data-action="import">Load backup file</button><button class="btn danger" data-action="new">Start a new dashboard</button></div></section>`;
}
function outcomeRow(o) {
  return `<div class="row${o.parent ? ' child' : ''}"><input aria-label="ID" value="${esc(o.id)}" disabled><textarea aria-label="Wording for ${esc(o.id)}" data-outcome="${esc(o.id)}" rows="1">${esc(o.text)}</textarea><button class="iconbtn" title="Remove ${esc(o.id)}" aria-label="Remove ${esc(o.id)}" data-action="remove-outcome" data-id="${esc(o.id)}">✕</button></div>`;
}
function assessmentForm() {
  const a = ui.editing === 'new' ? { id: '', module: '', title: '', type: '', points: '', instructions: '', rubric: '', delivery: DELIVERY[0], deliveryNotes: '', permission: null } : ws.assignments.find(x => x.id === ui.editing);
  if (!a) return '';
  return `<form class="panel" data-form="assessment" style="background:var(--soft)">
    <h3>${a.id ? 'Edit assessment' : 'New assessment'}</h3>
    <div class="fieldrow">
      <label class="field">Title<input name="title" required value="${esc(a.title)}"></label>
      <label class="field">Module or week<input name="module" value="${esc(a.module)}" inputmode="numeric"></label>
      <label class="field">Type<select name="type"><option value="">Choose</option>${TYPES.map(t => `<option ${a.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field">Points <span class="hint">Optional</span><input name="points" value="${esc(a.points ?? '')}"></label>
    </div>
    <label class="field">Full instructions students see<textarea name="instructions" class="tall" required>${esc(a.instructions)}</textarea></label>
    <label class="field">Rubric or grading criteria <span class="hint">Optional, but it makes ratings of 5 possible</span><textarea name="rubric">${esc(a.rubric)}</textarea></label>
    <div class="fieldrow">
      <label class="field">How students complete it<select name="delivery">${DELIVERY.map(d => `<option ${a.delivery === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="field">Your AI policy for it <span class="hint">AI Assessment Scale, optional</span><select name="permission"><option value="">Not set</option>${AIAS.map((l, i) => `<option value="${i + 1}" ${a.permission === i + 1 ? 'selected' : ''}>Level ${i + 1}: ${l}</option>`).join('')}</select></label>
    </div>
    <label class="field">Delivery details <span class="hint">Optional, for example “students present findings live in class”</span><input name="deliveryNotes" value="${esc(a.deliveryNotes)}"></label>
    <div class="formfoot"><div class="lead-actions" style="margin:0"><button class="btn primary">Save assessment</button><button type="button" class="btn" data-action="cancel-edit">Cancel</button></div>${a.id ? `<button type="button" class="btn danger" data-action="delete" data-id="${a.id}">Delete</button>` : ''}</div>
  </form>`;
}
function serviceLine() {
  if (API === null) return `<div class="notice"><strong>Claude reviews are not connected on this page yet.</strong> You can still build and save your dashboard in this browser. The site owner connects the Render service in <code>config.js</code>.</div>`;
  if (!health) return `<div class="notice"><span class="spinner" aria-hidden="true"></span> Connecting to the review service. If it has been asleep this can take up to a minute.</div>`;
  if (!health.ok) return `<div class="notice"><strong>The review service could not be reached.</strong> ${esc(health.error || '')} <button class="textbutton" data-action="retry-health">Try again</button></div>`;
  if (!health.claudeConnected) return `<div class="notice"><strong>The service is running, but Claude is not connected yet.</strong> The site owner needs to add the Anthropic API key in Render.</div>`;
  return '';
}

function overviewView() {
  if (!reviewed().length) return heading('Course review', courseName(), '') + serviceLine() + emptyState(ws.assignments.length ? 'No assessment has been reviewed yet. Run Claude’s review in step 4.' : 'Add your outcomes and assessments to see the big picture.');
  const L = leaves();
  const strong = L.filter(o => best(o.id) >= 4), unknown = L.filter(o => best(o.id) == null), weak = L.filter(o => best(o.id) != null && best(o.id) < 4);
  const vulnerable = reviewed().filter(a => a.review.ai.armsLevel >= 4);
  const all = reviewed().flatMap(a => a.review.alignment);
  const twice = reviewed().filter(a => a.review.reliability?.passes > 1);
  const agreePct = twice.length ? Math.round(100 * twice.flatMap(a => a.review.alignment).filter(x => x.agreement === 'agreed').length / twice.flatMap(a => a.review.alignment).length) : null;
  const lowered = all.filter(x => x.note).length;
  const noPolicy = ws.assignments.filter(a => !a.permission).length;
  return heading(`${ws.assignments.length} assessments · ${L.length} objectives`, courseName(), `This dashboard shows how well each assessment requires students to demonstrate the course’s learning objectives, using the <strong>Quality Matters Rubric</strong>, and how easily AI could complete the work, using the <strong>AI Risk Measure Scale (ARMS)</strong>.`) + notice + `
  <h2>The big picture</h2>
  <div class="stats">
    <a class="stat" href="#assignments"><strong>${reviewed().length}<span> / ${ws.assignments.length}</span></strong><b>Assessments reviewed</b><p>${ws.assignments.length - reviewed().length ? `${ws.assignments.length - reviewed().length} still to review.` : 'Every assessment has a review.'}</p></a>
    <a class="stat" href="#outcomes"><strong>${strong.length}<span> / ${L.length}</span></strong><b>Objectives strongly supported</b><p>At least one assessment rated 4 or 5.</p></a>
    <a class="stat" href="#outcomes"><strong>${weak.length + unknown.length}</strong><b>Objectives need attention</b><p>${weak.length} only weakly assessed; ${unknown.length} not assessed by any reviewed assessment.</p></a>
    <a class="stat" href="#assignments"><strong>${vulnerable.length}<span> / ${reviewed().length}</span></strong><b>Assessments vulnerable to AI</b><p>ARMS high or very high risk.</p></a>
  </div>
  <div class="split"><section class="panel"><div class="panelhead"><div><h2>Where learning is supported</h2><p>Each segment is one objective; filled means an assessment rates 4 or 5 for it.</p></div></div>
    ${parents().map(p => { const kids = childrenOf(p.id).length ? childrenOf(p.id) : [p]; const n = kids.filter(c => best(c.id) >= 4).length; return `<a class="coverage" href="#outcomes" style="text-decoration:none;color:inherit"><span class="circle">${esc(p.id)}</span><span><span class="covername">${esc(p.text)}</span><span class="segments" aria-hidden="true">${kids.map(c => `<span class="${best(c.id) >= 4 ? 'strong' : ''}"></span>`).join('')}</span></span><span class="covercount">${n}/${kids.length}</span></a>`; }).join('')}
    <p class="small muted" style="margin:20px 0 0">Counts describe assessment design, not student mastery.</p></section>
  <section class="panel"><p class="eyebrow">Where to start</p><h2>Three places to look</h2>
    <div class="focusitem"><h3>1. Objectives without strong evidence</h3><p>${weak.length + unknown.length ? `${weak.length + unknown.length} objectives have no assessment rated 4 or 5${unknown.length ? `, including ${unknown.length} with no reviewed assessment at all` : ''}.` : 'Every objective has at least one strong assessment.'}</p><a href="#outcomes">See each objective’s evidence →</a></div>
    <div class="focusitem"><h3>2. Work AI could easily complete</h3><p>${vulnerable.length ? `${vulnerable.length} assessments are high or very high risk. Each has a practical change to try.` : 'No reviewed assessment is high risk.'}</p><a href="#assignments">See suggestions for each assessment →</a></div>
    <div class="focusitem"><h3>3. Decide what AI use is allowed</h3><p>${noPolicy ? `${noPolicy} assessments have no AI policy set. Claude suggests a level for each.` : 'Every assessment has an AI policy.'}</p><a href="#build">Set policies in your workspace →</a></div>
  </section></div>
  <section class="panel"><h2>How reliable are these ratings?</h2><dl class="kv">
    <dt>Independent reviews</dt><dd>${twice.length ? `Claude reviewed ${twice.length} of ${reviewed().length} assessments twice, separately. When the two disagree, the lower alignment and the higher AI risk are shown.` : 'Each assessment was reviewed once.'}</dd>
    ${agreePct != null ? `<dt>Agreement</dt><dd>The two reviews gave the same alignment score ${agreePct}% of the time${agreePct < 80 ? '; check the ratings marked “reviews differed”' : ''}.</dd>` : ''}
    <dt>Evidence check</dt><dd>${lowered ? `${lowered} ratings were lowered to 1 because Claude could not quote instructions that support them.` : 'Every rating above 1 is backed by a quotation found in the instructions.'}</dd>
  </dl></section>
  ${modules().length ? `<section class="panel"><div class="panelhead"><div><h2>Explore a module</h2></div></div><div class="modulegrid">${modules().map(m => `<a class="modulecard" href="#assignments" data-module="${esc(m)}"><b>Module ${esc(m)} ↗</b><p>${ws.assignments.filter(a => String(a.module) === String(m)).length} assessments</p></a>`).join('')}</div></section>` : ''}`;
}
const courseName = () => [ws.course.code, ws.course.title].filter(Boolean).join(' · ') || 'Your course';

function matrixView() {
  if (!ws.outcomes.length || !ws.assignments.length) return heading('Compare assessments', 'Alignment grid', '') + emptyState('Add outcomes and assessments to see the grid.');
  const as = filtered();
  const rows = ws.outcomes.filter(o => ui.outcome === 'all' || o.id === ui.outcome || o.parent === ui.outcome);
  return heading('Compare assessments', 'Alignment grid', 'Outcomes and objectives run down the side; assessments run across the top. Select any rating to read Claude’s reason and the quoted evidence.') + notice + `
  <div class="filters">${moduleSelect()}<label>Outcome<select data-filter="outcome"><option value="all">All outcomes</option>${parents().map(p => `<option value="${esc(p.id)}" ${ui.outcome === p.id ? 'selected' : ''}>Outcome ${esc(p.id)}</option>`).join('')}</select></label></div>
  <div class="legend">${SCALE.map(s => chip(s.value)).join('')}${chip(null)}</div>
  <div class="tablewrap"><table class="matrix"><thead><tr><th scope="col">Outcomes and objectives</th>${as.map(a => `<th scope="col"><a class="colbtn" href="#assignment-${a.id}">${esc(a.title)}${a.module !== '' ? `<span>Module ${esc(a.module)}</span>` : ''}</a></th>`).join('')}</tr></thead><tbody>
  ${rows.map(o => `<tr class="${o.parent ? '' : 'parent'}"><th scope="row"><span class="outbtn"><b>${o.parent ? 'Objective' : 'Outcome'} ${esc(o.id)}</b>${esc(o.text)}</span></th>${as.map(a => { const r = rating(a, o.id); return `<td>${r.score ? `<button class="rating r${r.score}${r.adjusted ? ' adjusted' : ''}" data-cell="${a.id}|${esc(o.id)}" aria-label="${esc(`${a.title}, ${o.id}: ${r.score} ${scaleLabel(r.score)}. Open evidence.`)}"><b>${r.score}</b>${esc(scaleLabel(r.score))}${r.item && r.item.agreement === 'differed' ? '<span class="agree warn">reviews differed</span>' : ''}</button>` : '<span class="muted small">Not yet reviewed</span>'}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div>
  <p class="small muted" style="margin-top:14px">A dashed outline means a faculty member adjusted Claude’s rating.</p>`;
}

function outcomesView() {
  if (!ws.outcomes.length) return heading('Learning outcomes', 'Outcome coverage', '') + emptyState('Add your learning outcomes to see coverage.');
  const row = o => { const scored = ws.assignments.map(a => ({ a, r: rating(a, o.id) })).filter(x => x.r.score).sort((x, y) => y.r.score - x.r.score); return `<div class="objectiverow"><div><strong>${o.parent ? 'Objective' : 'Outcome'} ${esc(o.id)}</strong> ${esc(o.text)}<p>${scored.length ? scored.slice(0, 6).map(x => `<button class="textbutton" data-cell="${x.a.id}|${esc(o.id)}">${esc(x.a.title)}</button> (${x.r.score})`).join(' · ') : 'No reviewed assessment yet.'}</p></div>${chip(best(o.id))}</div>`; };
  return heading('Learning outcomes', 'Outcome coverage', 'Each objective shows its strongest assessment rating and the assessments that address it, strongest first.') + notice + `<div class="outlist">${parents().map(p => `<section class="outgroup"><h3>Outcome ${esc(p.id)}: ${esc(p.text)}</h3>${row(p)}${childrenOf(p.id).map(row).join('')}</section>`).join('')}</div>`;
}

function card(a) {
  return `<article class="assessment"><span class="badge">${a.module !== '' ? `Module ${esc(a.module)} · ` : ''}${esc(a.type || 'Assessment')}${a.points ? ` · ${esc(a.points)} points` : ''}</span><h3>${esc(a.title)}</h3><p class="summary">${esc(a.review?.summary || (a.instructions || '').slice(0, 180))}</p>
  ${a.review ? `${ring(a)}<p><strong>Why:</strong> ${esc(a.review.ai.reason)}</p><p class="recommendation"><strong>Try this:</strong> ${esc(a.review.ai.suggestion)}</p>${permissionBadge(a)}${aiasBox(a)}` : `<p>${reviewStatus(a)}</p>`}
  <div class="lead-actions" style="margin:15px 0 0">${a.review ? `<a class="btn primary" href="#assignment-${a.id}">View ratings and evidence →</a>` : `<button class="btn primary" data-action="review" data-id="${a.id}" ${ui.reviewing.has(a.id) || !canSaveOnline() ? 'disabled' : ''}>Run review</button>`}${isStale(a) ? `<button class="btn" data-action="review" data-id="${a.id}">Rerun review</button>` : ''}</div></article>`;
}
function assignmentsView() {
  if (!ws.assignments.length) return heading('Assessment review', 'Explore the assessments', '') + emptyState('Add an assessment to begin.');
  const q = ui.search.toLowerCase();
  const as = filtered().filter(a => !q || `${a.title} ${a.instructions}`.toLowerCase().includes(q));
  const groups = modules().length ? [...new Set(as.map(a => a.module))] : [''];
  return heading('Assessment review', 'Explore the assessments', 'The ring shows how easily AI could produce the work; the AI permission badge shows what the instructor allows.') + notice + `<div class="filters">${moduleSelect()}<label>Find an assessment<input id="search" type="search" placeholder="Search title or instructions" value="${esc(ui.search)}"></label></div><p class="muted" role="status">${as.length} assessments shown.</p>${groups.map(m => `${m !== '' ? `<h2 class="modulehead">Module ${esc(m)}</h2>` : ''}<div class="assignments">${as.filter(a => m === '' || a.module === m).map(card).join('')}</div>`).join('')}`;
}
function connection(a, o, { withOverride = true } = {}) {
  const r = rating(a, o.id), it = r.item;
  if (!it) return `<div class="reasonrow"><h3>${esc(o.id)} · ${esc(o.text)}</h3><p>${chip(null)}</p></div>`;
  return `<div class="reasonrow"><h3>${o.parent ? 'Objective' : 'Outcome'} ${esc(o.id)}: ${esc(o.text)}</h3><p>${chip(r.score, { adjusted: r.adjusted })}${r.adjusted ? ` <span class="muted small">Faculty adjusted · Claude rated ${it.score}</span>` : ''}</p>
  <dl class="kv"><dt>Objective asks</dt><dd>${esc(it.objectiveAction)}</dd><dt>Instructions require</dt><dd>${esc(it.requiredAction)}</dd></dl>
  <p><strong>Reason:</strong> ${esc(it.reason)}</p>
  ${it.evidence.length ? it.evidence.map(q => `<blockquote>“${esc(q)}”</blockquote>`).join('') : '<p class="small muted">No supporting passage in the instructions.</p>'}
  ${it.note ? `<p class="small notice">${esc(it.note)}</p>` : ''}
  ${it.agreement && it.agreement !== 'single' && it.agreement !== 'agreed' ? `<p class="small ${it.agreement === 'differed' ? 'notice' : 'muted'}">The two independent reviews scored this ${it.passScores.join(' and ')}; the lower score is shown.</p>` : ''}
  <p class="recommendation"><strong>To strengthen:</strong> ${esc(it.improvement)}</p>
  ${withOverride ? `<label class="field" style="max-width:340px;margin-top:12px">Your rating<select data-override="${a.id}|${esc(o.id)}"><option value="">Use Claude’s rating (${it.score})</option>${SCALE.map(s => `<option value="${s.value}" ${a.overrides?.[o.id] === s.value ? 'selected' : ''}>${s.value} ${s.label}</option>`).join('')}</select></label>` : ''}</div>`;
}
function assignmentView(id) {
  const a = ws.assignments.find(x => x.id === id);
  if (!a) return heading('Assessment', 'Not found', '') + emptyState('That assessment is not in this dashboard.');
  const R = a.review;
  return `<a class="back" href="#assignments">← All assessments</a>` + heading(`${a.module !== '' ? `Module ${a.module} · ` : ''}${a.type || 'Assessment'}`, a.title, esc(R?.summary || '')) + notice + (isStale(a) ? `<div class="notice">These instructions or objectives changed after the review. <button class="textbutton" data-action="review" data-id="${a.id}">Rerun the review</button></div>` : '') +
  (!R ? `<div class="panel"><p>${reviewStatus(a)}</p>${ui.errors[a.id] ? `<p class="status err">${esc(ui.errors[a.id])}</p>` : ''}<button class="btn primary" data-action="review" data-id="${a.id}" ${ui.reviewing.has(a.id) || !canSaveOnline() ? 'disabled' : ''}>Run review</button></div>` : `
  <div class="split"><section class="panel"><h2>AI vulnerability and permission</h2>${ring(a)}
    <p><strong>Why:</strong> ${esc(R.ai.reason)}</p>
    <dl class="kv"><dt>How easily AI could produce it</dt><dd>${esc(R.ai.productionEase)}</dd><dt>Effect on quality or originality</dt><dd>${esc(R.ai.qualityImpact)}</dd><dt>Assumed delivery</dt><dd>${esc(R.ai.assumptions)}</dd></dl>
    <p class="recommendation"><strong>Try this:</strong> ${esc(R.ai.suggestion)}</p>
    ${R.ai.resilienceSteps.length ? `<ul>${R.ai.resilienceSteps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${permissionBadge(a)}${aiasBox(a)}</section>
  <section class="panel"><h2>What the instructions require</h2><ul>${R.requiredWork.map(e => `<li>${esc(e)}</li>`).join('')}</ul><p class="small muted">${esc(R.limits)}</p><p class="small muted">Reviewed ${new Date(R.reviewedAt).toLocaleString()} by Claude${R.reliability?.passes > 1 ? `, twice independently (${R.reliability.alignmentAgreement}% of scores matched)` : ''}.</p><div class="lead-actions"><button class="btn" data-action="edit" data-id="${a.id}">Edit instructions</button><button class="btn" data-action="review" data-id="${a.id}" ${ui.reviewing.has(a.id) ? 'disabled' : ''}>Rerun review</button></div></section></div>
  <section class="panel"><h2>Alignment with each objective</h2><p class="muted">Highest ratings first. Every rating above 1 quotes the instructions that support it.</p>
  ${[...ws.outcomes].sort((x, y) => (rating(a, y.id).score || 0) - (rating(a, x.id).score || 0)).map(o => connection(a, o)).join('')}</section>`);
}

function helpView() {
  return heading('A guide for faculty', 'How to read this page', 'The ratings are a starting point for conversation about the work students are asked to do. They are not final decisions or measures of student achievement.') + `
  <section class="panel"><h2>Three different questions</h2><div class="helpgrid">
    <div><h3>Does the assessment match the objective?</h3><p>The 1–5 alignment rating describes whether the required student work demonstrates the objective, following Quality Matters Standard 3.1 (assessments measure the stated objectives), with 2.1, 2.4 and 3.3 informing the reasoning. If the instructions do not actually require what the objective states, the rating is 1, No alignment, even when the topic matches.</p></div>
    <div><h3>Could AI do the work?</h3><p>The ring shows the ARMS level: how easily AI could produce the submitted work and how much that would affect its quality or originality. A fuller ring means more resilient. Delivery matters, so tell Claude how each assessment is completed.</p></div>
    <div><h3>Is AI use allowed?</h3><p>The permission badge is the instructor’s choice on the AI Assessment Scale. Claude suggests a level, but only the instructor sets it.</p></div>
    <div><h3>What makes the ratings reliable?</h3><p>Claude reviews each assessment twice, separately. If the reviews disagree, the dashboard shows the lower alignment and higher AI risk and marks it. Any rating above 1 must quote the instructions; the service checks each quotation against the text you pasted and lowers the rating to 1 if the quotation is not there.</p></div>
  </div></section>
  <section class="panel"><h2>Alignment scale</h2>${SCALE.map(s => `<p>${chip(s.value)} ${esc(s.description)}</p>`).join('')}<p class="small muted">This 1–5 display summarizes a Quality Matters–informed judgment. It is not an official QM score or a formal QM review.</p></section>
  <section class="panel"><h2>AI Risk Measure Scale (ARMS)</h2><p>De Vita and Brown, University of Greenwich (2023), as presented by the University of Suffolk. Descriptions are paraphrased.</p><div class="tablewrap" style="max-height:none"><table class="matrix"><thead><tr><th scope="col">ARMS level</th><th scope="col">Dashboard label</th><th scope="col">Ring fill</th><th scope="col">Meaning</th></tr></thead><tbody>${ARMS.map(l => `<tr><th scope="row">${l.level} · ${esc(l.risk)}</th><td>${esc(l.resilience)}</td><td>${(6 - l.level) * 20}%</td><td style="text-align:left">${esc(l.description)}</td></tr>`).join('')}</tbody></table></div><p class="small" style="margin-top:14px">ARMS levels describe the assessment design, not a prediction that students will cheat.</p></section>
  <section class="panel"><h2>AI Assessment Scale (permission)</h2><ol>${AIAS.map(l => `<li>${esc(l)}</li>`).join('')}</ol><p class="small muted">Perkins, Furze, Roe and MacVaugh (2024).</p></section>
  <section class="panel"><h2>Saving and coming back</h2><p>Your dashboard saves automatically. When the review service is connected it saves online and gives you a private resume link; anyone with the link can open and edit the dashboard, so share it only with colleagues. A copy is also kept in this browser, and you can download a backup file at any time.</p></section>
  <section class="panel"><h2>Sources</h2><ul class="sources">
    <li><a href="https://www.qualitymatters.org/sites/default/files/PDFs/StandardsfromtheQMHigherEducationRubric.pdf">Quality Matters Higher Education Rubric, Seventh Edition: Specific Review Standards</a></li>
    <li><a href="https://libguides.uos.ac.uk/celt/course-design/Assessment_AI">University of Suffolk: AI resilience in assessment (ARMS table)</a></li>
    <li><a href="https://www.aacsb.edu/insights/articles/2024/10/can-that-assignment-be-completed-with-genai">De Vita and Brown: Can that assignment be completed with GenAI?</a></li>
    <li><a href="https://open-publishing.org/journals/index.php/jutlp/article/download/810/769/1205">Perkins et al. (2024): The AI Assessment Scale</a></li>
  </ul></section>`;
}

// ---------- dialog, print, sidebar ----------
function showCell(aid, oid) {
  const a = ws.assignments.find(x => x.id === aid), o = outcomeOf(oid);
  if (!a || !o) return;
  $('#dialog-title').textContent = a.title;
  $('#dialog-body').innerHTML = connection(a, o) + `<p><a href="#assignment-${a.id}" data-action="close-dialog">Open the full assessment review →</a></p>`;
  $('#dialog').showModal();
}
function buildPrint() {
  $('#print-report').innerHTML = `<h1>${esc(courseName())}: alignment and AI vulnerability</h1><p>Printed ${new Date().toLocaleDateString()}. Ratings are Claude’s suggestions for faculty review.</p>
  <h2>Outcomes and objectives</h2><ul>${ws.outcomes.map(o => `<li>${esc(o.id)} ${esc(o.text)}</li>`).join('')}</ul>
  ${ws.assignments.map(a => { const R = a.review, l = armsInfo(R?.ai.armsLevel); return `<article class="print-assessment"><h2>${a.module !== '' ? `Module ${esc(a.module)}: ` : ''}${esc(a.title)}</h2>${R ? `<p>${esc(R.summary)}</p><h3>AI vulnerability: ARMS ${R.ai.armsLevel} · ${esc(l.risk)} risk (${esc(l.resilience)})</h3><p>${esc(R.ai.reason)}</p><p><strong>Try this:</strong> ${esc(R.ai.suggestion)}</p><p><strong>AI permission:</strong> ${a.permission ? `Level ${a.permission}: ${esc(AIAS[a.permission - 1])}` : 'Not set by instructor'}</p><h3>Alignment</h3>${ws.outcomes.map(o => { const r = rating(a, o.id); return r.item ? `<div class="print-rating"><strong>${esc(o.id)}: ${r.score} ${esc(scaleLabel(r.score))}${r.adjusted ? ' (faculty adjusted)' : ''}</strong><p>${esc(r.item.reason)}</p>${r.item.evidence.length ? `<p><em>Evidence:</em> “${r.item.evidence.map(esc).join('” “')}”</p>` : ''}</div>` : ''; }).join('')}` : '<p>Not yet reviewed.</p>'}</article>`; }).join('')}`;
}
function renderSidebar() {
  $('#side-code').textContent = ws.course.code || 'New course';
  $('#side-title').textContent = ws.course.title || 'Add your course to begin';
  if (ws.course.title || ws.course.code) $('#subbrand').textContent = `Course review · ${ws.course.title || ws.course.code}`;
  document.title = ws.course.code ? `${ws.course.code} Alignment Dashboard` : 'Course Alignment Dashboard';
  const s = ui.saveState;
  const line = !hasContent(ws) ? '<span class="status">Nothing to save yet</span>'
    : s === 'saving' || s === 'pending' ? '<span class="status"><span class="spinner" aria-hidden="true"></span>Saving…</span>'
    : s === 'online' && ws.id ? '<span class="status ok">Saved online</span>'
    : s === 'needs-code' ? '<span class="status warn">Saved in this browser</span>'
    : s === 'error' ? '<span class="status err">Online save failed</span>'
    : '<span class="status">Saved in this browser</span>';
  $('#savebox').innerHTML = `${line}${ui.saveMsg ? `<p class="small">${esc(ui.saveMsg)}</p>` : ''}${s === 'needs-code' ? '<p class="small">Enter the faculty access code in step 4 to save online.</p>' : ''}${ws.id ? `<p class="small">Resume link:</p><code class="codebox">${esc(resumeLink())}</code><button class="btn small" data-action="copy-link">Copy resume link</button>` : ''}${s === 'error' ? '<button class="btn small" data-action="save-now">Try saving again</button>' : ''}`;
}
function render() {
  const route = location.hash.slice(1) || 'build';
  const view = route.startsWith('assignment-') ? assignmentView(route.slice(11))
    : ({ build: buildView, overview: overviewView, matrix: matrixView, outcomes: outcomesView, assignments: assignmentsView, help: helpView }[route] || overviewView)();
  const main = $('#main');
  const keepScroll = window.scrollY;
  main.innerHTML = view + `<footer class="footer"><span>SPC IDEAS · Reviews by Claude · Quality Matters and ARMS frameworks</span><span><a href="#help">How to read this page</a></span></footer>`;
  window.scrollTo(0, keepScroll);
  const navRoute = route.startsWith('assignment-') ? 'assignments' : route;
  document.querySelectorAll('.navlink').forEach(n => { if (n.getAttribute('href') === '#' + navRoute) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
  renderSidebar();
}

// ---------- events ----------
function downloadBackup() {
  const blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${(ws.course.code || 'course').replace(/[^\w-]+/g, '_')}-alignment-dashboard.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importBackup() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    try {
      const doc = JSON.parse(await input.files[0].text());
      if (!Array.isArray(doc.outcomes) || !Array.isArray(doc.assignments)) throw new Error();
      const keepId = ws.id && !hasContent(ws) ? ws.id : null;
      ws = normalizeWorkspace({ ...doc, id: keepId });
      if (!keepId) history.replaceState(null, '', location.pathname + location.hash);
      ui.saveState = 'local'; changed(); toast('Backup loaded.');
    } catch { toast('That file is not a dashboard backup.'); }
  };
  input.click();
}
function openLink(value) {
  const m = String(value).match(/[a-z2-7]{24}/);
  if (!m) return toast('That does not look like a resume link.');
  location.href = `${location.pathname}?d=${m[0]}#overview`;
}

document.addEventListener('click', async e => {
  const cell = e.target.closest('[data-cell]');
  if (cell) { e.preventDefault(); return showCell(...cell.dataset.cell.split('|')); }
  const mod = e.target.closest('[data-module]');
  if (mod) { ui.module = mod.dataset.module; }
  const b = e.target.closest('[data-action]'); if (!b) return;
  const { action, id } = b.dataset;
  if (b.tagName === 'BUTTON') e.preventDefault();
  if (action === 'close-dialog') { $('#dialog').close(); if (b.tagName === 'A') location.hash = b.getAttribute('href'); return; }
  if (action === 'theme') { const dark = document.documentElement.dataset.theme !== 'dark' && !(document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; store.set('theme', document.documentElement.dataset.theme); return syncThemeButton(); }
  if (action === 'print') { buildPrint(); return window.print(); }
  if (action === 'copy-link') { try { await navigator.clipboard.writeText(resumeLink()); toast('Resume link copied. Bookmark it or keep it somewhere safe.'); } catch { toast('Copy the link shown above.'); } return; }
  if (action === 'save-now') return saveRemote();
  if (action === 'retry-health') { health = null; render(); try { health = await api('/api/health', {}, 70000); } catch (err) { health = { ok: false, error: err.message }; } if (canSaveOnline() && hasContent(ws)) saveRemote(); return render(); }
  if (action === 'focus-course') return $('[data-course="code"]')?.focus();
  if (action === 'load-example') {
    try { const ex = await (await fetch('example.json')).json(); ws = normalizeWorkspace(ex); history.replaceState(null, '', location.pathname + '#build'); changed(); toast('Example loaded. Run a review to see Claude’s ratings.'); } catch { toast('The example could not be loaded.'); }
    return;
  }
  if (action === 'add-outcome') { const n = parents().length + 1; ws.outcomes.push({ id: String(n), text: '', parent: null }); renumber(); return changed(); }
  if (action === 'add-objective') { ws.outcomes.push({ id: `${id}.${childrenOf(id).length + 1}`, text: '', parent: id }); renumber(); return changed(); }
  if (action === 'remove-outcome') {
    const o = outcomeOf(id); if (!o) return;
    if ((o.text || childrenOf(id).length) && !confirm(`Remove ${o.parent ? 'objective' : 'outcome'} ${id}${childrenOf(id).length ? ' and its objectives' : ''}?`)) return;
    ws.outcomes = ws.outcomes.filter(x => x.id !== id && x.parent !== id); renumber(); return changed();
  }
  if (action === 'new-assessment') { ui.editing = 'new'; render(); return $('[data-form="assessment"] [name="title"]')?.focus(); }
  if (action === 'edit') { ui.editing = id; location.hash = '#build'; render(); return $('[data-form="assessment"]')?.scrollIntoView({ block: 'start' }); }
  if (action === 'cancel-edit') { ui.editing = null; return render(); }
  if (action === 'delete') { const a = ws.assignments.find(x => x.id === id); if (a && confirm(`Delete “${a.title}” and its review?`)) { ws.assignments = ws.assignments.filter(x => x.id !== id); ui.editing = null; changed(); } return; }
  if (action === 'review') return runReview(id);
  if (action === 'review-all') return reviewAll();
  if (action === 'export') return downloadBackup();
  if (action === 'import') return importBackup();
  if (action === 'new') {
    if (hasContent(ws) && !confirm('Start a new, empty dashboard? Your current one stays saved' + (ws.id ? ' at its resume link.' : ' only if you download a backup first.'))) return;
    ws = emptyWorkspace(); ui.saveState = 'local'; ui.saveMsg = ''; ui.editing = null; store.del('current');
    history.replaceState(null, '', location.pathname + '#build'); return render();
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]'); if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const kind = form.dataset.form;
  if (kind === 'open') return openLink(f.link);
  if (kind === 'code') { store.set('accessCode', f.code.trim()); toast('Access code saved on this computer.'); if (canSaveOnline() && hasContent(ws)) saveRemote(); return render(); }
  if (kind === 'paste') {
    const list = parseOutcomes(f.list || ''); if (!list.length) return toast('Paste at least one outcome.');
    if (ws.outcomes.length && !confirm('Replace your current outcomes and objectives with this list? Existing reviews will need to be rerun.')) return;
    ws.outcomes = list; ui.pasteOpen = false; changed(); return toast(`${ws.outcomes.length} outcomes and objectives added.`);
  }
  if (kind === 'assessment') {
    if ((f.instructions || '').trim().length < 40) return toast('Paste the full instructions (at least a few sentences).');
    const fields = { title: f.title.trim(), module: f.module.trim() === '' ? '' : (Number(f.module) || f.module.trim()), type: f.type, points: f.points.trim(), instructions: f.instructions.trim(), rubric: f.rubric.trim(), delivery: f.delivery, deliveryNotes: f.deliveryNotes.trim(), permission: f.permission ? Number(f.permission) : null };
    if (ui.editing === 'new') ws.assignments.push({ id: uid(), review: null, overrides: {}, ...fields });
    else Object.assign(ws.assignments.find(x => x.id === ui.editing), fields);
    ui.editing = null; changed(); toast('Assessment saved.');
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.course) { ws.course[t.dataset.course] = t.value; changed({ rerender: false }); }
  else if (t.dataset.outcome) { const o = outcomeOf(t.dataset.outcome); if (o) { o.text = t.value; changed({ rerender: false }); } }
  else if (t.id === 'search') { ui.search = t.value; const pos = t.selectionStart; render(); const s = $('#search'); s.focus(); s.setSelectionRange(pos, pos); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.filter) { ui[t.dataset.filter] = t.value; render(); }
  if (t.dataset.override) {
    const [aid, oid] = t.dataset.override.split('|'); const a = ws.assignments.find(x => x.id === aid);
    if (!a) return; if (t.value) a.overrides[oid] = Number(t.value); else delete a.overrides[oid];
    const inDialog = $('#dialog').open; changed(); if (inDialog) showCell(aid, oid);
  }
});
window.addEventListener('hashchange', () => { if ($('#dialog').open) $('#dialog').close(); render(); window.scrollTo(0, 0); });
window.addEventListener('beforeunload', e => { if (ui.reviewing.size) { e.preventDefault(); e.returnValue = ''; } });

function syncThemeButton() {
  const t = document.documentElement.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('[data-action="theme"]').forEach(b => { b.textContent = dark ? 'Use light mode' : 'Use dark mode'; });
}
if (store.get('theme')) document.documentElement.dataset.theme = store.get('theme');
syncThemeButton();
render();
loadInitial();
