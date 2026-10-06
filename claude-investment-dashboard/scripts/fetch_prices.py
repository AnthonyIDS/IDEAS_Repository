#!/usr/bin/env python3
"""Fetch latest quotes and daily price history, then write data/prices.json
and data/history.json.

Providers (free tiers):
  Quotes : Finnhub /quote (needs FINNHUB_API_KEY)  ->  fallback Stooq quote CSV
  History: Stooq daily CSV (optional STOOQ_API_KEY) ->  fallback Alpha Vantage
           TIME_SERIES_DAILY compact (needs ALPHAVANTAGE_API_KEY), merged into
           the existing history so earlier data is never lost.

Safety rules
  * Files are only replaced after validation. If every quote fails, the previous
    prices.json is left untouched and the script exits non-zero.
  * If one ticker fails, its previous quote is carried forward with its ORIGINAL
    timestamp and flagged carried_forward=true. Retrieval time never replaces the
    quote time.
  * data/refresh-status.json records every attempt (success or failure).

Standard library only. Run from the repository root:  python scripts/fetch_prices.py
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from marketcal import UTC, classify_session, now_utc  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
HOLDINGS = DATA / "holdings.json"
PRICES = DATA / "prices.json"
HISTORY = DATA / "history.json"
STATUS = DATA / "refresh-status.json"

# Stooq reports quote times in Polish local time (CET/CEST). Verify if Stooq
# changes this; the conversion below assumes Europe/Warsaw.
STOOQ_TZ = ZoneInfo("Europe/Warsaw")
HISTORY_YEARS = 5.5
UA = {"User-Agent": "static-investment-dashboard/1.0 (+GitHub Actions)"}


def http_get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json_atomic(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2) + "\n")
    json.loads(tmp.read_text())  # validate before replacing
    tmp.replace(path)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- quotes
def quote_finnhub(symbol: str, key: str) -> dict:
    url = "https://finnhub.io/api/v1/quote?" + urllib.parse.urlencode({"symbol": symbol, "token": key})
    q = json.loads(http_get(url))
    if not q or not q.get("c") or not q.get("t"):
        raise ValueError(f"Finnhub returned no quote for {symbol}: {q}")
    ts = datetime.fromtimestamp(int(q["t"]), tz=UTC)
    return {
        "price": float(q["c"]),
        "prev_close": float(q["pc"]) if q.get("pc") else None,
        "quote_time_utc": iso(ts),
        "_ts": ts,
        "provider": "Finnhub /quote",
        "provider_note": "Finnhub free tier; regular-session data. Session type is inferred from the quote timestamp.",
    }


def quote_stooq(symbol: str) -> dict:
    url = "https://stooq.com/q/l/?" + urllib.parse.urlencode({"s": symbol, "f": "sd2t2ohlcv", "h": "", "e": "csv"})
    key = os.environ.get("STOOQ_API_KEY")
    if key:
        url += "&apikey=" + urllib.parse.quote(key)
    rows = list(csv.DictReader(io.StringIO(http_get(url))))
    if not rows or rows[0].get("Close") in (None, "", "N/D"):
        raise ValueError(f"Stooq returned no quote for {symbol}")
    r = rows[0]
    local = datetime.strptime(f"{r['Date']} {r['Time']}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=STOOQ_TZ)
    ts = local.astimezone(UTC)
    return {
        "price": float(r["Close"]),
        "prev_close": None,
        "quote_time_utc": iso(ts),
        "_ts": ts,
        "provider": "Stooq quote CSV",
        "provider_note": "Stooq free data; may be delayed. Time converted from Europe/Warsaw. Session type is inferred from the timestamp.",
    }


# ---------------------------------------------------------------- history
def history_stooq(symbol: str) -> list[list]:
    url = "https://stooq.com/q/d/l/?" + urllib.parse.urlencode({"s": symbol, "i": "d"})
    key = os.environ.get("STOOQ_API_KEY")
    if key:
        url += "&apikey=" + urllib.parse.quote(key)
    text = http_get(url, timeout=40)
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or "Close" not in rows[0]:
        raise ValueError(f"Stooq history unavailable for {symbol}: {text[:120]!r}")
    cutoff = (date.today() - timedelta(days=int(365 * HISTORY_YEARS))).isoformat()
    out = [[r["Date"], round(float(r["Close"]), 4)] for r in rows if r["Date"] >= cutoff and r["Close"]]
    if len(out) < 20:
        raise ValueError(f"Stooq history too short for {symbol}")
    return out


def history_alphavantage(symbol: str, key: str) -> list[list]:
    url = "https://www.alphavantage.co/query?" + urllib.parse.urlencode(
        {"function": "TIME_SERIES_DAILY", "symbol": symbol, "outputsize": "compact", "apikey": key})
    j = json.loads(http_get(url, timeout=40))
    series = j.get("Time Series (Daily)")
    if not series:
        raise ValueError(f"Alpha Vantage history unavailable for {symbol}: {str(j)[:160]}")
    time.sleep(13)  # free tier: 5 requests/minute
    return sorted([[d, round(float(v["4. close"]), 4)] for d, v in series.items()])


def merge_series(old: list[list], new: list[list]) -> list[list]:
    merged = {d: c for d, c in (old or [])}
    merged.update({d: c for d, c in new})
    return [[d, merged[d]] for d in sorted(merged)]


# ---------------------------------------------------------------- main
def main() -> int:
    holdings = read_json(HOLDINGS)
    bench = holdings["portfolio"]["rules"]["benchmark"]["proxy_ticker"]
    symbols = {h["ticker"]: h["symbols"] for h in holdings["holdings"]}
    symbols.setdefault(bench, {"finnhub": bench, "stooq": bench.lower() + ".us", "alphavantage": bench})

    finnhub_key = os.environ.get("FINNHUB_API_KEY", "").strip()
    av_key = os.environ.get("ALPHAVANTAGE_API_KEY", "").strip()
    started = now_utc()
    errors: list[str] = []

    prev_prices = read_json(PRICES, {}) or {}
    prev_quotes = prev_prices.get("quotes", {}) if prev_prices.get("data_status") == "live" else {}
    prev_hist = read_json(HISTORY, {}) or {}
    prev_series = prev_hist.get("series", {}) if prev_hist.get("data_status") == "live" else {}

    # ---- history first (used for previous close when a provider lacks it)
    series, hist_sources = {}, {}
    for t, s in symbols.items():
        try:
            series[t] = merge_series(prev_series.get(t), history_stooq(s["stooq"]))
            hist_sources[t] = "Stooq daily CSV"
        except Exception as e:  # noqa: BLE001
            errors.append(f"history {t} (Stooq): {e}")
            if av_key:
                try:
                    series[t] = merge_series(prev_series.get(t), history_alphavantage(s["alphavantage"], av_key))
                    hist_sources[t] = "Alpha Vantage TIME_SERIES_DAILY (compact) merged with prior history"
                    continue
                except Exception as e2:  # noqa: BLE001
                    errors.append(f"history {t} (Alpha Vantage): {e2}")
            if prev_series.get(t):
                series[t] = prev_series[t]
                hist_sources[t] = "carried forward from previous successful refresh"

    # ---- quotes
    quotes, fresh = {}, 0
    for t, s in symbols.items():
        q = None
        providers = ([("finnhub", lambda: quote_finnhub(s["finnhub"], finnhub_key))] if finnhub_key else []) + \
                    [("stooq", lambda: quote_stooq(s["stooq"]))]
        for name, fn in providers:
            try:
                q = fn()
                break
            except Exception as e:  # noqa: BLE001
                errors.append(f"quote {t} ({name}): {e}")
        if q:
            ts = q.pop("_ts")
            sess = classify_session(ts)
            if q["prev_close"] is None and series.get(t):
                prior = [c for d, c in series[t] if d < sess["session_date"]]
                q["prev_close"] = prior[-1] if prior else None
            q.update(sess)
            q["retrieved_at_utc"] = iso(started)
            q["carried_forward"] = False
            quotes[t] = q
            fresh += 1
        elif t in prev_quotes:
            old = dict(prev_quotes[t])
            old["carried_forward"] = True
            old["carry_note"] = "Latest refresh failed for this ticker; showing the previous quote with its original timestamp."
            quotes[t] = old

    status = read_json(STATUS, {}) or {}
    status.update({
        "last_attempt_utc": iso(started),
        "last_attempt_errors": errors[-40:],
        "quotes_refreshed": fresh,
        "quotes_expected": len(symbols),
    })

    if fresh == 0:
        status["last_attempt_outcome"] = "failed — previous snapshot preserved"
        write_json_atomic(STATUS, status)
        print("No quotes retrieved; previous prices.json preserved.", file=sys.stderr)
        return 1

    finished = now_utc()
    prices = {
        "data_status": "live",
        "last_successful_refresh_utc": iso(finished),
        "refresh_note": "Time this file was last written successfully. Each quote has its own quote_time_utc, which can be older.",
        "benchmark_ticker": bench,
        "quotes": quotes,
    }
    write_json_atomic(PRICES, prices)

    if series:
        history = {
            "data_status": "live",
            "updated_utc": iso(finished),
            "price_basis": "Daily closing prices as published by the source. Stooq series are split-adjusted; dividend treatment follows the source. The same series type is used for the portfolio and the benchmark.",
            "sources": hist_sources,
            "series": series,
        }
        write_json_atomic(HISTORY, history)

    status.update({
        "last_attempt_outcome": "success" if fresh == len(symbols) else f"partial — {len(symbols) - fresh} ticker(s) carried forward",
        "last_success_utc": iso(finished),
    })
    write_json_atomic(STATUS, status)
    print(f"Refreshed {fresh}/{len(symbols)} quotes; {len(series)} history series.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
