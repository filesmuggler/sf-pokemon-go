# SF Pokémon GO — SF Side Quest: Fix the City

Gamified SF 311. Pick a spot in the city; a **Mistral** agent investigates real 311 reports indexed in **Elasticsearch**, filters duplicates, checks which cases are still open, and builds a short walkable quest:

> "Find three recurring public-space problems within a 15-minute walk and propose the most useful intervention."

Built with Next.js 16 (App Router, TypeScript, Tailwind v4).

## Architecture

```
Browser ──POST /api/quest──▶ Next.js route handler
                                  │
                                  ▼
                         runQuestAgent()  (src/lib/mistral/agent.ts)
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
   Phase 1: investigate                      Phase 2: compose
   Mistral tool-calling loop                 Mistral structured output
   tools → Elasticsearch queries             (json_schema from zod QuestSchema)
     • aggregate_issue_categories
     • search_issues (deduped)
     • find_duplicate_reports (more_like_this + geo)
     • check_case_status (mget)
```

| Layer | Path |
| --- | --- |
| Env validation | `src/lib/env.ts` |
| Elasticsearch client, mapping, bulk | `src/lib/elastic/client.ts`, `src/lib/elastic/index.ts` |
| Geo/text/aggregation queries + dedupe | `src/lib/elastic/queries.ts` |
| SF 311 types, normalizer, SODA fetcher | `src/lib/sf311/` |
| Mistral client, tool defs, prompts, shared tool loop (`loop.ts`), quest + challenge + dev agents | `src/lib/mistral/` |
| Quest schema (zod) + fixture | `src/lib/quest/` |
| Closed-loop map challenges (schema, resolve, store, service) — WIP, no routes/UI yet | `src/lib/challenge/`, `src/lib/osm/`, `src/lib/elastic/challenges.ts` |
| Dev agent (chat with the data) | `src/lib/elastic/dev-client.ts`, `src/lib/mistral/dev-*.ts`, `src/app/api/dev/chat`, `src/components/dev/` |
| API routes | `src/app/api/{quest,issues,health}/route.ts` |
| UI | `src/app/page.tsx`, `src/components/` |
| Index setup & seeding scripts | `scripts/` |

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in MISTRAL_API_KEY

# 1. Elasticsearch (local, no auth)
npm run es:up                     # docker compose, port 9200
npm run es:setup                  # create index with geo_point mapping

# 2. Data — pick one
npm run es:seed:sample            # 40 synthetic Mission cases, offline
npm run es:seed -- --days 90 --limit 20000                       # real data, citywide
npm run es:seed -- --lat 37.7599 --lon -122.4148 --radius 1500   # real data, one area

# 3. Run
npm run dev                       # http://localhost:3000
```

Check wiring at [http://localhost:3000/api/health](http://localhost:3000/api/health).

### No keys yet?

Set `QUEST_MOCK=1` in `.env.local` and `/api/quest` returns a fixture quest so you can work on the UI.

### Elastic Cloud instead of Docker

Set `ELASTICSEARCH_URL` to your deployment endpoint and `ELASTICSEARCH_API_KEY` (or username/password). Everything else is the same.

## Dev agent — chat with the data (development only)

While the real 311 data is still being loaded, a second Elastic project holds exemplary data. A **dev sidebar** (🛠 button, bottom-right) lets you chat with it through a Mistral agent that constructs the queries itself. The point is to learn which queries and interfaces the production agent will need, and to see exactly what Elasticsearch returns.

```bash
# .env / .env.local
ELASTIC_DEV_ENDPOINT=https://<project>.es.<region>.gcp.elastic.cloud:443
ELASTIC_DEV_API_KEY=...
# DEV_AGENT=1 forces it on (e.g. preview build); 0 hides it. Default: on in `next dev`, off in production.
```

How it works:

- `src/lib/elastic/dev-client.ts` — separate client (serverless mode) so the main 311 index config stays untouched.
- `src/lib/mistral/dev-tools.ts` — read-only, index-agnostic tools the model drives: `list_indices`, `get_mapping`, `sample_documents`, `search` (Query DSL), `aggregate`, `esql`. System indices and writes are blocked; hits are capped at 50 and results truncated to fit the model context.
- `src/lib/mistral/dev-agent.ts` — one chat turn = tool loop + prose answer. If a query fails and the model tries to answer anyway, the loop pushes it back to fix and retry rather than invent values.
- `src/app/api/dev/chat/route.ts` — `GET` returns connection status + indices; `POST { messages }` returns `{ reply, trace, model, ms }`. Both 404 when the agent is disabled.
- `src/components/dev/DevAgentSidebar.tsx` — the drawer. Every tool call is expandable to show the query it ran and the raw result, with copy buttons. Conversation persists in `sessionStorage` across reloads.

Because the tools are index-agnostic, the same sidebar works against the real `sf311-cases` index once it exists — just point `ELASTIC_DEV_*` at it.

## API

### `POST /api/quest`

```json
{ "lat": 37.7599, "lon": -122.4148, "radius_m": 1200, "days": 90, "neighborhood_hint": "Mission" }
```

Returns `{ quest, trace, model }` — see `QuestSchema` in `src/lib/quest/schema.ts`. `trace` lists every tool call the agent made (tool, args, result summary, ms) for transparency in the UI.

### `GET /api/issues?lat=&lon=&radius_m=&q=&category=&status=`

Raw Elasticsearch lookup: nearby cases, duplicate clusters, and category aggregations. Handy for a map view or for debugging the index.

### `GET /api/health`

Env + Elasticsearch connectivity + doc count.

## Data

[SF 311 Cases](https://data.sfgov.org/City-Infrastructure/311-Cases/vw6y-z8j6) via the Socrata SODA API (`vw6y-z8j6`). The seeder pulls `requested_datetime`, `status_description`, `service_name`/`service_subtype`/`service_details`, address fields, and `lat`/`long`, normalizing them into the `SF311Case` shape in `src/lib/sf311/types.ts`. An optional `SF_OPEN_DATA_APP_TOKEN` raises rate limits.

## Extending

- **New agent tool**: add a zod schema + description + executor in `src/lib/mistral/tools.ts`. Tool definitions are generated from the zod schema with `z.toJSONSchema`.
- **Change the quest shape**: edit `QuestSchema` in `src/lib/quest/schema.ts`; the composer's `json_schema` response format and the UI types follow automatically.
- **Smarter dedupe**: `clusterDuplicates` in `src/lib/elastic/queries.ts` is a cheap in-memory grouping (category + subtype + ~55 m). Swap in a `geohash_grid` aggregation or ES `collapse` for scale.
- **Map**: `/api/issues` already returns `location` per case and cluster representatives.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run es:up` / `es:down` | Local Elasticsearch via Docker |
| `npm run es:setup [-- --recreate]` | Create the index |
| `npm run es:seed [-- --days N --limit N --lat --lon --radius]` | Load real 311 data |
| `npm run es:seed:sample` | Load bundled synthetic sample |

## Python prototype (to be ported into Next.js)

An earlier Python pass lives in `scripts/ingest_311.py` and `backend/` (FastAPI + LangChain on Mistral). It is kept for reference while its pieces are ported here; see the comparison notes in the PR.

- `scripts/ingest_311.py` already loaded the last 90 days (~227k cases) into the Elastic Serverless project as index **`sf_311`**, with raw SODA field names, SF-timezone dates, keyset pagination, and an **ELSER** `semantic_text` field (`search_semantic`, endpoint `.elser-2-elastic`) for sparse semantic search.
- `backend/engine.py` has rule-based quests (`verify` open <2d, `still_there` open >7d, `was_fixed` closed as resolved <3d), a 150 m proximity check on observations, and a safe-category allowlist.

```bash
uv run scripts/ingest_311.py --days 90
uv run uvicorn backend.app:app --port 8311
```
