/* Core-Satellite Portfolio Dashboard — vanilla JS, no build step.
 * Reads only local files: data/*.json and commentary.md.
 * Never calls market-data or AI APIs from the browser. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ utils
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtUSD = (v, d = 2) => v == null || isNaN(v) ? "–" : v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = (v, d = 2, sign = true) => v == null || isNaN(v) ? "–" : (sign && v > 0 ? "+" : "") + v.toFixed(d) + "%";
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const ET = "America/New_York";
  const fmtET = (iso) => {
    if (!iso) return "–";
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleString("en-US", { timeZone: ET, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  };
  const fmtDate = (ymd) => {
    if (!ymd) return "–";
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", year: "numeric", month: "short", day: "numeric" });
  };

  async function getJSON(path) {
    try {
      const r = await fetch(path, { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  async function getText(path) {
    try {
      const r = await fetch(path, { cache: "no-store" });
      return r.ok ? await r.text() : null;
    } catch (e) { return null; }
  }

  // --------------------------------------------------------- NYSE calendar
  // Keep in sync with scripts/marketcal.py
  const HOLIDAYS = new Set([
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
  ]);
  function etParts(date) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(date).map((x) => [x.type, x.value]));
    return { ymd: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  }
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }
  function isTradingDay(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd !== 0 && wd !== 6 && !HOLIDAYS.has(ymd);
  }
  function prevTradingDay(ymd) { let d = addDays(ymd, -1); while (!isTradingDay(d)) d = addDays(d, -1); return d; }
  /** Market state now: latest session that has *started* and latest *completed* session. */
  function marketClock(now = new Date()) {
    const { ymd, minutes } = etParts(now);
    const trading = isTradingDay(ymd);
    const open = trading && minutes >= 570 && minutes < 960;
    const lastCompleted = trading && minutes >= 960 ? ymd : prevTradingDay(ymd);
    const currentSession = trading && minutes >= 570 ? ymd : lastCompleted;
    return { ymd, minutes, open, lastCompleted, currentSession };
  }

  // ------------------------------------------------------------- theming
  function initTheme() {
    const btn = $("#themeToggle");
    const label = () => {
      const t = document.documentElement.getAttribute("data-theme");
      btn.textContent = "Theme: " + (t || "auto");
    };
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === null ? "dark" : cur === "dark" ? "light" : null;
      if (next) document.documentElement.setAttribute("data-theme", next);
      else document.documentElement.removeAttribute("data-theme");
      try { next ? localStorage.setItem("theme", next) : localStorage.removeItem("theme"); } catch (e) {}
      label();
      redrawCharts();
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", redrawCharts);
    label();
  }
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const PALETTE = ["#2f6fdf", "#e07b39", "#2f9e72", "#b5487a", "#7a5cd6", "#c9a227", "#3aa6b9", "#d1495b", "#6c8f3c", "#8d6e63", "#5b7083", "#a855f7"];

  // ------------------------------------------------------------ state
  const S = { charts: {}, range: "1Y" };

  // ------------------------------------------------------------- load
  async function load() {
    const [holdings, livePrices, liveHistory, livePreds, status, commentary] = await Promise.all([
      getJSON("data/holdings.json"), getJSON("data/prices.json"), getJSON("data/history.json"),
      getJSON("data/predictions.json"), getJSON("data/refresh-status.json"), getText("commentary.md"),
    ]);
    const tickers = holdings.holdings.map((h) => h.ticker);
    const bench = holdings.portfolio.rules.benchmark.proxy_ticker;
    const liveOk = livePrices?.data_status === "live" && liveHistory?.data_status === "live" &&
      [...tickers, bench].every((t) => livePrices.quotes?.[t] && liveHistory.series?.[t]?.length);

    let mode = "live", prices = livePrices, history = liveHistory, preds = livePreds, reason = "";
    if (!liveOk) {
      mode = "sample";
      reason = !livePrices ? "No live price file yet (data/prices.json)." :
        !liveHistory ? "No live price history yet (data/history.json)." :
        "Live data is incomplete for one or more holdings.";
      [prices, history, preds] = await Promise.all([
        getJSON("data/sample/prices.sample.json"), getJSON("data/sample/history.sample.json"), getJSON("data/sample/predictions.sample.json"),
      ]);
    }
    Object.assign(S, { holdings, prices, history, preds: preds || { batches: [], evaluations: {} }, status, commentary, mode, reason, bench });
  }

  // ------------------------------------------------------- calculations
  function seriesMap(t) { return new Map(S.history.series[t] || []); }
  function closeOnOrAfter(t, ymd) {
    for (const [d, c] of S.history.series[t] || []) if (d >= ymd) return { date: d, close: c };
    return null;
  }

  function compute() {
    const H = S.holdings.holdings;
    const model = S.holdings.portfolio.model;
    const rows = [];
    let total = 0, cost = 0, dayChg = 0, prevTotal = 0, basisNote = "";
    const usesActual = H.every((h) => h.shares != null && h.cost_basis_per_share != null);

    for (const h of H) {
      const q = S.prices.quotes[h.ticker];
      let shares, basis, basisDate = null;
      if (usesActual) { shares = h.shares; basis = h.cost_basis_per_share; }
      else {
        const inc = closeOnOrAfter(h.ticker, model.inception_date);
        if (!inc) throw new Error(`No history for ${h.ticker} on/after inception ${model.inception_date}`);
        basis = inc.close; basisDate = inc.date;
        shares = (model.starting_value * h.target_weight / 100) / basis;
      }
      const value = shares * q.price;
      const prev = q.prev_close != null ? shares * q.prev_close : null;
      total += value; cost += shares * basis;
      if (prev != null) { dayChg += value - prev; prevTotal += prev; }
      rows.push({ h, q, shares, basis, basisDate, value, ret: (q.price / basis - 1) * 100 });
    }
    rows.forEach((r) => { r.weight = (r.value / total) * 100; r.drift = r.weight - r.h.target_weight; });
    basisNote = usesActual ? "Actual shares and cost basis from holdings.json"
      : `Hypothetical ${fmtUSD(model.starting_value, 0)} invested at target weights at the close on ${fmtDate(rows[0].basisDate)}`;

    // Look-through sectors (equity only)
    const sectors = {}; let equity = 0;
    for (const r of rows) {
      if (r.h.asset_class === "Bonds") continue;
      equity += r.value;
      if (r.h.sector_exposure) {
        for (const [s, w] of Object.entries(r.h.sector_exposure.weights_pct)) sectors[s] = (sectors[s] || 0) + r.value * w / 100;
      } else sectors[r.h.sector] = (sectors[r.h.sector] || 0) + r.value;
    }
    const sectorList = Object.entries(sectors).map(([s, v]) => ({ sector: s, pctEquity: v / equity * 100, pctTotal: v / total * 100 }))
      .sort((a, b) => b.pctEquity - a.pctEquity);
    const assets = {};
    rows.forEach((r) => { assets[r.h.asset_class] = (assets[r.h.asset_class] || 0) + r.weight; });

    const sum = (f) => rows.filter(f).reduce((a, r) => a + r.weight, 0);
    const core = sum((r) => r.h.role === "core"), sat = sum((r) => r.h.role === "satellite");
    const stocks = rows.filter((r) => r.h.role === "satellite");
    const maxStock = stocks.reduce((m, r) => (r.weight > m.weight ? r : m), stocks[0]);
    const largest = rows.reduce((m, r) => (r.weight > m.weight ? r : m), rows[0]);
    const intlEq = (assets["International Equity"] || 0) / (100 - (assets["Bonds"] || 0)) * 100;
    const defensiveSectors = ["Consumer Staples", "Utilities", "Health Care"];
    const defensive = sectorList.filter((s) => defensiveSectors.includes(s.sector)).reduce((a, s) => a + s.pctTotal, 0) + (assets["Bonds"] || 0);
    const meaningfulSectors = sectorList.filter((s) => s.pctEquity >= 2).length;

    // Diversification score
    const hhiSector = sectorList.reduce((a, s) => a + Math.pow(s.pctEquity / 100, 2), 0);
    const effSectors = 1 / hhiSector;
    const partSector = Math.min(effSectors / 8, 1) * 40;
    const partStock = Math.max(0, Math.min(1, (10 - maxStock.weight) / 5)) * 30;
    const partIntl = Math.min(intlEq / 20, 1) * 15;
    const bonds = assets["Bonds"] || 0;
    const partBonds = bonds >= 10 && bonds <= 40 ? 15 : bonds < 10 ? (bonds / 10) * 15 : Math.max(0, 15 - (bonds - 40) * 0.75);
    const score = Math.round(partSector + partStock + partIntl + partBonds);

    return {
      rows, total, cost, dayChg, dayChgPct: prevTotal ? dayChg / prevTotal * 100 : null,
      totalRet: (total / cost - 1) * 100, totalRetUSD: total - cost, basisNote, usesActual,
      sectorList, assets, core, sat, maxStock, largest, intlEq, defensive, meaningfulSectors,
      score, scoreParts: { partSector, partStock, partIntl, partBonds, effSectors, hhiSector }, equityPct: 100 - bonds,
    };
  }

  // ----------------------------------------------------- quote labeling
  const SESSION_LABEL = {
    regular_intraday: "Regular session (intraday)",
    regular_close: "Regular-session close",
    premarket: "Premarket",
    after_hours: "After-hours",
    overnight_or_closed: "Market closed",
  };
  function quoteStatus(q, clock = marketClock()) {
    const out = { label: SESSION_LABEL[q.session_type] || "Session unknown", stale: false, note: "" };
    if (q.session_date < clock.currentSession) {
      out.label = `Previous-session quote (${fmtDate(q.session_date)})`;
    }
    if (q.session_date < clock.lastCompleted) {
      out.stale = true; out.note = `Older than the most recent completed session (${fmtDate(clock.lastCompleted)}).`;
    } else if (clock.open && q.session_date === clock.ymd) {
      const ageMin = (Date.now() - new Date(q.quote_time_utc).getTime()) / 60000;
      if (ageMin > 75) { out.stale = true; out.note = `Quote is ${Math.round(ageMin)} minutes old during market hours.`; }
    } else if (clock.open && q.session_date < clock.ymd) {
      out.stale = true; out.note = "Market is open but this quote is from a prior session.";
    }
    if (q.carried_forward) { out.stale = true; out.note = (out.note + " Latest refresh failed for this ticker; previous quote shown.").trim(); }
    return out;
  }

  // ------------------------------------------------------- render: header
  function renderHeader(c) {
    const mb = $("#modeBanner");
    if (S.mode === "sample") {
      mb.innerHTML = `<b>SAMPLE DATA.</b> ${esc(S.reason)} Every price, chart and forecast on this page is synthetic (random-walk series starting at 100.00) and exists only to demonstrate the layout. It is not market data and must not be read as performance. Real data appears automatically after the first successful GitHub Action run.`;
    } else mb.textContent = "";

    const clock = marketClock();
    const staleTickers = c.rows.map((r) => ({ t: r.h.ticker, s: quoteStatus(r.q, clock) })).filter((x) => x.s.stale);
    const msgs = [];
    if (S.mode === "live") {
      const last = S.prices.last_successful_refresh_utc && new Date(S.prices.last_successful_refresh_utc);
      const ageH = last ? (Date.now() - last.getTime()) / 3.6e6 : Infinity;
      if (ageH > 26 && isTradingDay(clock.lastCompleted)) msgs.push(`Last successful data refresh was ${Math.round(ageH)} hours ago.`);
      if (staleTickers.length) msgs.push(`Stale quotes: ${staleTickers.map((x) => `${x.t} (${x.s.note})`).join("; ")}`);
      if (S.status?.last_attempt_outcome && !/^success/.test(S.status.last_attempt_outcome)) msgs.push(`Latest refresh attempt (${fmtET(S.status.last_attempt_utc)}): ${S.status.last_attempt_outcome}.`);
    }
    $("#staleBanner").innerHTML = msgs.length ? "<b>Stale-data warning.</b> " + msgs.map(esc).join(" ") : "";

    const newestQuote = c.rows.reduce((m, r) => (r.q.quote_time_utc > m ? r.q.quote_time_utc : m), "");
    const latestBatch = (S.preds.batches || []).slice(-1)[0];
    $("#stamps").innerHTML = [
      `<span>Data mode: <b>${S.mode === "live" ? "Live" : "SAMPLE (synthetic)"}</b></span>`,
      `<span>Last successful data refresh: <b>${S.mode === "live" ? fmtET(S.prices.last_successful_refresh_utc) : "none yet"}</b></span>`,
      `<span>Newest quote: <b>${fmtET(newestQuote)}</b></span>`,
      `<span>Latest forecast created: <b>${latestBatch ? fmtET(latestBatch.created_at_utc) : "none"}</b></span>`,
    ].join("");
  }

  // ----------------------------------------------------- render: summary
  function renderSummary(c) {
    const clock = marketClock();
    const sessions = [...new Set(c.rows.map((r) => r.q.session_date))].sort();
    const daySession = sessions[sessions.length - 1];
    const dayLabel = daySession === clock.ymd && clock.open ? "today so far" : `session of ${fmtDate(daySession)}`;
    $("#cards").innerHTML = [
      card("Total value", fmtUSD(c.total), `${S.mode === "sample" ? "SAMPLE · " : ""}at latest quotes`),
      card("Day change", `<span class="${cls(c.dayChg)}">${fmtUSD(c.dayChg)}</span>`, `<span class="${cls(c.dayChg)}">${fmtPct(c.dayChgPct)}</span> · ${esc(dayLabel)}`),
      card("Total return", `<span class="${cls(c.totalRet)}">${fmtPct(c.totalRet)}</span>`, `<span class="${cls(c.totalRetUSD)}">${fmtUSD(c.totalRetUSD)}</span> price return since cost basis`),
      card("Holdings", String(c.rows.length), `${c.rows.filter((r) => r.h.role === "core").length} core ETFs · ${c.rows.filter((r) => r.h.role === "satellite").length} stocks`),
    ].join("");
    $("#summaryBasis").textContent = c.basisNote;
    const er = c.rows.filter((r) => r.h.expense_ratio_pct != null).reduce((a, r) => a + r.weight * r.h.expense_ratio_pct / 100, 0);
    $("#calcNotes").innerHTML = [
      `<b>Total value</b> = Σ shares × latest quote price. ${c.usesActual ? "Shares come from holdings.json." : `Shares are hypothetical: ${esc(S.holdings.portfolio.model.description)}`}`,
      `<b>Day change</b> = Σ shares × (latest price − previous regular-session close). Covers the ${esc(dayLabel)}; if quotes are from different sessions the figure mixes them.`,
      `<b>Total return</b> = total value ÷ total cost basis − 1. It is a <b>price return</b>: it <b>excludes dividends</b> and distributions (not reinvested or counted), <b>excludes taxes</b>, and <b>excludes trading commissions or advisory fees</b>. ETF expense ratios <b>are</b> reflected, because they are deducted inside each fund's price.`,
      `Weighted ETF expense ratio ≈ ${(er).toFixed(3)}% of the portfolio per year (fund fact sheets as of 2026-06-30). Individual stocks have no expense ratio.`,
      `Performance chart and returns use the same price basis for the portfolio and the S&P 500 proxy, so dividends are excluded from both unless the data source adjusts for them.`,
    ].map((x) => `<li>${x}</li>`).join("");
  }
  const card = (l, v, s) => `<div class="card"><div class="label">${l}</div><div class="value num">${v}</div><div class="sub">${s}</div></div>`;

  // ----------------------------------------------------- render: charts
  function chartDefaults() {
    if (!window.Chart) return false;
    Chart.defaults.color = css("--text-2");
    Chart.defaults.borderColor = css("--chart-grid");
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    return true;
  }
  function mk(id, cfg) {
    if (S.charts[id]) S.charts[id].destroy();
    S.charts[id] = new Chart(document.getElementById(id), cfg);
  }
  function renderAllocation(c) {
    if (!chartDefaults()) return;
    const rows = [...c.rows].sort((a, b) => b.weight - a.weight);
    mk("donut", {
      type: "doughnut",
      data: { labels: rows.map((r) => r.h.ticker), datasets: [{ data: rows.map((r) => +r.weight.toFixed(2)), backgroundColor: rows.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: css("--surface"), borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: "58%", plugins: { legend: { position: "right", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: (x) => `${x.label}: ${x.parsed.toFixed(1)}% (target ${rows[x.dataIndex].h.target_weight}%)` } } } },
    });
    const limit = S.holdings.portfolio.rules.max_equity_sector_pct;
    mk("sectorBar", {
      type: "bar",
      data: { labels: c.sectorList.map((s) => s.sector), datasets: [{ label: "% of equity", data: c.sectorList.map((s) => +s.pctEquity.toFixed(2)), backgroundColor: c.sectorList.map((s) => s.pctEquity > limit ? css("--neg") : css("--accent")) }] },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${x.parsed.x.toFixed(1)}% of equity · ${c.sectorList[x.dataIndex].pctTotal.toFixed(1)}% of portfolio` } } }, scales: { x: { ticks: { callback: (v) => v + "%" }, suggestedMax: 30 } } },
    });
    const aLabels = Object.keys(c.assets);
    mk("assetBar", {
      type: "bar",
      data: { labels: aLabels, datasets: [{ label: "% of portfolio", data: aLabels.map((a) => +c.assets[a].toFixed(2)), backgroundColor: [PALETTE[0], PALETTE[2], PALETTE[1]] }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${x.parsed.y.toFixed(1)}%` } } }, scales: { y: { ticks: { callback: (v) => v + "%" }, beginAtZero: true } } },
    });
    const srcs = S.holdings.holdings.filter((h) => h.sector_exposure).map((h) =>
      `${h.ticker}: <a href="${esc(h.sector_exposure.source_url)}" target="_blank" rel="noopener">${esc(h.sector_exposure.source)}</a>, data as of ${fmtDate(h.sector_exposure.as_of)} (observed ${fmtDate(h.sector_exposure.observed)})`).join("; ");
    $("#sectorNote").innerHTML = `Sector bars are look-through <b>estimates</b> as a percent of the equity sleeve (bonds excluded); red bars exceed the ${limit}% limit. ETF sector weights: ${srcs}. ${esc(S.holdings.sector_scheme.note)}`;
  }

  // ------------------------------------------------- render: performance
  function commonDates(tickers) {
    const sets = tickers.map((t) => new Set((S.history.series[t] || []).map((x) => x[0])));
    return [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  }
  function renderPerformance() {
    if (!chartDefaults()) return;
    const H = S.holdings.holdings, bench = S.bench;
    const dates = commonDates([...H.map((h) => h.ticker), bench]);
    if (!dates.length) { $("#perfNote").textContent = "Insufficient price history to draw performance."; return; }
    const end = dates[dates.length - 1];
    const back = { "1M": 1, "6M": 6, "1Y": 12, "5Y": 60 }[S.range];
    const [y, m, d] = end.split("-").map(Number);
    const startTarget = new Date(Date.UTC(y, m - 1 - back, d)).toISOString().slice(0, 10);
    const win = dates.filter((x) => x >= startTarget);
    const short = dates[0] > startTarget;
    const maps = Object.fromEntries([...H.map((h) => h.ticker), bench].map((t) => [t, seriesMap(t)]));
    const t0 = win[0];
    const port = win.map((dt) => H.reduce((a, h) => a + (h.target_weight / 100) * (maps[h.ticker].get(dt) / maps[h.ticker].get(t0)), 0) * 100);
    const spy = win.map((dt) => (maps[bench].get(dt) / maps[bench].get(t0)) * 100);
    const pR = port[port.length - 1] - 100, sR = spy[spy.length - 1] - 100;
    $("#perfStats").innerHTML = `<span>Model portfolio: <b class="${cls(pR)} num">${fmtPct(pR)}</b></span><span>S&amp;P 500 (${esc(bench)} proxy): <b class="${cls(sR)} num">${fmtPct(sR)}</b></span><span>Difference: <b class="${cls(pR - sR)} num">${fmtPct(pR - sR)}</b></span><span class="muted">${fmtDate(t0)} → ${fmtDate(win[win.length - 1])}${short ? " (history shorter than requested range)" : ""}</span>`;
    mk("perfChart", {
      type: "line",
      data: {
        labels: win,
        datasets: [
          { label: S.mode === "sample" ? "Model portfolio (SAMPLE)" : "Model portfolio (target weights, buy-and-hold from range start)", data: port, borderColor: css("--accent"), backgroundColor: "transparent", pointRadius: 0, borderWidth: 2, tension: 0.1 },
          { label: `S&P 500 via ${bench} (proxy)`, data: spy, borderColor: PALETTE[1], backgroundColor: "transparent", pointRadius: 0, borderWidth: 2, borderDash: [5, 4], tension: 0.1 },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y.toFixed(2)}` } } },
        scales: { x: { ticks: { maxTicksLimit: 8, autoSkip: true } }, y: { title: { display: true, text: "Growth of 100" } } },
      },
    });
    const b = S.holdings.portfolio.rules.benchmark;
    $("#perfNote").innerHTML = `${S.mode === "sample" ? "<b>SAMPLE:</b> both lines are synthetic. " : ""}<b>Hypothetical backtest, not actual results.</b> The portfolio line assumes the current target weights were bought at the first close of the selected range and held without rebalancing, with no fees beyond fund expense ratios, no taxes and no dividends (price return). Benchmark: ${esc(b.note)} History source: ${esc([...new Set(Object.values(S.history.sources || {}))].join(", "))}. ${esc(S.history.price_basis || "")}`;
  }

  // ------------------------------------------------------- render: risk
  function renderRisk(c) {
    const R = S.holdings.portfolio.rules;
    $("#divScore").textContent = c.score;
    $("#divMeter").style.width = c.score + "%";
    const p = c.scoreParts;
    $("#scoreParts").innerHTML = [
      [`Sector breadth: ${p.effSectors.toFixed(1)} effective sectors`, p.partSector, 40],
      [`Largest single stock: ${c.maxStock.h.ticker} ${c.maxStock.weight.toFixed(1)}%`, p.partStock, 30],
      [`International share of equity: ${c.intlEq.toFixed(1)}%`, p.partIntl, 15],
      [`Bond ballast: ${(c.assets["Bonds"] || 0).toFixed(1)}%`, p.partBonds, 15],
    ].map(([l, v, mx]) => `<li><span style="flex:1">${esc(l)}</span><span class="num">${v.toFixed(1)} / ${mx}</span></li>`).join("");
    $("#scoreMethod").innerHTML = [
      "<b>Sector breadth (40 pts):</b> effective number of equity sectors = 1 ÷ Σ(sector share²) using look-through weights; full marks at 8 or more.",
      "<b>Single-stock concentration (30 pts):</b> full marks if the largest individual stock is ≤ 5% of the portfolio, falling linearly to 0 at 10%.",
      "<b>International exposure (15 pts):</b> full marks when ≥ 20% of equity is outside the US (VEA plus foreign ADRs), linear below.",
      "<b>Bond ballast (15 pts):</b> full marks with 10–40% in bonds; linear below 10%; reduced above 40%.",
      "This is a transparent heuristic for this dashboard, not an industry-standard metric. It ignores correlations and valuation.",
    ].map((x) => `<li>${x}</li>`).join("");

    const top = c.sectorList[0];
    const checks = [
      [c.core >= R.core_range_pct[0] && c.core <= R.core_range_pct[1], `Core ETFs ${c.core.toFixed(1)}% (target range ${R.core_range_pct.join("–")}%)`],
      [c.sat >= R.satellite_range_pct[0] && c.sat <= R.satellite_range_pct[1], `Satellite stocks ${c.sat.toFixed(1)}% (target range ${R.satellite_range_pct.join("–")}%)`],
      [c.maxStock.weight <= R.max_single_stock_pct, `Largest single stock: ${c.maxStock.h.ticker} ${c.maxStock.weight.toFixed(1)}% (limit ${R.max_single_stock_pct}%)`],
      [true, `Largest position overall: ${c.largest.h.ticker} ${c.largest.weight.toFixed(1)}% (a diversified fund)`],
      [top.pctEquity <= R.max_equity_sector_pct, `Largest equity sector: ${top.sector} ${top.pctEquity.toFixed(1)}% of equity, ${top.pctTotal.toFixed(1)}% of portfolio (limit ${R.max_equity_sector_pct}% of equity, estimated)`],
      [c.meaningfulSectors >= R.min_sectors, `${c.meaningfulSectors} sectors at ≥ 2% of equity (minimum ${R.min_sectors})`],
      [c.intlEq > 0, `International equity: ${(c.assets["International Equity"] || 0).toFixed(1)}% of portfolio`],
      [c.defensive > 0, `Defensive exposure (bonds + staples, utilities, health care): ${c.defensive.toFixed(1)}% of portfolio`],
    ];
    $("#riskChecks").innerHTML = checks.map(([ok, t]) => `<li><span class="badge ${ok ? "ok" : "bad"}">${ok ? "OK" : "ALERT"}</span><span>${esc(t)}</span></li>`).join("");

    const drift = c.rows.filter((r) => Math.abs(r.drift) > R.drift_alert_pp);
    $("#driftAlerts").innerHTML = drift.length
      ? drift.map((r) => `<li><span class="badge bad">DRIFT</span><span>${esc(r.h.ticker)} is ${r.weight.toFixed(1)}% vs ${r.h.target_weight}% target (${fmtPct(r.drift, 1)} pts). Review at next rebalance.</span></li>`).join("")
      : `<li><span class="badge ok">OK</span><span>No holding is more than ${R.drift_alert_pp} percentage points from target. Largest drift: ${(() => { const m = c.rows.reduce((a, r) => Math.abs(r.drift) > Math.abs(a.drift) ? r : a); return `${m.h.ticker} ${fmtPct(m.drift, 1)} pts`; })()}.</span></li>`;
  }

  // --------------------------------------------------- render: holdings
  function renderHoldings(c) {
    const clock = marketClock();
    $("#holdingsBasis").textContent = c.usesActual ? "Return vs your cost basis" : "Return since model inception (price only)";
    $("#holdingsTable tbody").innerHTML = c.rows.map((r) => {
      const qs = quoteStatus(r.q, clock);
      return `<tr>
        <td data-label="Ticker"><b>${esc(r.h.ticker)}</b><span class="tiny">${r.h.role === "core" ? "Core" : "Satellite"}</span></td>
        <td data-label="Name">${esc(r.h.name)}<span class="tiny">${esc(r.h.asset_class)} · ${esc(r.h.region)}</span></td>
        <td data-label="Sector">${esc(r.h.sector)}</td>
        <td data-label="Weight / Target" class="r num">${r.weight.toFixed(1)}% / ${r.h.target_weight}%<span class="tiny ${Math.abs(r.drift) > 5 ? "neg" : ""}">${fmtPct(r.drift, 1)} pts</span></td>
        <td data-label="Price" class="r num">${fmtUSD(r.q.price)}${S.mode === "sample" ? '<span class="tiny">SAMPLE</span>' : ""}</td>
        <td data-label="Quote time">${fmtET(r.q.quote_time_utc)}<span class="tiny">${esc(qs.label)}${qs.stale ? ' · <b class="neg">stale</b>' : ""}</span><span class="tiny">${esc(r.q.provider || "")}</span></td>
        <td data-label="Return" class="r num ${cls(r.ret)}">${fmtPct(r.ret)}</td>
        <td data-label="Thesis" class="wide">${esc(r.h.thesis)}</td>
        <td data-label="Main risk" class="wide">${esc(r.h.main_risk)}</td>
      </tr>`;
    }).join("");
  }

  // --------------------------------------------------- render: forecasts
  const H_NAME = { 14: "2 weeks", 28: "4 weeks", 42: "6 weeks" };
  function rangeBar(start, bear, base, bull, lo, hi) {
    const pos = (v) => ((v - lo) / (hi - lo)) * 100;
    return `<div class="range-bar" aria-hidden="true"><span class="fill" style="left:${pos(bear)}%;right:${100 - pos(bull)}%"></span><span class="start" style="left:${pos(start)}%" title="start"></span><span class="base" style="left:${pos(base)}%" title="base"></span></div>`;
  }
  function renderForecasts() {
    const batches = S.preds.batches || [];
    const latest = batches[batches.length - 1];
    if (!latest) {
      $("#batchInfo").innerHTML = "";
      $("#fcGrid").innerHTML = `<div class="insufficient"><b>Insufficient evidence — no forecasts yet.</b> Forecasts are created only from a verified, current starting quote. Run the “Create forecasts” workflow after the first successful price refresh (see README).</div>`;
      return;
    }
    $("#batchInfo").innerHTML = `
      <div>${latest.is_sample ? '<span class="badge sample">SAMPLE</span> ' : ""}<b>Forecast batch</b> ${esc(latest.batch_id)} · <b>created</b> ${fmtET(latest.created_at_utc)} <span class="muted">(${esc(latest.created_at_note)})</span></div>
      <div><b>Research inputs:</b> ${esc(latest.research_id)}, compiled ${fmtET(latest.research_compiled_at)}${latest.research_file ? ` · <a href="${esc(latest.research_file)}">${esc(latest.research_file)}</a>` : ""}</div>
      <div><b>Consensus policy:</b> ${esc(latest.consensus_policy || "")}</div>`;
    $("#fcGrid").innerHTML = latest.forecasts.map((f) => {
      if (f.status !== "ok") {
        return `<article class="fc-card"><header><h3>${esc(f.ticker)} <small class="muted">${esc(f.name)}</small></h3></header>
          <div class="insufficient"><b>Insufficient evidence.</b> ${esc(f.insufficient_reason)}</div></article>`;
      }
      const c = f.consensus_12m;
      const ev = f.horizons[0];
      const cons = c ? `<div class="consensus-box"><b>Published analyst consensus (12-month horizon, context only):</b> ${esc(c.consensus_rating)} · mean target ${fmtUSD(c.mean_target_12m)} (range ${fmtUSD(c.low_target_12m)}–${fmtUSD(c.high_target_12m)}) from <b>${c.analyst_count} analysts</b>
          (${c.ratings.strong_buy} strong buy, ${c.ratings.buy} buy, ${c.ratings.hold} hold, ${c.ratings.sell} sell). Method: ${esc(c.aggregation_method)}. Source: <a href="${esc(c.source_url)}" target="_blank" rel="noopener">${esc(c.source)}</a>, observed ${fmtET(c.observed_at)}.
          <br><i>${esc(f.consensus_note)}</i></div>` : `<div class="consensus-box">${esc(f.consensus_note)}</div>`;
      const lo = Math.min(f.start.price, ...f.horizons.map((h) => h.bear)) * 0.99;
      const hi = Math.max(f.start.price, ...f.horizons.map((h) => h.bull)) * 1.01;
      const rows = f.horizons.map((h) => `<tr>
          <td><b>${H_NAME[h.horizon_days] || h.horizon_days + "d"}</b><span class="tiny">${fmtDate(h.target_date)}${h.target_is_trading_day ? "" : ` · ${esc(h.target_non_trading_reason)}; evaluated on ${fmtDate(h.evaluation_session)} close`}</span></td>
          <td class="r num neg">${fmtUSD(h.bear)}<span class="tiny">${fmtPct(h.bear_change_pct, 1)}</span></td>
          <td class="r num"><b>${fmtUSD(h.base)}</b><span class="tiny ${cls(h.base_change_pct)}">${fmtPct(h.base_change_pct, 1)}</span></td>
          <td class="r num pos">${fmtUSD(h.bull)}<span class="tiny">${fmtPct(h.bull_change_pct, 1)}</span></td>
        </tr><tr><td colspan="4" style="padding-top:0">${rangeBar(f.start.price, h.bear, h.base, h.bull, lo, hi)}</td></tr>`).join("");
      const details = f.horizons.map((h) => `<details><summary>${H_NAME[h.horizon_days]}: factors and main risk</summary>
          <ul>${h.supporting_factors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <p><b>Main risk:</b> ${esc(h.main_risk)}</p>
          <p class="muted">${h.trading_sessions} trading sessions · ${h.earnings_events_in_window} scheduled earnings event(s) in window · ${esc(h.evaluation_rule)}</p></details>`).join("");
      const srcs = [...(f.evidence || []).map((e) => `<li>${esc(e.fact)} — <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.source)}</a>, ${esc(e.published)}</li>`),
        ...(f.catalysts || []).map((k) => `<li>Catalyst: ${esc(k.event)} — ${k.date ? fmtDate(k.date) : "date not announced"} (${esc(k.status)})${k.url ? ` — <a href="${esc(k.url)}" target="_blank" rel="noopener">${esc(k.source)}</a>` : ""}</li>`)].join("");
      return `<article class="fc-card">
        <header><h3>${esc(f.ticker)} <small class="muted">${esc(f.name)}</small></h3>
          <span class="badge ${esc(ev.evidence_strength)}" title="${esc(ev.evidence_strength_reason)}">Evidence: ${esc(ev.evidence_strength)}</span></header>
        <div class="fc-meta">
          <div><b>${esc(f.label)}</b></div>
          <div><b>Start:</b> ${fmtUSD(f.start.price)} · quote ${fmtET(f.start.quote_time_utc)} (${esc(SESSION_LABEL[f.start.session_type] || f.start.session_type)}, ${esc(f.start.provider || "")})</div>
          <div><b>Forecast created:</b> ${fmtET(latest.created_at_utc)} · <b>Volatility:</b> ${f.annualized_volatility_pct}% annualized · <b>Beta used:</b> ${f.beta_used ?? "–"}</div>
          <div class="muted">Evidence strength: ${esc(ev.evidence_strength_reason)}</div>
        </div>
        <table class="fc-table"><thead><tr><th>Horizon / target date</th><th class="r">Bear</th><th class="r">Base</th><th class="r">Bull</th></tr></thead><tbody>${rows}</tbody></table>
        ${cons}
        ${details}
        <details><summary>Sources and catalysts</summary><ul>${srcs || "<li>None recorded.</li>"}</ul></details>
      </article>`;
    }).join("");
  }

  function renderHistory() {
    const evals = S.preds.evaluations || {};
    const rows = [];
    let done = 0, inRange = 0, absErr = 0, pending = 0;
    for (const b of [...(S.preds.batches || [])].reverse()) {
      for (const f of b.forecasts) {
        if (f.status !== "ok") { rows.push(`<tr><td>${fmtET(b.created_at_utc)}</td><td>${esc(f.ticker)}</td><td colspan="10" class="muted">Insufficient evidence: ${esc(f.insufficient_reason)}</td></tr>`); continue; }
        for (const h of f.horizons) {
          const e = evals[`${b.batch_id}|${f.ticker}|${h.horizon_days}`];
          const completed = e && e.status === "completed";
          if (completed) { done++; absErr += e.abs_error_pct; if (e.within_scenario_range) inRange++; } else pending++;
          rows.push(`<tr>
            <td>${fmtET(b.created_at_utc)}${b.is_sample ? '<span class="tiny">SAMPLE</span>' : ""}</td><td><b>${esc(f.ticker)}</b></td><td>${H_NAME[h.horizon_days]}</td>
            <td class="r num">${fmtUSD(f.start.price)}<span class="tiny">${fmtDate(f.start.session_date)}</span></td>
            <td>${fmtDate(h.target_date)}${h.evaluation_session !== h.target_date ? `<span class="tiny">eval: ${fmtDate(h.evaluation_session)}</span>` : ""}</td>
            <td class="r num">${fmtUSD(h.bear)}</td><td class="r num"><b>${fmtUSD(h.base)}</b></td><td class="r num">${fmtUSD(h.bull)}</td>
            <td>${completed ? '<span class="badge neutral">Completed</span>' : e?.status === "awaiting_data" ? '<span class="badge moderate">Awaiting data</span>' : '<span class="badge moderate">Pending</span>'}</td>
            <td class="r num">${completed ? fmtUSD(e.observed_close) : "–"}</td>
            <td class="r num ${completed ? cls(e.error_pct) : ""}">${completed ? `${fmtPct(e.error_pct)}<span class="tiny">${fmtUSD(e.error_usd)}</span>` : "–"}</td>
            <td>${completed ? (e.within_scenario_range ? '<span class="badge ok">Yes</span>' : '<span class="badge bad">No</span>') : "–"}</td>
          </tr>`);
        }
      }
    }
    $("#historyTable tbody").innerHTML = rows.join("") || `<tr><td colspan="12" class="muted">No forecasts recorded yet.</td></tr>`;
    $("#scoreSummary").innerHTML = `<span>Completed evaluations: <b class="num">${done}</b></span><span>Pending: <b class="num">${pending}</b></span>` +
      (done ? `<span>Observed close inside bear–bull range: <b class="num">${inRange}/${done} (${(inRange / done * 100).toFixed(0)}%)</b></span><span>Mean absolute error vs base case: <b class="num">${(absErr / done).toFixed(2)}%</b></span>` : "") +
      `<span class="muted">Error = observed close ÷ base case − 1. ${S.mode === "sample" ? "SAMPLE scorecard uses synthetic prices." : ""}</span>`;
  }

  // -------------------------------------------------- render: commentary
  function md(src) {
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
      .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = []; let list = null, para = [];
    const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.t}>`); list = null; } };
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flush(); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); const lvl = Math.min(m[1].length + 1, 4); out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`); continue; }
      if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (para.length) flush(); if (!list || list.t !== "ul") { flush(); list = { t: "ul", items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (para.length) flush(); if (!list || list.t !== "ol") { flush(); list = { t: "ol", items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      if (list) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
      para.push(line.trim());
    }
    flush();
    return out.join("\n");
  }
  function renderCommentary() {
    $("#commentary").innerHTML = S.commentary ? md(S.commentary) : '<p class="muted">commentary.md could not be loaded.</p>';
  }

  // ----------------------------------------------------- render: sources
  function renderSources() {
    const H = S.holdings.holdings;
    const etf = H.filter((h) => h.sector_exposure || h.bond_profile).map((h) => {
      const s = h.sector_exposure || h.bond_profile;
      return `<li>${esc(h.ticker)}: <a href="${esc(s.source_url)}" target="_blank" rel="noopener">${esc(s.source)}</a> — data as of ${fmtDate(s.as_of)}${h.expense_ratio_pct != null ? `; expense ratio ${h.expense_ratio_pct}%` : ""}</li>`;
    }).join("");
    const histSrc = [...new Set(Object.values(S.history.sources || {}))];
    const provs = [...new Set(Object.values(S.prices.quotes).map((q) => q.provider))];
    $("#sourceList").innerHTML = `
      <p><b>Prices:</b> ${esc(provs.join(", "))}. Each quote shows its own timestamp in Eastern Time. Session labels are inferred from the quote timestamp when the provider does not flag the session. Retrieval time is never shown as quote time.</p>
      <p><b>Price history:</b> ${esc(histSrc.join(", ") || "–")}. ${esc(S.history.price_basis || "")}</p>
      <p><b>ETF look-through and fund data:</b></p><ul>${etf}</ul>
      <p><b>Analyst consensus:</b> one aggregator per stock (MarketBeat), copied manually with observation timestamps into dated research files under <code>data/research/</code>. Other sources supply independent facts (company releases, regulators, dated news). See each forecast card's “Sources and catalysts”.</p>
      <p><b>Forecast method:</b> modeled short-term scenarios. Base case = each stock's 1-year beta to the S&P 500 proxy × an assumed ${(S.preds.batches?.slice(-1)[0]?.model_assumptions?.long_run_equity_drift_annual ?? 0.06) * 100}%/yr long-run equity return (applied per trading session), plus a small, documented research tilt. Scenario width = each stock's own 63-day realized volatility over the horizon's trading sessions, widened for scheduled earnings. Full details in README.</p>
      <p><b>Price data limitation:</b> the free price APIs used here do not provide analyst research or consensus data. That information is updated manually and never fabricated; if it is missing, the dashboard says so.</p>`;
  }

  // ------------------------------------------------------------- boot
  let LAST = null;
  function redrawCharts() { if (LAST) { renderAllocation(LAST); renderPerformance(); } }

  async function boot() {
    initTheme();
    try {
      await load();
      const c = compute();
      LAST = c;
      renderHeader(c); renderSummary(c); renderRisk(c); renderHoldings(c);
      renderForecasts(); renderHistory(); renderCommentary(); renderSources();
      const drawCharts = () => { renderAllocation(c); renderPerformance(); };
      if (window.Chart) drawCharts(); else window.addEventListener("load", () => { if (window.Chart) drawCharts(); else $("#perfNote").textContent = "Chart.js could not be loaded from cdnjs; charts are unavailable."; });
      document.querySelectorAll("#rangeToggle button").forEach((b) => b.addEventListener("click", () => {
        S.range = b.dataset.range;
        document.querySelectorAll("#rangeToggle button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderPerformance();
      }));
    } catch (err) {
      console.error(err);
      $("#modeBanner").className = "notice warn";
      $("#modeBanner").textContent = "The dashboard could not load its data files: " + err.message;
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
