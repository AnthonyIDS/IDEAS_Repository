#!/usr/bin/env python3
"""Score forecasts whose evaluation session has closed.

Evaluations are stored in predictions.json under "evaluations", keyed by
"<batch_id>|<ticker>|<horizon_days>". Forecast records themselves are never
modified. Run after fetch_prices.py:  python scripts/evaluate_forecasts.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from marketcal import now_utc  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def evaluate(store: dict, history: dict, now_iso: str) -> int:
    evals = store.setdefault("evaluations", {})
    added = 0
    for b in store.get("batches", []):
        for f in b.get("forecasts", []):
            if f.get("status") != "ok":
                continue
            series = dict((d, c) for d, c in history.get("series", {}).get(f["ticker"], []))
            last_date = max(series) if series else None
            for h in f["horizons"]:
                key = f"{b['batch_id']}|{f['ticker']}|{h['horizon_days']}"
                if key in evals and evals[key].get("status") == "completed":
                    continue
                sess = h["evaluation_session"]
                if last_date is None or last_date < sess:
                    continue  # still pending
                if sess not in series:
                    evals[key] = {"status": "awaiting_data",
                                  "note": f"No closing price found for evaluation session {sess}.",
                                  "checked_at_utc": now_iso}
                    continue
                obs = series[sess]
                evals[key] = {
                    "status": "completed",
                    "evaluation_session": sess,
                    "observed_close": round(obs, 2),
                    "observed_source": history.get("sources", {}).get(f["ticker"], "history.json"),
                    "base": h["base"],
                    "error_usd": round(obs - h["base"], 2),
                    "error_pct": round((obs / h["base"] - 1) * 100, 2),
                    "abs_error_pct": round(abs(obs / h["base"] - 1) * 100, 2),
                    "within_scenario_range": h["bear"] <= obs <= h["bull"],
                    "evaluated_at_utc": now_iso,
                }
                added += 1
    store["last_evaluated_utc"] = now_iso
    return added


def main() -> int:
    sample = "--sample" in sys.argv
    pred_path = DATA / ("sample/predictions.sample.json" if sample else "predictions.json")
    hist_path = DATA / ("sample/history.sample.json" if sample else "history.json")
    if not pred_path.exists() or not hist_path.exists():
        print("Nothing to evaluate.")
        return 0
    store = json.loads(pred_path.read_text())
    history = json.loads(hist_path.read_text())
    if not sample and history.get("data_status") != "live":
        print("History is not live; skipping evaluation.")
        return 0
    before = json.dumps(store.get("evaluations", {}), sort_keys=True)
    n = evaluate(store, history, now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"))
    if json.dumps(store.get("evaluations", {}), sort_keys=True) != before:
        pred_path.write_text(json.dumps(store, indent=2) + "\n")
    print(f"Completed {n} new evaluation(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
