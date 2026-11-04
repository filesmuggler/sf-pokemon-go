"""Core logic: search 311 reports, build quests, store observations."""

import math
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from elasticsearch import Elasticsearch

load_dotenv()
es = Elasticsearch(os.environ["ELASTIC_URL"], api_key=os.environ["ELASTIC_API_KEY"])

REPORTS = "sf_311"
OBSERVATIONS = "sf_observations"

# Only fixed-in-place, safe-to-check problems become quests.
QUEST_CATEGORIES = [
    "Street and Sidewalk Cleaning", "Graffiti Public", "Graffiti Private", "Tree Maintenance",
    "Litter Receptacle Maintenance", "Sewer", "Sidewalk and Curb", "Street Defect",
    "Damage Property", "Streetlights", "Illegal Postings", "Blocked Street and Sidewalk",
    "MTA Parking Traffic Signs Normal Priority", "MTA Parking Traffic Signs High Priority",
]

QUEST_TYPES = {
    "verify": {"points": 10, "title": "Is it real?", "ask": "Go and confirm this problem exists."},
    "still_there": {"points": 15, "title": "Still there?", "ask": "This was reported a while ago. Is it still there?"},
    "was_fixed": {"points": 20, "title": "Was it fixed?", "ask": "The city marked this resolved. Is it really fixed?"},
}
VERDICTS = ["present", "fixed", "not_found"]
MAX_DISTANCE_M = 150  # how close a user must be to submit an observation

FIELDS = ["service_request_id", "service_name", "service_subtype", "address", "analysis_neighborhood",
          "status_description", "status_notes", "requested_datetime", "closed_date", "location",
          "media_url", "search_text"]


def ensure_indices():
    if not es.indices.exists(index=OBSERVATIONS):
        es.indices.create(index=OBSERVATIONS, mappings={"properties": {
            "report_id": {"type": "keyword"}, "quest_type": {"type": "keyword"},
            "verdict": {"type": "keyword"}, "note": {"type": "text"}, "user_id": {"type": "keyword"},
            "location": {"type": "geo_point"}, "photo_url": {"type": "keyword"},
            "created_at": {"type": "date"},
        }})


def _geo(lat, lon, radius_km):
    return {"geo_distance": {"distance": f"{radius_km}km", "location": {"lat": lat, "lon": lon}}}


def _hits(resp):
    return [h["_source"] for h in resp["hits"]["hits"]]


def search_reports(query: str, lat=None, lon=None, radius_km=1.0, status=None, days=None, size=5):
    """Hybrid-ish search: ELSER semantic match on the case summary, optional geo/status/date filters."""
    filters = []
    if lat is not None and lon is not None:
        filters.append(_geo(lat, lon, radius_km))
    if status:
        filters.append({"term": {"status_description": status}})
    if days:
        filters.append({"range": {"requested_datetime": {"gte": f"now-{days}d"}}})
    resp = es.search(index=REPORTS, size=size, source=FIELDS, query={"bool": {
        "must": {"match": {"search_semantic": query}}, "filter": filters}})
    return _hits(resp)


def get_report(report_id: str):
    resp = es.options(ignore_status=404).get(index=REPORTS, id=report_id, source_includes=FIELDS)
    return resp["_source"] if resp.get("found") else None


def _recently_checked_ids(hours=24):
    if not es.indices.exists(index=OBSERVATIONS):
        return []
    resp = es.search(index=OBSERVATIONS, size=0, query={"range": {"created_at": {"gte": f"now-{hours}h"}}},
                     aggs={"ids": {"terms": {"field": "report_id", "size": 1000}}})
    return [b["key"] for b in resp["aggregations"]["ids"]["buckets"]]


def find_quests(lat: float, lon: float, radius_km=1.0, per_type=3):
    """Rule-based quests near a point, closest first."""
    rules = {
        "verify": [{"term": {"status_description": "Open"}},
                   {"range": {"requested_datetime": {"gte": "now-2d"}}}],
        "still_there": [{"term": {"status_description": "Open"}},
                        {"range": {"requested_datetime": {"lte": "now-7d"}}}],
        "was_fixed": [{"term": {"status_description": "Closed"}},
                      {"range": {"closed_date": {"gte": "now-3d"}}},
                      {"match": {"status_notes": "resolved"}}],
    }
    skip = _recently_checked_ids()
    quests = []
    for qtype, rule in rules.items():
        resp = es.search(index=REPORTS, size=per_type, source=FIELDS, query={"bool": {
            "filter": rule + [_geo(lat, lon, radius_km), {"terms": {"service_name": QUEST_CATEGORIES}}],
            "must_not": [{"ids": {"values": skip}}],
        }}, sort=[{"_geo_distance": {"location": {"lat": lat, "lon": lon}, "order": "asc", "unit": "m"}}])
        for h in resp["hits"]["hits"]:
            quests.append({"quest_type": qtype, **QUEST_TYPES[qtype],
                           "distance_m": round(h["sort"][0]), "report": h["_source"]})
    return sorted(quests, key=lambda q: q["distance_m"])


def _distance_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 6371000 * 2 * math.asin(math.sqrt(a))


def submit_observation(report_id: str, verdict: str, user_id: str, lat: float, lon: float,
                       quest_type="verify", note="", photo_url=None):
    if verdict not in VERDICTS:
        return {"ok": False, "error": f"verdict must be one of {VERDICTS}"}
    report = get_report(report_id)
    if not report:
        return {"ok": False, "error": "report not found"}
    if report.get("location"):
        d = _distance_m(lat, lon, report["location"]["lat"], report["location"]["lon"])
        if d > MAX_DISTANCE_M:
            return {"ok": False, "error": f"you are {d:.0f} m away, get within {MAX_DISTANCE_M} m"}
    doc = {"report_id": report_id, "quest_type": quest_type, "verdict": verdict, "note": note,
           "user_id": user_id, "location": {"lat": lat, "lon": lon}, "photo_url": photo_url,
           "created_at": datetime.now(timezone.utc).isoformat()}
    es.index(index=OBSERVATIONS, document=doc, refresh=True)
    return {"ok": True, "points": QUEST_TYPES.get(quest_type, {}).get("points", 0), "observation": doc}


def report_status(report_id: str):
    """City status + what the community has seen."""
    report = get_report(report_id)
    if not report:
        return None
    resp = es.search(index=OBSERVATIONS, size=10, sort=[{"created_at": "desc"}],
                     query={"term": {"report_id": report_id}},
                     aggs={"verdicts": {"terms": {"field": "verdict"}}})
    return {"report": report,
            "community": {b["key"]: b["doc_count"] for b in resp["aggregations"]["verdicts"]["buckets"]},
            "observations": _hits(resp)}


def neighborhood_stats(neighborhood: str, days=30):
    resp = es.search(index=REPORTS, size=0, query={"bool": {"filter": [
        {"term": {"analysis_neighborhood": neighborhood}},
        {"range": {"requested_datetime": {"gte": f"now-{days}d"}}}]}},
        aggs={"open": {"filter": {"term": {"status_description": "Open"}}},
              "top": {"terms": {"field": "service_name", "size": 5}}})
    return {"neighborhood": neighborhood, "days": days, "total": resp["hits"]["total"]["value"],
            "open": resp["aggregations"]["open"]["doc_count"],
            "top_issues": {b["key"]: b["doc_count"] for b in resp["aggregations"]["top"]["buckets"]}}
