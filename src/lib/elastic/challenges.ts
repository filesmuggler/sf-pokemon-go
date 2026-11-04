import type { MappingTypeMapping, QueryDslQueryContainer } from "@elastic/elasticsearch/lib/api/types";
import { getElasticClient } from "./client";
import { CASE_SETTINGS } from "./index";
import { getEnv } from "@/lib/env";
import type { ChallengeStore, NearQuery } from "@/lib/challenge/store";
import type { Challenge, Observation } from "@/lib/challenge/schema";

/**
 * Separate indices for the closed loop so agent-created challenges and
 * player observations never mix with the mirrored 311 data.
 */

const geo = { type: "geo_point" } as const;
const kw = { type: "keyword" } as const;
const date = { type: "date" } as const;
const txt = { type: "text" } as const;

export const CHALLENGE_MAPPINGS: MappingTypeMapping = {
  dynamic: "false",
  properties: {
    id: kw,
    batch_id: kw,
    neighborhood: kw,
    created_at: date,
    expires_at: date,
    status: kw,
    type: kw,
    answer_type: kw,
    title: txt,
    instructions: txt,
    hypothesis: txt,
    choices: kw,
    xp: { type: "integer" },
    radius_m: { type: "integer" },
    required_observations: { type: "integer" },
    observation_count: { type: "integer" },
    model: kw,
    // location is {lat, lon, label} — index the point under a dedicated field.
    location: { properties: { lat: { type: "float" }, lon: { type: "float" }, label: kw } },
    geo,
    trigger: {
      properties: {
        summary: txt,
        category: kw,
        case_ids: kw,
        report_count: { type: "integer" },
        prior_observation_ids: kw,
      },
    },
    osm: { properties: { feature: kw, mapped_nearby: { type: "integer" }, coverage_known: { type: "boolean" } } },
    resolution: {
      properties: { outcome: kw, summary: txt, derived_tags: kw, resolved_at: date },
    },
  },
};

export const OBSERVATION_MAPPINGS: MappingTypeMapping = {
  dynamic: "false",
  properties: {
    id: kw,
    challenge_id: kw,
    batch_id: kw,
    submitted_at: date,
    challenge_type: kw,
    osm_feature: kw,
    category: kw,
    case_ids: kw,
    answer: { properties: { yes_no: { type: "boolean" }, count: { type: "integer" }, choice: kw } },
    note: txt,
    photo_url: { type: "keyword", index: false },
    player: kw,
    location: geo,
    distance_from_target_m: { type: "integer" },
    derived_tags: kw,
    source: kw,
  },
};

type ChallengeDoc = Challenge & { geo: { lat: number; lon: number } };

function indices() {
  const env = getEnv();
  return { challenges: env.ELASTICSEARCH_CHALLENGES_INDEX, observations: env.ELASTICSEARCH_OBSERVATIONS_INDEX };
}

export async function ensureChallengeIndices(opts: { recreate?: boolean } = {}): Promise<void> {
  const es = getElasticClient();
  const { challenges, observations } = indices();
  for (const [index, mappings] of [
    [challenges, CHALLENGE_MAPPINGS],
    [observations, OBSERVATION_MAPPINGS],
  ] as const) {
    const exists = await es.indices.exists({ index });
    if (exists && opts.recreate) await es.indices.delete({ index });
    if (!exists || opts.recreate) await es.indices.create({ index, settings: CASE_SETTINGS, mappings });
  }
}

function nearFilters(q: NearQuery, field: string, dateField: string): QueryDslQueryContainer[] {
  const filters: QueryDslQueryContainer[] = [
    { geo_distance: { distance: `${Math.round(q.radiusM)}m`, [field]: { lat: q.lat, lon: q.lon } } },
  ];
  if (q.days) filters.push({ range: { [dateField]: { gte: `now-${q.days}d/d` } } });
  return filters;
}

function toDoc(c: Challenge): ChallengeDoc {
  return { ...c, geo: { lat: c.location.lat, lon: c.location.lon } };
}

function fromDoc(d: ChallengeDoc): Challenge {
  const { geo: _geo, ...rest } = d;
  void _geo;
  return rest;
}

export const elasticChallengeStore: ChallengeStore = {
  async saveChallenges(challenges) {
    if (challenges.length === 0) return;
    const es = getElasticClient();
    const { challenges: index } = indices();
    await es.helpers.bulk<ChallengeDoc>({
      datasource: challenges.map(toDoc),
      onDocument: (doc) => ({ index: { _index: index, _id: doc.id } }),
      refreshOnCompletion: true,
    });
  },

  async getChallenge(id) {
    const es = getElasticClient();
    const res = await es.get<ChallengeDoc>({ index: indices().challenges, id }, { ignore: [404] });
    return res.found && res._source ? fromDoc(res._source) : null;
  },

  async updateChallenge(challenge) {
    const es = getElasticClient();
    await es.index({ index: indices().challenges, id: challenge.id, document: toDoc(challenge), refresh: "wait_for" });
  },

  async listChallenges(q) {
    const es = getElasticClient();
    const filter = nearFilters(q, "geo", "created_at");
    if (q.status) filter.push({ term: { status: q.status } });
    const res = await es.search<ChallengeDoc>({
      index: indices().challenges,
      size: q.size ?? 50,
      query: { bool: { filter } },
      sort: [{ created_at: "desc" }],
    });
    return res.hits.hits.filter((h) => h._source).map((h) => fromDoc(h._source as ChallengeDoc));
  },

  async saveObservation(observation) {
    const es = getElasticClient();
    await es.index({ index: indices().observations, id: observation.id, document: observation, refresh: "wait_for" });
  },

  async listObservations(q) {
    const es = getElasticClient();
    const filter = q.challenge_id ? [{ term: { challenge_id: q.challenge_id } }] : nearFilters(q, "location", "submitted_at");
    const res = await es.search<Observation>({
      index: indices().observations,
      size: q.size ?? 100,
      query: { bool: { filter } },
      sort: [{ submitted_at: "desc" }],
    });
    return res.hits.hits.filter((h) => h._source).map((h) => h._source as Observation);
  },
};
