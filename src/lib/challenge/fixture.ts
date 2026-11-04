import type { AgentStep } from "@/lib/quest/schema";
import type { Challenge, ChallengeBatch } from "./schema";

/** Used when QUEST_MOCK=1. Case IDs are synthetic. */
export const FIXTURE_BATCH: ChallengeBatch = {
  neighborhood: "Mission",
  briefing:
    "Street & Sidewalk Cleaning dominates 311 around 16th & Mission: 181 reports in 90 days, 11 of them about the same overflowing can on the NE corner. OpenStreetMap has no waste basket mapped within 60 m of that corner. These challenges settle whether a bin exists at all, whether the Capp St dumping is still there, and how well the block is lit.",
  challenges: [
    {
      title: "Bin or no bin?",
      instructions: "Stand on the NE corner of 16th & Mission. Is there a public trash can within about 30 m? If yes, note whether it is full.",
      type: "verify_feature",
      answer_type: "yes_no",
      choices: [],
      location: { lat: 37.7651, lon: -122.4196, label: "16th St & Mission St, NE corner" },
      radius_m: 30,
      trigger: {
        summary: "11 'overflowing trash can' reports in 90 days at this corner (6 after dedupe), 2 still open.",
        category: "Street and Sidewalk Cleaning",
        case_ids: ["MOCK-1001", "MOCK-1042"],
        report_count: 11,
        prior_observation_ids: [],
      },
      osm: { feature: "waste_basket", mapped_nearby: 0, coverage_known: true },
      hypothesis: "No bin → the reports describe litter with nowhere to go; request a Bigbelly. Bin present → it is undersized or emptied too rarely; request a service-frequency change.",
      xp: 120,
      expires_in_days: 14,
    },
    {
      title: "Capp St dumping check",
      instructions: "Walk Capp St from 17th to 18th. Are there bulky items (mattresses, furniture, appliances) on the sidewalk or curb right now?",
      type: "confirm_issue",
      answer_type: "yes_no",
      choices: [],
      location: { lat: 37.7626, lon: -122.4183, label: "Capp St between 17th & 18th" },
      radius_m: 120,
      trigger: {
        summary: "8 bulky-item dumping reports on this 50 m stretch, roughly every 10 days; last closed 4 days ago.",
        category: "Street and Sidewalk Cleaning",
        case_ids: ["MOCK-1077", "MOCK-1102", "MOCK-1130"],
        report_count: 8,
        prior_observation_ids: [],
      },
      osm: { feature: null, mapped_nearby: 0, coverage_known: true },
      hypothesis: "Present → closures are not sticking; ask for a fixed monthly bulky pickup. Absent → the last pickup worked; re-check in a week.",
      xp: 100,
      expires_in_days: 7,
    },
    {
      title: "Count the lamps",
      instructions: "On the 1900 block of Mission St (west side), count working street lamps. Count only lamps that are on or clearly intact — skip dark or damaged ones.",
      type: "count_features",
      answer_type: "count",
      choices: [],
      location: { lat: 37.7612, lon: -122.4191, label: "Mission St 1900 block, west side" },
      radius_m: 90,
      trigger: {
        summary: "5 graffiti reports on the same three roll-down gates; tagging correlates with poor lighting.",
        category: "Graffiti",
        case_ids: ["MOCK-1205", "MOCK-1231"],
        report_count: 5,
        prior_observation_ids: [],
      },
      osm: { feature: "street_lamp", mapped_nearby: 2, coverage_known: true },
      hypothesis: "Fewer than 3 → lighting request alongside graffiti abatement. 3+ → lighting is fine, graffiti needs a mural or gate program.",
      xp: 80,
      expires_in_days: 21,
    },
  ],
};

export const FIXTURE_TRACE: AgentStep[] = [
  { tool: "aggregate_issue_categories", args: { lat: 37.7599, lon: -122.4148, radius_m: 1200 }, result_summary: "412 reports across 9 categories", ms: 38 },
  { tool: "search_issues", args: { category: "Street and Sidewalk Cleaning", radius_m: 1200 }, result_summary: "7 unique problems from 25/181 reports", ms: 21 },
  { tool: "get_prior_observations", args: { lat: 37.7599, lon: -122.4148, radius_m: 1200 }, result_summary: "0 resolved challenges, 0 observations", ms: 12 },
  { tool: "query_osm_features", args: { feature: "waste_basket", lat: 37.7651, lon: -122.4196, radius_m: 60 }, result_summary: "0 waste_basket mapped within 60 m", ms: 840 },
  { tool: "query_osm_features", args: { feature: "street_lamp", lat: 37.7612, lon: -122.4191, radius_m: 90 }, result_summary: "2 street_lamp mapped within 90 m", ms: 760 },
];

export function materializeFixture(batchId: string, now = new Date()): Challenge[] {
  return FIXTURE_BATCH.challenges.map((draft, i) => ({
    ...draft,
    id: `${batchId}-c${i + 1}`,
    batch_id: batchId,
    neighborhood: FIXTURE_BATCH.neighborhood,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + draft.expires_in_days * 86_400_000).toISOString(),
    status: "open",
    required_observations: 1,
    observation_count: 0,
    resolution: null,
    model: "fixture",
  }));
}
