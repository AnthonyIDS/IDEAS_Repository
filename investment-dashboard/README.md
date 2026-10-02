# The Patient Portfolio

A static, mobile-friendly educational investment dashboard. Plain HTML, CSS and JavaScript; Chart.js 4.5.1 UMD from cdnjs. No bundler, package installation, database or frontend API key. Light/dark mode, local theme preference, keyboard controls, searchable holdings, chart fallbacks, editable Markdown commentary and JSON data.

**Educational content only, not personalized financial advice.** The portfolio is hypothetical and has not been assessed for your objectives, time horizon, tax position or capacity for loss. Sample prices and five-year history are fictional, not actual returns, forecasts or a backtest. Stocks shown are research candidates, not claims of attractive current valuations.

## Repository layout

This project lives alongside the existing IDEAS pages:

```text
.github/workflows/investment-dashboard.yml  # at repository root
investment-dashboard/
  index.html
  styles.css
  app.js
  model.mjs
  holdings.json
  prices.json
  commentary.md
  README.md
  scripts/update-prices.mjs
  scripts/generate_sample.py
  tests/model.test.mjs
  tests/fixtures/holdings.json
```

The optional `.github/workflows` copy inside the dashboard download is a template: GitHub only runs workflows placed in the repository root `.github/workflows/`. The committed project uses that root location.

## Run immediately

From the repository root:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/investment-dashboard/`. Opening `index.html` directly with `file://` will not allow JSON fetching in most browsers. Internet access is needed for the Chart.js CDN; if it fails, numerical holdings/exposure and commentary remain readable. Data comes only from same-directory JSON and Markdown; the browser makes no market API requests. No build step. Node is used only for tests and the scheduled updater.

## Enable GitHub Pages

1. In `AnthonyIDS/IDEAS_Repository`, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. If the existing site uses branch publishing, switch it once; this workflow preserves existing repository pages in its deployment artifact.
2. Open **Settings → Actions → General** and ensure GitHub Actions are enabled and repository policy permits the workflow's `contents: write`, `pages: write` and `id-token: write` permissions. A branch rule blocking bot pushes must be accommodated by the repository owner; do not disable protections blindly.
3. For the immediate demo, open **Actions → Investment dashboard → Run workflow**, select `main`, and uncheck **Fetch a fresh Finnhub snapshot**. No API key is needed for the sample deployment.
4. After successful deployment, visit `https://anthonyids.github.io/IDEAS_Repository/investment-dashboard/`. Existing root pages retain their paths. If the repository uses a custom domain, append `/investment-dashboard/` to that site's base URL.
5. To enable real quotes, obtain a free API key from [Finnhub](https://finnhub.io/) and add **Settings → Secrets and variables → Actions → New repository secret**, named `FINNHUB_API_KEY`. Never paste the key into a file or chat. Confirm your Finnhub account's current access and redistribution terms before publicly publishing provider data.
6. Run the workflow with refresh checked. It fetches the 11 holdings plus SPY, validates the complete snapshot, commits `prices.json`, and deploys in the same run. It also runs weekdays at **22:37 UTC** (6:37 p.m. EDT / 5:37 p.m. EST). GitHub schedules may be delayed, and inactive public repositories can have scheduled workflows disabled.

The schedule is GitHub Actions, not a separate reminder. Markets are closed on some weekdays; duplicate quote dates replace that day's record rather than creating fake trading days. The free quote endpoint does not provide five years of history here. Real observations accumulate starting with the first successful fetch. All period buttons show the available portion of their selected window, with exact dates. The first live snapshot discards synthetic history; it is never spliced into live performance.

Commits made with `GITHUB_TOKEN` do not trigger another Pages build. That is why refresh, commit and explicit Pages deployment are in one workflow. Pushes to other existing pages do not match this workflow's path filter: run this workflow manually with refresh off when deploying unrelated site changes, or deliberately broaden the filter if this becomes the repository's sole deployment workflow.

## The model portfolio

| Holding | Target | Role | Main risk |
|---|---:|---|---|
| VTI | 35% | Broad US equity core | Equity drawdowns and technology concentration |
| VEA | 15% | Developed international core | Currency and foreign-market risks |
| BND | 15% | Investment-grade bond core | Rate and credit risk |
| MSFT | 5% | Enterprise software and cloud | Valuation and AI capital spending |
| JNJ | 5% | Defensive health care | Litigation and patent expirations |
| BRK.B | 5% | Diversified businesses and insurance | Insurance losses and leadership transition |
| PG | 4% | Consumer staples | Input costs and private-label competition |
| UNP | 4% | Rail infrastructure | Economic cycle, labor and regulation |
| XOM | 4% | Integrated energy | Commodity cycles and energy transition |
| NEE | 4% | Utilities and power infrastructure | Financing costs and execution |
| HD | 4% | Home improvement retail | Housing and consumer weakness |

Core 65%; satellite 35%; 11 holdings; eight individual stocks in eight sectors. Equity 85%, bonds 15%, developed international equity 15%. No emerging markets. Target weights are a model; actual weights move with prices and shares. Each holding's one-line thesis and risk live in `holdings.json` and appear in the table.

Broad influences: Bogle's low-cost indexing, Graham's valuation discipline/margin of safety, and Buffett's focus on durable economics and patient ownership. These are general principles, not endorsements or a replica of any manager's portfolio. No intrinsic-value estimate has been calculated. Before purchasing, test a conservative valuation against a range of outcomes; position size is not a substitute for price discipline.

## Editing your data

- Edit `holdings.json`: `ticker`, optional provider `apiSymbol`, `name`, `type` (`ETF` or `Stock`), `sleeve` (`Core` or `Satellite`), `assetClass` (`US equity`, `International equity`, `Bonds`), `sector`, `target` (percentage, e.g. 5), `shares`, `costBasis` (USD per share), `thesis`, and `risk`. Targets must sum to 100. All sample quantities and cost bases are invented.
- Replace sample share counts and costs before interpreting personal returns. Set a top-level `"basis": "actual"` only after doing so; otherwise the live banner retains a warning that inputs are hypothetical. Fractional shares are supported. No cash account, flows, lots, realized gains, withholding or transaction ledger is modeled.
- ETFs holding stocks need `sectorExposure`: nonnegative percentages summing to 100. **Included ETF sector mixes are illustrative assumptions, not fetched current data.** Refresh from issuer factsheets. Sector names must match across holdings. Berkshire is treated as Financials for this coarse view despite diverse operating businesses.
- Direct stocks must remain ≤8%; estimated underlying equity sectors ≤25%; at least six direct-stock sectors. The 8% rule applies to direct stock positions, not indirect ownership through ETFs. Security-level ETF overlap is not quantified. A true issuer-level limit needs constituent data. Bonds are an asset class, not an equity sector.
- Edit `commentary.md` to update The Veteran's Desk. Supported safe Markdown subset: `#`, `##`, `###` headings, paragraphs separated by blank lines, and `- ` lists. HTML is rendered as text; links/emphasis are not parsed. The voice is fictional; it does not claim actual investment experience.
- Do not manually merge sample and actual history. Changes to shares, tickers, provider symbols, their ordering or benchmark restart live history, preventing apparent performance from reflecting deposits or edits. Targets, commentary, cost basis and sector estimates can change without restarting the price series.
- Stock splits require manually updating shares and cost basis. Quotes are not split-adjusted historical series; after the share correction, history resets. Without that correction the display may show a false loss. This is a lightweight model dashboard, not brokerage accounting software.

## Calculation definitions

- Market value = sum(shares × quote price). Day change = current market value minus sum(shares × provider previous close); day percentage divides by previous value. Scheduled snapshots are not streaming quotes or guaranteed official closing prices.
- **Total return card:** unrealized price gain versus entered cost, `(market value / cost basis value − 1) × 100`. Its visible footnote states that distributions are excluded. This is not true total return. Dividends, interest distributions, taxes, trading costs and realized gains are not included.
- Performance: value of unchanged configured shares and SPY price, independently normalized to 100 at the first available observation in each selected period. SPY is an ETF proxy for the S&P 500, not the index itself; price changes exclude dividends and reflect ETF tracking differences. BND distributions are also excluded. No assumption of reinvestment or periodic rebalancing is made.
- History is retained for 1,600 observations (approximately six trading years). Windows are relative to the latest observation, not the viewer's date. Sample history is seeded synthetic data, sampled roughly weekly, without an exchange holiday calendar.
- Drift = current weight minus target, in **percentage points**. Alert only when absolute drift is greater than 5 (exactly 5 is not an alert). The stock/sector limits are separate checks.
- Policy score = fraction of eight equally weighted checks passed × 100, rounded. The UI lists the checks. It is not volatility, correlation, maximum drawdown, Value at Risk or a validated diversification model. A score of 100 does not mean safe.

## Data reliability and security

The updater uses the Finnhub quote endpoint and passes the secret in `X-Finnhub-Token`, never in URLs, frontend code or output. Requests are paced, timed out, and retried up to three times. All symbols must have valid positive prices and timestamps no older than five calendar days, and share one New York quote session. Missing, stale, mixed-session or rate-limited data fails the job; the prior JSON remains intact. Holidays may cause a retained snapshot. Errors do not dump provider responses or secrets. Writes use a temporary file and atomic rename only after validation.

A live snapshot older than five days shows a stale warning. A failed updater does not redeploy; the existing site stays available. Check Actions logs to resolve provider symbol/access issues (including `BRK.B`), missing secrets, quota limits or repository permissions. Public GitHub Pages and public Git history expose holdings, quantities, costs and commentary. Use only information you intend to publish; a private repository does not automatically make a Pages site private.

## Tests

```sh
node --test investment-dashboard/tests/model.test.mjs
```

Requires Node 22+. Tests cover allocation accounting, concentration/drift, invalid inputs, all period ranges, sample-to-live separation, quote-session alignment, history resets and API-key placement. No API key is needed for tests. A live provider call must be verified in your GitHub Actions environment after adding your key.

## Sources and documentation

- [Investor.gov: allocation, diversification and rebalancing](https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset)
- [Vanguard VTI](https://investor.vanguard.com/investment-products/etfs/profile/vti), [VEA](https://investor.vanguard.com/investment-products/etfs/profile/vea), [BND](https://investor.vanguard.com/investment-products/etfs/profile/bnd): current fund documentation and risks. Expense ratios are not hard-coded; verify current issuer fees.
- [Finnhub quote API](https://finnhub.io/docs/api/quote)
- [Chart.js on cdnjs](https://cdnjs.com/libraries/Chart.js)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub publishing sources and bot-commit limitation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
