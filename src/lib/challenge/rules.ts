import type { QueryDslQueryContainer } from "@elastic/elasticsearch/lib/api/types";
import { getElasticClient, getIndexName } from "@/lib/elastic/client";
import type { SF311Case } from "@/lib/sf311/types";
import type { ChallengeBatch, ChallengeDraft, ChallengeRequest } from "./schema";
import { getChallengeStore } from "./store";

/**
 * Instant, LLM-free challenges straight from 311 case data. Each one asks a
 * player to look at one real case and answer yes/no "is the problem there?",
 * which feeds the existing `confirm_issue` resolution (issue_persists / issue_resolved).
 */

/** Only physical, fixed-in-place problems become challenges: never people, noise or parked cars. */
export const QUEST_CATEGORIES = [
  "Street and Sidewalk Cleaning",
  "Graffiti Public",
  "Graffiti Private",
  "Tree Maintenance",
  "Litter Receptacle Maintenance",
  "Sewer",
  "Sidewalk and Curb",
  "Street Defect",
  "Damage Property",
  "Streetlights",
  "Illegal Postings",
  "Blocked Street and Sidewalk",
  "MTA Parking Traffic Signs Normal Priority",
  "MTA Parking Traffic Signs High Priority",
];

const RULES: {
  kind: "verify" | "still_there" | "was_fixed";
  filter: QueryDslQueryContainer[];
  xp: number;
  expires_in_days: number;
  title: string;
  ask: string;
}[] = [
  {
    kind: "verify",
    filter: [{ term: { status: "open" } }, { range: { requested_at: { gte: "now-2d" } } }],
    xp: 10,
    expires_in_days: 2,
    title: "Is it real?",
    ask: "Someone just reported this. Go and check: is the problem really there?",
  },
  {
    kind: "still_there",
    filter: [{ term: { status: "open" } }, { range: { requested_at: { lte: "now-7d" } } }],
    xp: 15,
    expires_in_days: 7,
    title: "Still there?",
    ask: "This was reported over a week ago and is still open. Is the problem still there?",
  },
  {
    kind: "was_fixed",
    filter: [
      { term: { status: "closed" } },
      { range: { closed_at: { gte: "now-3d" } } },
      { match: { status_notes: "resolved" } },
    ],
    xp: 20,
    expires_in_days: 3,
    title: "Really fixed?",
    ask: "The city marked this resolved. Is the problem still there anyway?",
  },
];

function label(c: SF311Case): string {
  return (c.address ?? c.street ?? "this spot").replace(/, SAN FRANCISCO.*$/i, "");
}

function toDraft(c: SF311Case, rule: (typeof RULES)[number]): ChallengeDraft {
  const what = [c.category, c.subtype?.replace(/_/g, " ")].filter(Boolean).join(": ");
  return {
    title: `${rule.title} ${c.category} at ${label(c)}`,
    instructions: `${rule.ask} Reported: ${what}. Answer yes if you can see the problem, no if it's gone.`,
    type: "confirm_issue",
    answer_type: "yes_no",
    choices: [],
    location: { lat: c.location!.lat, lon: c.location!.lon, label: label(c) },
    radius_m: 50,
    trigger: {
      summary: `311 case ${c.id} (${what}), ${c.status}, reported ${c.requested_at.slice(0, 10)}.`,
      category: c.category,
      case_ids: [c.id],
      report_count: 1,
      prior_observation_ids: [],
    },
    osm: { feature: null, mapped_nearby: 0, coverage_known: false },
    hypothesis: "Yes → the issue persists on the ground. No → it is resolved.",
    xp: rule.xp,
    expires_in_days: rule.expires_in_days,
  };
}

export async function buildRuleChallenges(req: ChallengeRequest, perRule = 2): Promise<ChallengeBatch> {
  const es = getElasticClient();
  const center = { lat: req.lat, lon: req.lon };

  // Don't hand out a case that had a challenge (open or just completed) in the last week.
  const store = await getChallengeStore();
  const recent = await store.listChallenges({ ...center, radiusM: req.radius_m, days: 7, size: 500 });
  const taken = recent.flatMap((c) => c.trigger.case_ids);

  const byRule: ChallengeDraft[][] = [];
  let neighborhood = req.neighborhood_hint;
  for (const rule of RULES) {
    const res = await es.search<SF311Case>({
      index: getIndexName(),
      size: perRule,
      query: {
        bool: {
          filter: [
            ...rule.filter,
            { terms: { category: QUEST_CATEGORIES } },
            { geo_distance: { distance: `${req.radius_m}m`, location: center } },
          ],
          must_not: [{ ids: { values: taken } }],
        },
      },
      sort: [{ _geo_distance: { location: center, order: "asc", unit: "m" } }],
    });
    const drafts: ChallengeDraft[] = [];
    for (const hit of res.hits.hits) {
      const c = hit._source;
      if (!c?.location) continue;
      neighborhood ??= c.neighborhood;
      drafts.push(toDraft(c, rule));
    }
    byRule.push(drafts);
  }
  // Interleave so a batch mixes quest kinds (max 4 per batch).
  const drafts = Array.from({ length: perRule }, (_, i) => byRule.map((d) => d[i])).flat().filter(Boolean).slice(0, 4);

  return {
    neighborhood: neighborhood ?? "San Francisco",
    briefing: drafts.length
      ? `${drafts.length} real 311 cases near you need eyes on the ground: new reports to confirm, old ones to re-check, and fixes to verify.`
      : "No checkable 311 cases nearby right now. Try a bigger radius.",
    challenges: drafts,
  };
}
