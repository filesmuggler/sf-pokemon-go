"""LangChain agent on Mistral with tools over the engine."""

import json
import os

from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_mistralai import ChatMistralAI

from backend import engine

SYSTEM = """You are the guide of a city game in San Francisco. Players walk around and check
real 311 reports filed by citizens: confirm a problem is real, check if it is still there,
or check if the city really fixed it. You help them find quests, match what they describe to
existing reports, and record what they saw.

Rules:
- When a player describes a problem, search existing reports near them first. If one matches,
  offer it as a quest instead of treating it as new.
- To record an observation you need the report_id and a verdict: present, fixed or not_found.
- Never send players to check on people (encampments, drug activity) - only physical problems.
- Keep answers short and friendly. Mention addresses and distances when you have them."""


def _short(reports):
    return [{k: r.get(k) for k in ["service_request_id", "search_text", "requested_datetime", "location"]}
            for r in reports]


def build_agent(lat: float, lon: float, user_id: str):
    """Tools are bound to the player's position and id so the LLM can't fake them."""

    @tool
    def search_reports(query: str, radius_km: float = 1.0, only_open: bool = False, days: int = 0) -> str:
        """Semantic search of 311 reports near the player. query: what the problem looks like.
        days: only reports from the last N days (0 = all)."""
        hits = engine.search_reports(query, lat, lon, radius_km, "Open" if only_open else None, days or None)
        return json.dumps(_short(hits))

    @tool
    def find_quests(radius_km: float = 1.0) -> str:
        """List quests near the player, closest first."""
        qs = engine.find_quests(lat, lon, radius_km)[:8]
        return json.dumps([{"quest_type": q["quest_type"], "title": q["title"], "points": q["points"],
                            "distance_m": q["distance_m"], "report_id": q["report"]["service_request_id"],
                            "what": q["report"]["search_text"]} for q in qs])

    @tool
    def submit_observation(report_id: str, verdict: str, quest_type: str = "verify", note: str = "") -> str:
        """Record what the player saw. verdict: present | fixed | not_found.
        quest_type: verify | still_there | was_fixed."""
        return json.dumps(engine.submit_observation(report_id, verdict, user_id, lat, lon, quest_type, note))

    @tool
    def report_status(report_id: str) -> str:
        """City status of a report plus what other players reported."""
        return json.dumps(engine.report_status(report_id), default=str)

    @tool
    def neighborhood_stats(neighborhood: str, days: int = 30) -> str:
        """Report counts and top issues for a neighborhood (e.g. 'Mission', 'Tenderloin')."""
        return json.dumps(engine.neighborhood_stats(neighborhood, days))

    llm = ChatMistralAI(model=os.getenv("MISTRAL_MODEL", "mistral-large-latest"), temperature=0)
    return create_agent(llm, tools=[search_reports, find_quests, submit_observation, report_status,
                                    neighborhood_stats],
                        system_prompt=SYSTEM + f"\nPlayer position: lat={lat}, lon={lon}.")


def chat(message: str, lat: float, lon: float, user_id: str, history=None) -> str:
    agent = build_agent(lat, lon, user_id)
    messages = (history or []) + [{"role": "user", "content": message}]
    result = agent.invoke({"messages": messages})
    return result["messages"][-1].content
