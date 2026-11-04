import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { FIXTURE_BATCH, FIXTURE_TRACE, materializeFixture } from "./fixture";
import { buildObservation, isExpired, resolveChallenge, validateAnswer } from "./resolve";
import {
  type Challenge,
  type ChallengeBatch,
  type ChallengeBatchResponse,
  type ChallengeRequest,
  type Observation,
  type ObservationInput,
  type ObservationResponse,
} from "./schema";
import { getChallengeStore, type NearQuery } from "./store";

export class ChallengeError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function shortId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Turn the agent's drafts into stored challenges. */
export function materializeBatch(batch: ChallengeBatch, batchId: string, model: string, now = new Date()): Challenge[] {
  return batch.challenges.map((draft, i) => ({
    ...draft,
    id: `${batchId}-c${i + 1}`,
    batch_id: batchId,
    neighborhood: batch.neighborhood,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + draft.expires_in_days * 86_400_000).toISOString(),
    status: "open" as const,
    required_observations: 1,
    observation_count: 0,
    resolution: null,
    model,
  }));
}

/**
 * Step 1 of the loop: agent reads trends (311 + OSM + prior observations)
 * and creates challenges. Persists them and returns the batch.
 */
export async function createChallengeBatch(req: ChallengeRequest): Promise<ChallengeBatchResponse> {
  const store = await getChallengeStore();
  const batchId = shortId("b");

  if (getEnv().QUEST_MOCK) {
    const challenges = materializeFixture(batchId);
    await store.saveChallenges(challenges);
    return { batch_id: batchId, neighborhood: FIXTURE_BATCH.neighborhood, briefing: FIXTURE_BATCH.briefing, challenges, trace: FIXTURE_TRACE, model: "fixture", mock: true };
  }

  const { runChallengeAgent } = await import("@/lib/mistral/challenge-agent");
  const { batch, trace, model } = await runChallengeAgent(req);
  const challenges = materializeBatch(batch, batchId, model);
  await store.saveChallenges(challenges);
  return { batch_id: batchId, neighborhood: batch.neighborhood, briefing: batch.briefing, challenges, trace, model };
}

export async function listNearbyChallenges(q: NearQuery & { status?: Challenge["status"] }): Promise<Challenge[]> {
  const store = await getChallengeStore();
  const list = await store.listChallenges(q);
  // Lazily expire. Keep it cheap: only flip status in the response + persist best-effort.
  const now = new Date();
  const expired = list.filter((c) => c.status === "open" && isExpired(c, now));
  await Promise.all(expired.map((c) => store.updateChallenge({ ...c, status: "expired" })));
  return list.map((c) => (expired.includes(c) ? { ...c, status: "expired" as const } : c)).filter((c) => !q.status || c.status === q.status);
}

export async function getChallengeWithObservations(id: string): Promise<{ challenge: Challenge; observations: Observation[] } | null> {
  const store = await getChallengeStore();
  const challenge = await store.getChallenge(id);
  if (!challenge) return null;
  const observations = await store.listObservations({ challenge_id: id, lat: 0, lon: 0, radiusM: 0 });
  return { challenge, observations };
}

/**
 * Steps 2–3 of the loop: player feedback comes in, we store it as an
 * Observation with OSM-style tags, re-resolve the challenge, and mark it
 * completed once it has enough observations.
 */
export async function submitObservation(challengeId: string, input: ObservationInput): Promise<ObservationResponse> {
  const store = await getChallengeStore();
  const challenge = await store.getChallenge(challengeId);
  if (!challenge) throw new ChallengeError("Challenge not found", 404);
  if (challenge.status === "expired" || isExpired(challenge)) throw new ChallengeError("Challenge has expired", 410);

  const problem = validateAnswer(challenge, input.answer);
  if (problem) throw new ChallengeError(problem, 400);

  const observation = buildObservation(challenge, input, shortId("o"));
  await store.saveObservation(observation);

  const all = await store.listObservations({ challenge_id: challenge.id, lat: 0, lon: 0, radiusM: 0 });
  const observations = all.some((o) => o.id === observation.id) ? all : [observation, ...all];
  const resolution = resolveChallenge(challenge, observations);
  const completed = observations.length >= challenge.required_observations && resolution.outcome !== "inconclusive";

  const updated: Challenge = {
    ...challenge,
    observation_count: observations.length,
    resolution,
    status: completed ? "completed" : "open",
  };
  await store.updateChallenge(updated);

  return { observation, challenge: updated, closed_loop: completed && challenge.status !== "completed", mock: getEnv().QUEST_MOCK || undefined };
}

export async function listNearbyObservations(q: NearQuery): Promise<Observation[]> {
  const store = await getChallengeStore();
  return store.listObservations(q);
}

/**
 * What the agent reads before creating new challenges — the "closed" side of
 * the loop. Compact on purpose: it goes into the model context.
 */
export async function priorKnowledge(q: NearQuery): Promise<{
  resolved_challenges: {
    id: string;
    type: Challenge["type"];
    title: string;
    location: Challenge["location"];
    osm_feature: Challenge["osm"]["feature"];
    category: string | null;
    case_ids: string[];
    outcome: NonNullable<Challenge["resolution"]>["outcome"];
    summary: string;
    derived_tags: string[];
    resolved_at: string;
  }[];
  open_challenges: { id: string; type: Challenge["type"]; title: string; location: Challenge["location"]; created_at: string }[];
  recent_observations: {
    id: string;
    challenge_id: string;
    submitted_at: string;
    answer: Observation["answer"];
    note: string | null;
    derived_tags: string[];
    lat: number;
    lon: number;
  }[];
}> {
  const store = await getChallengeStore();
  const [challenges, observations] = await Promise.all([
    store.listChallenges({ ...q, size: q.size ?? 40 }),
    store.listObservations({ ...q, size: q.size ?? 40 }),
  ]);
  return {
    resolved_challenges: challenges
      .filter((c): c is Challenge & { resolution: NonNullable<Challenge["resolution"]> } => c.status === "completed" && c.resolution !== null)
      .map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        location: c.location,
        osm_feature: c.osm.feature,
        category: c.trigger.category,
        case_ids: c.trigger.case_ids,
        outcome: c.resolution.outcome,
        summary: c.resolution.summary,
        derived_tags: c.resolution.derived_tags,
        resolved_at: c.resolution.resolved_at,
      })),
    open_challenges: challenges
      .filter((c) => c.status === "open")
      .map((c) => ({ id: c.id, type: c.type, title: c.title, location: c.location, created_at: c.created_at })),
    recent_observations: observations.map((o) => ({
      id: o.id,
      challenge_id: o.challenge_id,
      submitted_at: o.submitted_at,
      answer: o.answer,
      note: o.note,
      derived_tags: o.derived_tags,
      lat: o.location.lat,
      lon: o.location.lon,
    })),
  };
}
