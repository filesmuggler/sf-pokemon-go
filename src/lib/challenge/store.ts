import { getEnv } from "@/lib/env";
import type { Challenge, ChallengeStatus, Observation } from "./schema";

export interface NearQuery {
  lat: number;
  lon: number;
  radiusM: number;
  /** Only challenges/observations newer than N days. */
  days?: number;
  size?: number;
}

/**
 * Persistence for the closed loop. Elasticsearch in normal operation
 * (two indices, separate from the 311 mirror); an in-memory store when
 * QUEST_MOCK=1 so the UI loop can be exercised without any backend.
 */
export interface ChallengeStore {
  saveChallenges(challenges: Challenge[]): Promise<void>;
  getChallenge(id: string): Promise<Challenge | null>;
  updateChallenge(challenge: Challenge): Promise<void>;
  listChallenges(q: NearQuery & { status?: ChallengeStatus }): Promise<Challenge[]>;
  saveObservation(observation: Observation): Promise<void>;
  listObservations(q: NearQuery & { challenge_id?: string }): Promise<Observation[]>;
}

export async function getChallengeStore(): Promise<ChallengeStore> {
  if (getEnv().QUEST_MOCK) {
    const { memoryStore } = await import("./memory-store");
    return memoryStore;
  }
  const { elasticChallengeStore } = await import("@/lib/elastic/challenges");
  return elasticChallengeStore;
}
