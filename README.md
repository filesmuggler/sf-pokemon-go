# sf-pokemon-go
SF Pokemon Go: quests for verifying San Francisco 311 reports ("is it real?", "is it still there?", "was it fixed?").

## Data: SF 311 cases → Elasticsearch

Source: DataSF dataset [311 Cases `vw6y-z8j6`](https://data.sf.gov/resource/vw6y-z8j6.json) via the SODA API (read-only, refreshed nightly).

Setup: create `.env` with

```
ELASTIC_URL=https://<your-cluster>.elastic.cloud:443
ELASTIC_API_KEY=<key>
```

Load / refresh:

```bash
uv run scripts/ingest_311.py                        # last 90 days (by requested date)
uv run scripts/ingest_311.py --by updated --days 2  # nightly refresh: cases whose status changed
uv run scripts/ingest_311.py --days 7 --limit 500   # quick test
```

Index `sf_311` (one doc per case, `_id` = `service_request_id`, so re-runs update in place):

- keyword facets: `service_name`, `service_subtype`, `status_description`, `analysis_neighborhood`, `supervisor_district`, `agency_responsible`, `source`
- dates (SF time zone): `requested_datetime`, `updated_datetime`, `closed_date`
- `location` (`geo_point`), `media_url` (citizen photo)
- `search_text`: readable summary (BM25), copied into `search_semantic` (`semantic_text`, ELSER sparse vectors)

Example semantic + geo query:

```json
GET sf_311/_search
{
  "query": { "bool": {
    "must":   { "match": { "search_semantic": "smelly water flooding the street" } },
    "filter": [
      { "term": { "status_description": "Open" } },
      { "geo_distance": { "distance": "1km", "location": { "lat": 37.7599, "lon": -122.4148 } } }
    ]
  } }
}
```

## Backend (FastAPI + LangChain agent on Mistral)

Add `MISTRAL_API_KEY=...` to `.env` (optional `MISTRAL_MODEL`, default `mistral-large-latest`), then:

```bash
uv run uvicorn backend.app:app --reload --port 8311
```

- `backend/engine.py`: Elasticsearch logic (search, quests, observations, stats)
- `backend/agent.py`: LangChain `create_agent` with Mistral and tools over the engine
- `backend/app.py`: HTTP API

| Endpoint | What |
|---|---|
| `GET /quests?lat&lon&radius_km` | Quests nearby: `verify` (open, <2 days), `still_there` (open, >7 days), `was_fixed` (closed as resolved, <3 days) |
| `GET /search?q&lat&lon&radius_km&status&days` | Semantic (ELSER) search of reports |
| `GET /reports/{id}` | City status plus community verdicts |
| `POST /observations` | `{report_id, verdict: present/fixed/not_found, user_id, lat, lon, quest_type, note}`; user must be within 150 m |
| `GET /neighborhoods/{name}` | Counts and top issues |
| `POST /chat` | `{message, lat, lon, user_id, history}` → agent reply |

Interactive docs: http://localhost:8311/docs
