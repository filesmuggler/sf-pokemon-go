"""Ingest San Francisco 311 cases from DataSF (SODA API) into Elasticsearch.

Usage:
    uv run scripts/ingest_311.py                 # last 90 days by requested_datetime
    uv run scripts/ingest_311.py --days 7 --limit 500   # quick test
    uv run scripts/ingest_311.py --by updated --days 2  # refresh cases changed recently

Documents use service_request_id as _id, so re-running updates in place.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Iterator
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from elasticsearch import Elasticsearch, helpers

SODA_URL = "https://data.sf.gov/resource/vw6y-z8j6.json"
INDEX = "sf_311"
SF_TZ = ZoneInfo("America/Los_Angeles")
ELSER_ENDPOINT = ".elser-2-elastic"

# Socrata timestamps are "floating" (no zone) and are SF local time.
DATE_FIELDS = ["requested_datetime", "updated_datetime", "closed_date", "data_as_of", "data_loaded_at"]

MAPPINGS = {
    "dynamic": "false",
    "properties": {
        "service_request_id": {"type": "keyword"},
        "requested_datetime": {"type": "date"},
        "updated_datetime": {"type": "date"},
        "closed_date": {"type": "date"},
        "status_description": {"type": "keyword"},
        "status_notes": {"type": "text"},
        "agency_responsible": {"type": "keyword"},
        "service_name": {"type": "keyword"},
        "service_subtype": {"type": "keyword"},
        "service_details": {"type": "keyword"},
        "address": {"type": "text", "fields": {"raw": {"type": "keyword"}}},
        "street": {"type": "keyword"},
        "supervisor_district": {"type": "keyword"},
        "neighborhood": {"type": "keyword"},
        "analysis_neighborhood": {"type": "keyword"},
        "police_district": {"type": "keyword"},
        "source": {"type": "keyword"},
        "media_url": {"type": "keyword", "index": False},
        "location": {"type": "geo_point"},
        "data_as_of": {"type": "date"},
        "data_loaded_at": {"type": "date"},
        # Human-readable summary: BM25 on search_text, ELSER sparse vectors on search_semantic.
        "search_text": {"type": "text", "copy_to": "search_semantic"},
        "search_semantic": {"type": "semantic_text", "inference_id": ELSER_ENDPOINT},
    },
}


def to_iso(value: str | None) -> str | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value).replace(tzinfo=SF_TZ)
    return dt.isoformat()


def humanize(code: str | None) -> str:
    return (code or "").replace("_", " ").strip()


def build_search_text(r: dict) -> str:
    parts = [r.get("service_name") or ""]
    sub = humanize(r.get("service_subtype"))
    det = humanize(r.get("service_details"))
    if sub:
        parts.append(f"- {sub}")
    if det:
        parts.append(f"({det})")
    text = " ".join(parts) + "."
    where = ", ".join(x for x in [r.get("address"), r.get("analysis_neighborhood")] if x)
    if where:
        text += f" Location: {where}."
    status = r.get("status_description")
    if status:
        text += f" Status: {status}"
        if r.get("status_notes"):
            text += f" - {r['status_notes']}"
        text += "."
    return text


def transform(r: dict) -> dict:
    doc = {
        k: r.get(k)
        for k in [
            "service_request_id", "status_description", "status_notes", "agency_responsible",
            "service_name", "service_subtype", "service_details", "address", "street",
            "analysis_neighborhood", "police_district", "source",
        ]
        if r.get(k) not in (None, "")
    }
    if r.get("neighborhoods_sffind_boundaries"):
        doc["neighborhood"] = r["neighborhoods_sffind_boundaries"]
    if r.get("supervisor_district"):
        doc["supervisor_district"] = r["supervisor_district"].split(".")[0]
    for f in DATE_FIELDS:
        if r.get(f):
            doc[f] = to_iso(r[f])
    if isinstance(r.get("media_url"), dict) and r["media_url"].get("url"):
        doc["media_url"] = r["media_url"]["url"]
    try:
        lat, lon = float(r["lat"]), float(r["long"])
        if 37.0 < lat < 38.5 and -123.5 < lon < -121.5:  # sanity: SF bay area
            doc["location"] = {"lat": lat, "lon": lon}
    except (KeyError, TypeError, ValueError):
        pass
    doc["search_text"] = build_search_text(r)
    return doc


def fetch(since: str, by_field: str, batch: int, limit: int | None) -> Iterator[dict]:
    """Keyset pagination on (by_field, service_request_id) - no growing $offset."""
    session = requests.Session()
    last_ts, last_id, seen = None, None, 0
    while True:
        where = f"{by_field} >= '{since}'"
        if last_ts is not None:
            where += (
                f" AND ({by_field} > '{last_ts}'"
                f" OR ({by_field} = '{last_ts}' AND service_request_id > '{last_id}'))"
            )
        size = batch if limit is None else min(batch, limit - seen)
        params = {"$where": where, "$order": f"{by_field} ASC, service_request_id ASC", "$limit": size}
        for attempt in range(5):
            try:
                resp = session.get(SODA_URL, params=params, timeout=120)
                resp.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt == 4:
                    raise
                print(f"  SODA error ({e}); retrying...", file=sys.stderr)
                time.sleep(2 ** attempt)
        rows = resp.json()
        if not rows:
            return
        yield from rows
        seen += len(rows)
        last_ts, last_id = rows[-1][by_field], rows[-1]["service_request_id"]
        if len(rows) < size or (limit is not None and seen >= limit):
            return


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--by", choices=["requested", "updated"], default="requested")
    ap.add_argument("--limit", type=int, default=None, help="max records (for testing)")
    ap.add_argument("--batch", type=int, default=5000, help="SODA page size")
    ap.add_argument("--recreate", action="store_true", help="delete and recreate the index")
    args = ap.parse_args()

    load_dotenv()
    es = Elasticsearch(
        os.environ["ELASTIC_URL"], api_key=os.environ["ELASTIC_API_KEY"],
        request_timeout=300, retry_on_timeout=True, max_retries=5,
    )

    if args.recreate and es.indices.exists(index=INDEX):
        es.indices.delete(index=INDEX)
    if not es.indices.exists(index=INDEX):
        es.indices.create(index=INDEX, mappings=MAPPINGS)
        print(f"created index {INDEX}")

    by_field = f"{args.by}_datetime"
    since = (datetime.now(SF_TZ) - timedelta(days=args.days)).strftime("%Y-%m-%dT00:00:00")
    print(f"fetching cases with {by_field} >= {since} (SF time)")

    actions = (
        {"_index": INDEX, "_id": r["service_request_id"], "_source": transform(r)}
        for r in fetch(since, by_field, args.batch, args.limit)
    )
    ok = failed = 0
    t0 = time.time()
    for success, info in helpers.streaming_bulk(
        es, actions, chunk_size=500, raise_on_error=False, max_retries=5, initial_backoff=2,
    ):
        if success:
            ok += 1
        else:
            failed += 1
            if failed <= 5:
                print(f"  failed: {info}", file=sys.stderr)
        if (ok + failed) % 5000 == 0:
            rate = (ok + failed) / (time.time() - t0)
            print(f"  {ok + failed:,} processed ({rate:.0f} docs/s)", flush=True)
    print(f"done: {ok:,} indexed, {failed:,} failed in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
