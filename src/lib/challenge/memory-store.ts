import { haversineM } from "@/lib/osm/overpass";
import type { Challenge, Observation } from "./schema";
import type { ChallengeStore } from "./store";

/**
 * In-memory store for QUEST_MOCK=1. Survives across requests within one
 * server process (module scope), which is enough to demo the full loop
 * without Elasticsearch.
 */
const challenges = new Map<string, Challenge>();
const observations = new Map<string, Observation>();

export const memoryStore: ChallengeStore = {
  async saveChallenges(list) {
    for (const c of list) challenges.set(c.id, c);
  },
  async getChallenge(id) {
    return challenges.get(id) ?? null;
  },
  async updateChallenge(c) {
    challenges.set(c.id, c);
  },
  async listChallenges(q) {
    const since = q.days ? Date.now() - q.days * 86_400_000 : 0;
    return [...challenges.values()]
      .filter((c) => haversineM(c.location, q) <= q.radiusM)
      .filter((c) => !q.status || c.status === q.status)
      .filter((c) => new Date(c.created_at).getTime() >= since)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, q.size ?? 50);
  },
  async saveObservation(o) {
    observations.set(o.id, o);
  },
  async listObservations(q) {
    const since = q.days ? Date.now() - q.days * 86_400_000 : 0;
    return [...observations.values()]
      .filter((o) => (q.challenge_id ? o.challenge_id === q.challenge_id : haversineM(o.location, q) <= q.radiusM))
      .filter((o) => new Date(o.submitted_at).getTime() >= since)
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
      .slice(0, q.size ?? 100);
  },
};
