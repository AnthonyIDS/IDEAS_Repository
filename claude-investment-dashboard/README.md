# Core-Satellite Portfolio Dashboard

A static investment dashboard for GitHub Pages. It uses plain HTML, CSS and vanilla JavaScript, loads Chart.js from cdnjs, and has no build step. A scheduled GitHub Action refreshes prices into JSON files. The browser reads only local files and never calls a market-data or AI API.

> **Educational content only, not personalized financial advice. Price predictions are uncertain research estimates or modeled scenarios, not guarantees. Actual results may differ substantially.**

---

## Repository structure

```
.
├── index.html                      # Page shell (7 panels + sources)
├── commentary.md                   # "The Veteran's Desk" — edit freely, rendered on the page
├── assets/
│   ├── css/styles.css              # Light/dark theme tokens, responsive layout
│   └── js/app.js                   # All calculations and rendering
├── data/
│   ├── holdings.json               # Holdings, target weights, theses, risks, ETF look-through sources
│   ├── prices.json                 # Written by the Action (latest quotes + timestamps)
│   ├── history.json                # Written by the Action (daily closes, ~5.5 years)
│   ├── refresh-status.json         # Written by the Action (every attempt, success or failure)
│   ├── predictions.json            # Forecast batches (append-only) + evaluations
│   ├── predictions/archive/        # Immutable copy of each forecast batch
│   ├── research/research-YYYY-MM-DD.json   # Dated manual research inputs
│   └── sample/                     # Clearly labeled SYNTHETIC demo data
├── scripts/
│   ├── marketcal.py                # NYSE calendar + session classification
│   ├── fetch_prices.py             # Quotes + history with fallbacks and snapshot preservation
│   ├── create_forecasts.py         # Creates a NEW forecast batch (never edits old ones)
│   ├── evaluate_forecasts.py       # Scores forecasts whose evaluation session has closed
│   └── make_sample_data.py         # Regenerates data/sample/*
│   (price workflow: .github/workflows/claude-investment-dashboard-prices.yml at the repo root)
└── .nojekyll
```

## Setup

### 1. Publish with GitHub Pages
1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**. Under **Build and deployment**, choose **Source: Deploy from a branch**, pick **Branch: `main`**, folder **`/ (root)`**, and click **Save**.
3. After a minute the site is live at `https://<user>.github.io/<repo>/`. Until the first data refresh succeeds, it shows a red **SAMPLE DATA** banner.

### 2. Add API keys as secrets (never in frontend code)
Go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Required? | Used for |
|---|---|---|
| `FINNHUB_API_KEY` | Recommended | Latest quotes with exact Unix timestamps. Free key at finnhub.io. |
| `ALPHAVANTAGE_API_KEY` | Optional | History fallback if Stooq fails. Free key at alphavantage.co. |
| `STOOQ_API_KEY` | Optional | Only if Stooq starts requiring a key for CSV downloads. |

Without a Finnhub key, quotes fall back to Stooq, which is free and keyless but may be delayed.

### 3. Allow the Action to commit
**Settings → Actions → General → Workflow permissions → Read and write permissions → Save.**

### 4. Run the first refresh
**Actions → Update prices (Claude investment dashboard) → Run workflow.** When it finishes, `data/prices.json` and `data/history.json` exist and the dashboard switches from sample data to live data. After that the workflow runs on its own every weekday, hourly at :35 from 13:35 to 21:35 UTC.

### 5. Create the first forecast batch
**Actions → Update prices (Claude investment dashboard) → Run workflow.** Tick **"Also create a NEW forecast batch"** and leave the research file at its default (or point it at a newer one). Forecasts are created only on manual runs, because they depend on manually maintained research.

### Local preview
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
The page uses `fetch()`, so opening `index.html` directly from disk will not work.

---

## Portfolio design

| Ticker | Role | Target | Sector (ICB-style) | Region |
|---|---|---|---|---|
| VTI | Core | 30% | Diversified | US |
| VEA | Core | 17% | Diversified | Developed ex-US |
| BND | Core | 18% | Fixed income | US |
| MSFT | Satellite | 4% | Technology | US |
| BRK.B | Satellite | 5.5% | Financials | US |
| JNJ | Satellite | 5% | Health Care | US |
| PG | Satellite | 5% | Consumer Staples | US |
| NEE | Satellite | 5% | Utilities | US |
| UNP | Satellite | 5% | Industrials | US |
| SHEL | Satellite | 5.5% | Energy | UK (ADR) |

* **Core is 65%** (60–70% rule) and **satellites are 35%** (30–40% rule): 7 stocks across 7 different sectors.
* **No single stock is above 5.5%** (8% cap). MSFT is held at 4% because VTI already holds a lot of Microsoft and technology.
* **Sector limit:** no equity sector may exceed 25% of the **equity sleeve** on a look-through basis. At target weights, the estimated technology exposure is VTI 30%×41.0% + VEA 17%×13.8% + MSFT 4% ≈ 18.6% of the portfolio, or ≈ 22.7% of the 82% equity sleeve. The dashboard recomputes this from current weights and flags any breach.
* **Look-through sources:**
  * VTI: [Vanguard fact sheet F0970](https://fund-docs.vanguard.com/F0970.pdf), sector data as of 2026-06-30.
  * VEA: [Vanguard fact sheet F0936](https://fund-docs.vanguard.com/F0936.pdf), sector data as of 2026-06-30.
  * BND: [Vanguard fact sheet F0928](https://fund-docs.vanguard.com/F0928.pdf), data as of 2026-06-30.
  * All three were observed on 2026-10-06. Vanguard uses FTSE/ICB-style sector names, where "Technology" includes some companies GICS puts in Communication Services, so the stocks are mapped to the same scheme. Update `sector_exposure` in `holdings.json` when new fact sheets are published.
* **International and defensive exposure:** VEA and SHEL are international. BND, JNJ, PG and NEE are defensive.

Each holding's one-line thesis, target weight and main risk live in `holdings.json` and appear in the holdings table.

---

## Calculations

### Summary cards
| Card | Formula | Includes | Excludes |
|---|---|---|---|
| Total value | Σ shares × latest quote | — | — |
| Day change | Σ shares × (latest price − previous regular-session close) | — | — |
| Total return | total value ÷ total cost basis − 1 | Price change. ETF expense ratios (deducted inside fund prices). | **Dividends** and distributions, **taxes**, **commissions and advisory fees** |
| Holdings | Count of rows in `holdings.json` | — | — |

**Shares.** By default the dashboard runs a hypothetical model: $100,000 is invested at target weights at the close on `model.inception_date` (2025-10-06), or on the next trading session if that date isn't one, and then held without rebalancing. To track a real account, add `shares` and `cost_basis_per_share` to **every** holding. The page then uses those values instead.

### Allocation
* Donut chart: current weight per holding.
* Sector bars: look-through equity exposure as a % of the equity sleeve, with % of total in the tooltip. Bars above the limit turn red.
* Asset-class bars: US equity, international equity and bonds as a % of total.

### Performance vs S&P 500
* **The benchmark proxy is SPY** (SPDR S&P 500 ETF Trust), an ETF that tracks the index. It is used because index levels aren't available from the same free feeds.
* The portfolio line is a **hypothetical backtest**: today's target weights bought at the first close of the selected range (1M / 6M / 1Y / 5Y) and held. It is not actual account performance.
* Both lines use the same daily-close series from the same provider, so dividend treatment is the same for both. Stooq's series are split-adjusted, and dividend treatment follows the source.
* Synthetic sample history is never shown alongside live data. The page is either fully live or fully sample.

### Risk panel
* **Diversification score (0–100)**, a transparent heuristic rather than an industry standard:
  * 40 pts: effective number of equity sectors, 1 ÷ Σ(sector share²), with full marks at 8 or more.
  * 30 pts: largest single stock. Full marks at ≤ 5%, falling linearly to 0 at 10%.
  * 15 pts: international share of equity. Full marks at ≥ 20%.
  * 15 pts: bonds. Full marks between 10% and 40%.
  * It ignores correlations and valuation.
* **Rule checks:** core and satellite ranges, the single-stock cap, largest overall position, largest sector versus the 25% limit, sector count, international exposure and defensive exposure.
* **Drift alerts:** any holding more than **5 percentage points** from its target.

### Prices, timestamps and staleness
* Each quote stores `quote_time_utc` from the provider: Finnhub's Unix `t`, or Stooq's date/time converted from Europe/Warsaw. The page shows it in Eastern Time with the time-zone abbreviation.
* `retrieved_at_utc` is stored separately and is **never** displayed as the quote time.
* The **last successful refresh** (`prices.json → last_successful_refresh_utc`) is shown separately from every quote timestamp.
* **Session labels** are inferred from the timestamp because the free feeds don't flag sessions: *Regular session (intraday)*, *Regular-session close*, *Premarket*, *After-hours*, or *Previous-session quote* when the quote's date is earlier than the current session.
* **Stale-data warning** appears when:
  * a quote predates the most recent completed session;
  * the market is open and a same-day quote is more than 75 minutes old;
  * the market is open but the quote is from a prior session;
  * a ticker was carried forward after a failed fetch;
  * the last successful refresh is more than 26 hours old; or
  * the latest refresh attempt failed or was partial.

### Failure handling
* Files are written atomically and only after validation.
* If **every** quote fails, `prices.json` is left untouched, `refresh-status.json` records the failure, and the workflow run is marked failed.
* If **some** tickers fail, their previous quotes are kept with their **original** timestamps and flagged `carried_forward`.
* If history fails for a ticker, the previous series is kept. The Alpha Vantage fallback merges into existing history rather than replacing it.

---

## Wall Street Research Outlook — methodology

### What it is, and what it is not
* It is a **research-based synthesis**. No panel met, and no analyst or firm reviewed or endorsed this dashboard.
* **Analyst consensus** means only a documented aggregation of published analyst targets. This project uses **one aggregator per stock (MarketBeat)** so the same analyst estimate isn't counted twice across the many sites that republish it. Each record stores the analyst count, rating breakdown, aggregation method, source URL and observation timestamp.
* Published targets are **12-month** targets. They are shown for context only and are **never** converted, scaled or interpolated into 2-, 4- or 6-week numbers.
* No source provides comparable published 2–6 week forecasts for these stocks. Every numeric short-term figure is therefore labeled **"Modeled short-term scenario informed by available research."**

### Model (per stock, per horizon)
Let S₀ be the verified starting quote, *n* the number of NYSE sessions from the start date to the evaluation session, σ the stock's own daily log-return volatility over the last 63 sessions, β its 1-year beta to SPY (clamped to 0–2), and *k* the number of scheduled earnings releases inside the window.

```
horizon variance  V   = n·σ² + k·(2.5·σ)²            # earnings days get extra variance
horizon sigma     σh  = √V
drift             μ   = β · 6%/yr · n/252  +  tilt · 0.25 · σh
base  = S₀·e^μ        bear = S₀·e^(μ − σh)        bull = S₀·e^(μ + σh)
```

* **Stock-specific inputs:** σ, β, earnings dates, and the research tilt (−1 to +1, with a written reason in the research file). No stock shares an arbitrary growth rate or range.
* **Assumptions:** the 6%/yr long-run equity return, the 2.5× earnings multiplier and the 0.25σ tilt scale are assumptions, not observations. They live in the research file's `model_assumptions` so they can be reviewed and changed.
* **Scenarios, not bounds:** under a lognormal assumption ±1σ spans roughly the middle two-thirds of outcomes. Real returns have fatter tails, so treat bear and bull as **scenarios, not calibrated confidence intervals**. The scorecard measures how often prices land inside them.
* **Evidence strength** (low / moderate / high) rates the *quality of supporting evidence*: analyst breadth, how recent it is, and whether catalyst dates are confirmed. It is **not** a probability. In this cycle no stock is rated "high," because short-horizon price evidence is inherently weak.
* **Insufficient evidence** is shown instead of numbers when the starting quote is stale or carried forward, or when fewer than 64 daily closes are available.

### Dates
* Horizons are **14, 28 and 42 calendar days** from the starting quote's session date.
* If a target date falls on a weekend or NYSE holiday, the card shows the calendar date, the reason, and the **evaluation session**: the regular-session close of the next trading day.

### Forecast history
* `create_forecasts.py` **appends** a new batch with its own `created_at_utc` and `created_at_et`. Old batches are never edited, and an immutable archive copy is written to `data/predictions/archive/<batch_id>.json`.
* Forecast creation time is independent of price refreshes. Later quote updates never change it.
* `evaluate_forecasts.py` runs on every refresh. When an evaluation session's close is available, it records the observed close, error (observed ÷ base − 1, plus the dollar difference) and whether the close fell inside the bear–bull range. Results go in a separate `evaluations` map, so forecasts stay unchanged.
* The page separates **Pending**, **Awaiting data** and **Completed** forecasts and summarizes the hit rate and mean absolute error.

---

## Manual research update procedure

The free price APIs (Finnhub free tier, Stooq, Alpha Vantage free tier) **do not provide analyst ratings, targets or consensus data**. That research is maintained by hand and never substituted or fabricated.

1. Copy the latest `data/research/research-YYYY-MM-DD.json` to a new file with today's date. **Never edit a file that forecasts were already created from.**
2. For each stock, update `consensus` from **one** aggregator: analyst count, rating breakdown, mean/high/low 12-month targets, `observed_at` with time zone, and the URL. If the aggregator doesn't show a figure, leave it out rather than estimating it.
3. Update `evidence` with independent, dated facts such as company releases, regulatory filings and reputable news, with URLs and publication dates.
4. Update `catalysts`: earnings and other scheduled events, marked *confirmed* or *estimated*.
5. Set `tilt` (−1 to +1) and write a `tilt_reason` based on near-term evidence such as revisions, rating changes and catalysts, not on 12-month targets. Use 0 when the evidence is mixed.
6. Set `evidence_strength` and its reason.
7. Commit the file, then run **Update prices** with "create forecasts" ticked and `research_file` set to the new path.

A reasonable cadence is every 2–4 weeks, and after major news.

## Other routine updates
* **Commentary:** edit `commentary.md` and commit.
* **Holdings or targets:** edit `holdings.json`. Target weights must sum to 100. New tickers need `symbols` for each provider, and ETFs need a `sector_exposure` block with source and as-of date. Then add the ticker to the next research file if it's an individual stock.
* **ETF look-through:** refresh `sector_exposure` from the latest fact sheets each quarter.
* **NYSE holidays:** extend the lists in `scripts/marketcal.py` **and** `assets/js/app.js` each year.
* **Sample data:** `python3 scripts/make_sample_data.py`.

## Limitations
* Free data can be delayed, incomplete or revised. Stooq's time-zone conversion assumes Europe/Warsaw local time. Finnhub's free quote endpoint covers the regular session only, so premarket and after-hours prices aren't captured.
* Total return and the performance chart are price returns, so they understate total return for dividend payers (e.g., BND, JNJ, PG, NEE, SHEL).
* Look-through sector figures are quarterly estimates and mix ICB-style fund data with stock classifications.
* The diversification score is a heuristic. Correlations can jump toward 1 in a crisis.
* Short-term forecasts have low reliability. Use them as research inputs, not trading signals.
* GitHub's scheduled workflows can be delayed during busy periods, and on repositories with no activity for 60 days they are disabled automatically.
