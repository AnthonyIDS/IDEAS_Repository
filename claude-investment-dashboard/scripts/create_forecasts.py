#!/usr/bin/env python3
"""Create a NEW, immutable batch of short-term stock forecasts.

    python scripts/create_forecasts.py --research data/research/research-2026-10-06.json

What it does
  * Reads the latest verified quotes (data/prices.json), daily history
    (data/history.json) and a dated manual research file.
  * For each individual stock, builds 14/28/42-calendar-day scenarios using that
    stock's own realized volatility, scheduled earnings inside each horizon, a
    neutral long-run drift, and a small research tilt (see README > Forecast
    methodology).
  * Appends the batch to data/predictions.json and writes an archive copy to
    data/predictions/archive/<batch-id>.json. Earlier batches are never edited.

It refuses to run on sample data, stale quotes or carried-forward quotes; those
stocks are recorded as "Insufficient evidence" with the reason.

  --sample   build an illustrative batch from data/sample/* (for the demo only;
             every record is labeled SAMPLE).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from marketcal import (ET, UTC, holiday_or_weekend_reason, is_trading_day,  # noqa: E402
                       next_trading_day_on_or_after, now_utc, trading_days_between)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
HORIZONS = [14, 28, 42]
LABEL = "Modeled short-term scenario informed by available research"


def load(p: Path):
    return json.loads(p.read_text())


def last_trading_session_on_or_before(d: date) -> date:
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def realized_daily_vol(series: list[list], end_date: str, window: int) -> float | None:
    closes = [c for d, c in series if d <= end_date]
    if len(closes) < window + 1:
        return None
    closes = closes[-(window + 1):]
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var)


def beta_vs(series: list[list], bench: list[list], end_date: str, window: int = 252) -> float | None:
    """OLS beta of daily log returns vs the benchmark over the last `window` common sessions."""
    a, b = dict((d, c) for d, c in series if d <= end_date), dict((d, c) for d, c in bench if d <= end_date)
    dates = sorted(set(a) & set(b))[-(window + 1):]
    if len(dates) < 64:
        return None
    ra = [math.log(a[dates[i]] / a[dates[i - 1]]) for i in range(1, len(dates))]
    rb = [math.log(b[dates[i]] / b[dates[i - 1]]) for i in range(1, len(dates))]
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    var = sum((y - mb) ** 2 for y in rb)
    return cov / var if var else None


def build_stock(ticker: str, holding: dict, research: dict, quote: dict | None, series: list | None,
                assumptions: dict, now: datetime, sample: bool, bench_series: list | None = None) -> dict:
    rec = {
        "ticker": ticker,
        "name": holding["name"],
        "label": ("SAMPLE — illustrative only, built from synthetic prices. " if sample else "") + LABEL,
        "consensus_12m": research.get("consensus"),
        "consensus_note": "Published 12-month analyst targets are shown for context only. They are not converted, scaled or interpolated into 2/4/6-week estimates.",
        "evidence": research.get("evidence", []),
        "catalysts": research.get("catalysts", []),
        "tilt": research.get("tilt", 0),
        "tilt_reason": research.get("tilt_reason", ""),
        "main_risk": holding.get("main_risk"),
    }
    if sample:
        # Never pair real analyst figures with synthetic prices.
        rec["consensus_12m"] = None
        rec["consensus_note"] = "Analyst consensus is hidden in sample mode so real research is never paired with synthetic prices."
        rec["evidence"] = []

    reasons = []
    if quote is None:
        reasons.append("No quote available.")
    elif quote.get("carried_forward"):
        reasons.append("Latest quote was carried forward from an earlier refresh, so the starting price is not current.")
    if quote is not None and not sample:
        qd = date.fromisoformat(quote["session_date"])
        latest = last_trading_session_on_or_before(now.astimezone(ET).date())
        if qd < latest - timedelta(days=4):
            reasons.append(f"Starting quote from {qd} is stale relative to the latest session ({latest}).")
    sigma = realized_daily_vol(series or [], quote["session_date"] if quote else "9999", assumptions["volatility_window_trading_days"]) if quote else None
    if sigma is None:
        reasons.append(f"Fewer than {assumptions['volatility_window_trading_days'] + 1} daily closes available to estimate volatility.")
    if reasons:
        rec.update({"status": "insufficient_evidence", "insufficient_reason": " ".join(reasons), "horizons": []})
        return rec

    start_date = date.fromisoformat(quote["session_date"])
    s0 = quote["price"]
    rec["start"] = {
        "price": s0,
        "quote_time_utc": quote["quote_time_utc"],
        "quote_time_et": quote.get("quote_time_et"),
        "session_type": quote.get("session_type"),
        "session_date": quote["session_date"],
        "provider": quote.get("provider"),
    }
    beta = beta_vs(series, bench_series or [], quote["session_date"]) if bench_series else None
    beta_used = min(max(beta, 0.0), 2.0) if beta is not None else 1.0
    rec["beta_vs_benchmark"] = round(beta, 2) if beta is not None else None
    rec["beta_used"] = round(beta_used, 2)
    rec["daily_volatility"] = round(sigma, 6)
    rec["annualized_volatility_pct"] = round(sigma * math.sqrt(252) * 100, 1)

    horizons = []
    for h in HORIZONS:
        target = start_date + timedelta(days=h)
        eval_session = next_trading_day_on_or_after(target)
        n = trading_days_between(start_date, eval_session)
        events = [c for c in research.get("catalysts", [])
                  if c.get("date") and start_date.isoformat() < c["date"] <= eval_session.isoformat()]
        var = n * sigma ** 2 + len(events) * (assumptions["earnings_event_variance_multiplier"] * sigma) ** 2
        sig_h = math.sqrt(var)
        drift = beta_used * assumptions["long_run_equity_drift_annual"] * n / 252
        tilt_shift = rec["tilt"] * assumptions["tilt_scale_sigma"] * sig_h
        mu = drift + tilt_shift
        w = assumptions["scenario_width_sigma"]
        base = s0 * math.exp(mu)
        bear = s0 * math.exp(mu - w * sig_h)
        bull = s0 * math.exp(mu + w * sig_h)

        factors = []
        for e in events:
            factors.append(f"{e['event']} on {e['date']} ({e['status']}) falls inside this window; scenario range widened for it.")
        if rec["tilt"]:
            factors.append(f"Research tilt {rec['tilt']:+g}: {rec['tilt_reason']}")
        else:
            factors.append(f"No directional tilt: {rec['tilt_reason']}")
        factors.append(f"Drift: {ticker}'s 1-year beta to the S&P 500 proxy ({rec['beta_used']}) x the assumed "
                       f"{assumptions['long_run_equity_drift_annual'] * 100:g}%/yr long-run equity return, over {n} sessions.")
        factors.append(f"Range width uses {ticker}'s own {assumptions['volatility_window_trading_days']}-day realized volatility "
                       f"({rec['annualized_volatility_pct']}% annualized) over {n} trading sessions.")
        risk = holding.get("main_risk")
        if events:
            risk = f"A surprise in {events[0]['event'].lower()} could move the price outside this range. " + (risk or "")

        reason = holiday_or_weekend_reason(target)
        horizons.append({
            "horizon_days": h,
            "target_date": target.isoformat(),
            "target_is_trading_day": reason is None,
            "target_non_trading_reason": reason,
            "evaluation_session": eval_session.isoformat(),
            "evaluation_rule": "Regular-session closing price on the target date, or on the next NYSE trading session if the target date is a weekend or holiday.",
            "trading_sessions": n,
            "earnings_events_in_window": len(events),
            "horizon_sigma": round(sig_h, 5),
            "base": round(base, 2),
            "base_change_pct": round((base / s0 - 1) * 100, 2),
            "bear": round(bear, 2),
            "bear_change_pct": round((bear / s0 - 1) * 100, 2),
            "bull": round(bull, 2),
            "bull_change_pct": round((bull / s0 - 1) * 100, 2),
            "supporting_factors": factors,
            "main_risk": risk,
            "evidence_strength": research.get("evidence_strength", "low"),
            "evidence_strength_reason": research.get("evidence_strength_reason", ""),
        })
    rec.update({"status": "ok", "horizons": horizons})
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--research", required=True)
    ap.add_argument("--sample", action="store_true")
    args = ap.parse_args()

    research_path = (ROOT / args.research) if not Path(args.research).is_absolute() else Path(args.research)
    research = load(research_path)
    holdings = {h["ticker"]: h for h in load(DATA / "holdings.json")["holdings"]}

    if args.sample:
        prices = load(DATA / "sample" / "prices.sample.json")
        history = load(DATA / "sample" / "history.sample.json")
        out_path = DATA / "sample" / "predictions.sample.json"
        archive_dir = None
    else:
        prices = load(DATA / "prices.json")
        history = load(DATA / "history.json")
        if prices.get("data_status") != "live" or history.get("data_status") != "live":
            print("Refusing to forecast from non-live data. Run fetch_prices.py first.", file=sys.stderr)
            return 1
        out_path = DATA / "predictions.json"
        archive_dir = DATA / "predictions" / "archive"

    now = now_utc()
    batch_id = ("sample-" if args.sample else "fc-") + now.strftime("%Y%m%dT%H%M%SZ")
    forecasts = []
    for ticker, r in research["stocks"].items():
        h = holdings.get(ticker)
        if not h or h.get("role") != "satellite":
            continue
        forecasts.append(build_stock(ticker, h, r, prices["quotes"].get(ticker),
                                     history["series"].get(ticker), research["model_assumptions"], now, args.sample,
                                     history["series"].get(prices.get("benchmark_ticker", "SPY"))))

    batch = {
        "batch_id": batch_id,
        "is_sample": args.sample,
        "created_at_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "created_at_et": now.astimezone(ET).isoformat(timespec="seconds"),
        "created_at_note": "Forecast creation time. Independent of price refreshes; later quote updates never change this value.",
        "research_id": research["research_id"],
        "research_file": str(research_path.relative_to(ROOT)),
        "research_compiled_at": research["compiled_at"],
        "consensus_policy": research.get("consensus_policy"),
        "model_assumptions": research["model_assumptions"],
        "price_snapshot_refresh_utc": prices.get("last_successful_refresh_utc"),
        "forecasts": forecasts,
    }

    store = json.loads(out_path.read_text()) if out_path.exists() else {}
    store.setdefault("schema_version", 1)
    store.setdefault("batches", [])
    store.setdefault("evaluations", {})
    if any(b["batch_id"] == batch_id for b in store["batches"]):
        print("Batch id collision; try again in a second.", file=sys.stderr)
        return 1
    store["batches"].append(batch)
    if archive_dir:
        archive_dir.mkdir(parents=True, exist_ok=True)
        ap_ = archive_dir / f"{batch_id}.json"
        ap_.write_text(json.dumps(batch, indent=2) + "\n")
        batch["archive_path"] = str(ap_.relative_to(ROOT))
    out_path.write_text(json.dumps(store, indent=2) + "\n")
    ok = sum(1 for f in forecasts if f["status"] == "ok")
    print(f"Created batch {batch_id}: {ok}/{len(forecasts)} stocks with numeric scenarios.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
