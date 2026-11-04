"""FastAPI app. Run: uv run uvicorn backend.app:app --reload"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend import agent, engine

app = FastAPI(title="SF Pokemon Go")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
engine.ensure_indices()


class Observation(BaseModel):
    report_id: str
    verdict: str  # present | fixed | not_found
    user_id: str
    lat: float
    lon: float
    quest_type: str = "verify"
    note: str = ""
    photo_url: str | None = None


class ChatIn(BaseModel):
    message: str
    lat: float
    lon: float
    user_id: str = "demo"
    history: list[dict] = []  # [{"role": "user"|"assistant", "content": "..."}]


@app.get("/health")
def health():
    return {"ok": True, "reports": engine.es.count(index=engine.REPORTS)["count"]}


@app.get("/quests")
def quests(lat: float, lon: float, radius_km: float = 1.0):
    return engine.find_quests(lat, lon, radius_km)


@app.get("/search")
def search(q: str, lat: float | None = None, lon: float | None = None, radius_km: float = 1.0,
           status: str | None = None, days: int | None = None):
    return engine.search_reports(q, lat, lon, radius_km, status, days, size=10)


@app.get("/reports/{report_id}")
def report(report_id: str):
    r = engine.report_status(report_id)
    if not r:
        raise HTTPException(404, "report not found")
    return r


@app.post("/observations")
def observe(o: Observation):
    res = engine.submit_observation(**o.model_dump())
    if not res["ok"]:
        raise HTTPException(400, res["error"])
    return res


@app.get("/neighborhoods/{name}")
def neighborhood(name: str, days: int = 30):
    return engine.neighborhood_stats(name, days)


@app.post("/chat")
def chat(c: ChatIn):
    return {"reply": agent.chat(c.message, c.lat, c.lon, c.user_id, c.history)}
