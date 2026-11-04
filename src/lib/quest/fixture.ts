import type { QuestResponse } from "./schema";

/**
 * Static quest used when QUEST_MOCK=1 so the UI can be developed without
 * Elasticsearch or a Mistral key. Case IDs here are synthetic.
 */
export const FIXTURE_QUEST: QuestResponse = {
  mock: true,
  model: "fixture",
  trace: [
    { tool: "aggregate_issue_categories", args: { lat: 37.7599, lon: -122.4148, radius_m: 1200 }, result_summary: "412 reports across 9 categories", ms: 38 },
    { tool: "search_issues", args: { category: "Street and Sidewalk Cleaning", radius_m: 1200 }, result_summary: "7 unique problems from 25/181 reports", ms: 21 },
    { tool: "find_duplicate_reports", args: { case_id: "MOCK-1001" }, result_summary: "4 likely duplicates", ms: 14 },
    { tool: "check_case_status", args: { case_ids: ["MOCK-1001", "MOCK-1042", "MOCK-1077"] }, result_summary: "2 open / 1 closed", ms: 9 },
  ],
  quest: {
    title: "Operation Clean Corner: 16th & Mission",
    neighborhood: "Mission",
    summary:
      "The blocks around 16th & Mission BART generate a steady stream of 311 reports. Three problems keep coming back: an overflowing corner trash can, repeat illegal dumping on Capp St, and graffiti on the same roll-down gates. Walk the loop, verify what's still there, and back the fix that would help most.",
    center: { lat: 37.7599, lon: -122.4148 },
    radius_m: 1200,
    problems: [
      {
        id: "p1",
        title: "Overflowing trash can at 16th & Mission (NE corner)",
        category: "Street and Sidewalk Cleaning",
        description: "Reported 11 times in 90 days; 5 reports were duplicates filed within hours of each other. Closed cases reopen within a week.",
        occurrences: 6,
        duplicates_removed: 5,
        open_count: 2,
        closed_count: 4,
        case_ids: ["MOCK-1001", "MOCK-1042"],
        location: { lat: 37.7651, lon: -122.4196, label: "16th St & Mission St, NE corner" },
        recurring_since: "2026-08-12",
      },
      {
        id: "p2",
        title: "Bulky-item dumping on Capp St between 17th & 18th",
        category: "Street and Sidewalk Cleaning",
        description: "Mattresses and furniture show up on the same 50 m stretch roughly every 10 days. Pickups close the case but nothing prevents the next drop.",
        occurrences: 8,
        duplicates_removed: 3,
        open_count: 1,
        closed_count: 7,
        case_ids: ["MOCK-1077", "MOCK-1102", "MOCK-1130"],
        location: { lat: 37.7626, lon: -122.4183, label: "Capp St between 17th & 18th" },
        recurring_since: "2026-08-03",
      },
      {
        id: "p3",
        title: "Repeat tagging on roll-down gates, Mission St 1900 block",
        category: "Graffiti",
        description: "Same three storefront gates tagged after each cleaning. Private-property graffiti cases are closed as 'notice sent' without removal.",
        occurrences: 5,
        duplicates_removed: 2,
        open_count: 2,
        closed_count: 3,
        case_ids: ["MOCK-1205", "MOCK-1231"],
        location: { lat: 37.7612, lon: -122.4191, label: "Mission St near 19th" },
        recurring_since: "2026-09-01",
      },
    ],
    intervention: {
      title: "Request a second Bigbelly bin + fixed bulky-pickup day for Capp St",
      rationale:
        "Problems 1 and 2 share a root cause: not enough legitimate places to put waste. A higher-capacity compacting bin on the busiest corner and a predictable monthly bulky-item day would remove most repeat reports, and Recology already runs both programs.",
      steps: [
        "Photograph the overflowing can at three different times of day and attach to a new 311 request citing the case IDs.",
        "Email District 9 supervisor's office requesting a Bigbelly at 16th & Mission NE corner.",
        "Ask Mission Merchants Association to co-sign a Recology bulky-item collection day for Capp St.",
      ],
      who_to_contact: "SF Public Works (Street Cleaning), District 9 Supervisor's office, Recology",
      estimated_impact: "high",
    },
    objectives: [
      { id: "o1", title: "Scout the corner", description: "Visit 16th & Mission NE corner.", type: "visit", target_problem_id: "p1", xp: 50 },
      { id: "o2", title: "Evidence photo", description: "Photograph the trash can's current state.", type: "photo", target_problem_id: "p1", xp: 100 },
      { id: "o3", title: "Dumping check", description: "Walk Capp St 17th→18th and verify whether bulky items are present.", type: "verify", target_problem_id: "p2", xp: 100 },
      { id: "o4", title: "Gate audit", description: "Confirm which of the three gates on the 1900 block are currently tagged.", type: "verify", target_problem_id: "p3", xp: 75 },
      { id: "o5", title: "File it", description: "Submit one consolidated 311 report referencing the duplicate case IDs.", type: "report", target_problem_id: "p1", xp: 150 },
      { id: "o6", title: "Pitch the fix", description: "Send the Bigbelly + pickup-day proposal to the supervisor's office.", type: "propose", target_problem_id: null, xp: 200 },
    ],
    total_xp: 675,
  },
};
