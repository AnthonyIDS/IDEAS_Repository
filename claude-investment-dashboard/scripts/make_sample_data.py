#!/usr/bin/env python3
"""Generate clearly labeled SYNTHETIC sample data so the dashboard works before
the first real price refresh. Every series starts at exactly 100.00 and is a
seeded random walk; none of it is market data.

    python scripts/make_sample_data.py
"""
from __future__ import annotations

import json
import math
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from marketcal import ET, UTC, is_trading_day, now_utc  # noqa: E402
from create_forecasts import build_stock  # noqa: E402
from evaluate_forecasts import evaluate  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SAMPLE = DATA / "sample"
NOTE = "SAMPLE DATA — synthetic random walk starting at 100.00. Not market prices. For layout demonstration only."

# Synthetic parameters (annual drift, annual vol) chosen only to make the demo look varied.
PARAMS = {"VTI": (0.09, 0.17), "VEA": (0.06, 0.16), "BND": (0.01, 0.06), "MSFT": (0.12, 0.27),
          "BRK.B": (0.08, 0.18), "JNJ": (0.05, 0.17), "PG": (0.05, 0.16), "NEE": (0.03, 0.24),
          "UNP": (0.07, 0.22), "SHEL": (0.06, 0.25), "SPY": (0.09, 0.17)}


def trading_days(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def main() -> None:
    SAMPLE.mkdir(parents=True, exist_ok=True)
    now = now_utc()
    today_et = now.astimezone(ET).date()
    end = today_et - timedelta(days=1)
    while not is_trading_day(end):
        end -= timedelta(days=1)
    days = trading_days(end - timedelta(days=int(365 * 5.5)), end)

    rng = random.Random(20261006)
    series = {}
    for t, (mu, vol) in PARAMS.items():
        p, s = 100.0, []
        sd = vol / math.sqrt(252)
        for d in days:
            s.append([d.isoformat(), round(p, 4)])
            p *= math.exp((mu - 0.5 * vol * vol) / 252 + sd * rng.gauss(0, 1))
        series[t] = s

    history = {"data_status": "sample", "sample_note": NOTE, "updated_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "price_basis": "Synthetic.", "sources": {t: "synthetic" for t in series}, "series": series}

    close_dt = datetime.combine(end, datetime.min.time()).replace(hour=16, tzinfo=ET)
    quotes = {}
    for t, s in series.items():
        quotes[t] = {"price": s[-1][1], "prev_close": s[-2][1], "quote_time_utc": close_dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "quote_time_et": close_dt.isoformat(), "session_type": "regular_close", "session_date": end.isoformat(),
                     "provider": "SAMPLE (synthetic)", "carried_forward": False}
    prices = {"data_status": "sample", "sample_note": NOTE, "last_successful_refresh_utc": None,
              "benchmark_ticker": "SPY", "quotes": quotes}

    (SAMPLE / "history.sample.json").write_text(json.dumps(history) + "\n")
    (SAMPLE / "prices.sample.json").write_text(json.dumps(prices, indent=2) + "\n")

    # Two illustrative forecast batches: one started ~70 days ago (now evaluated) and one current.
    research = json.loads(sorted((DATA / "research").glob("research-*.json"))[-1].read_text())
    holdings = {h["ticker"]: h for h in json.loads((DATA / "holdings.json").read_text())["holdings"]}
    store = {"schema_version": 1, "is_sample": True, "sample_note": NOTE, "batches": [], "evaluations": {}}
    for offset in (70, 0):
        idx = len(days) - 1 - offset
        start = days[idx]
        created = datetime.combine(start, datetime.min.time()).replace(hour=17, tzinfo=ET)
        batch_quotes = {}
        for t, s in series.items():
            batch_quotes[t] = dict(quotes[t], price=s[idx][1], session_date=start.isoformat(),
                                   quote_time_utc=datetime.combine(start, datetime.min.time()).replace(hour=16, tzinfo=ET).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                   quote_time_et=datetime.combine(start, datetime.min.time()).replace(hour=16, tzinfo=ET).isoformat())
        fcs = []
        for t, r in research["stocks"].items():
            fcs.append(build_stock(t, holdings[t], r, batch_quotes[t], series[t][: idx + 1],
                                   research["model_assumptions"], created.astimezone(UTC), sample=True,
                                   bench_series=series["SPY"][: idx + 1]))
        store["batches"].append({
            "batch_id": f"sample-{start.isoformat()}", "is_sample": True,
            "created_at_utc": created.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "created_at_et": created.isoformat(timespec="seconds"),
            "created_at_note": "SAMPLE creation time (synthetic).",
            "research_id": research["research_id"] + " (applied to synthetic prices)",
            "research_file": None, "research_compiled_at": research["compiled_at"],
            "consensus_policy": research.get("consensus_policy"),
            "model_assumptions": research["model_assumptions"], "forecasts": fcs})
    evaluate(store, history, now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    (SAMPLE / "predictions.sample.json").write_text(json.dumps(store, indent=2) + "\n")
    print("Sample data written to", SAMPLE)


if __name__ == "__main__":
    main()
