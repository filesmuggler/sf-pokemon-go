import { z } from "zod";

export const GeoPointSchema = z.object({
  lat: z.number(),
  lon: z.number(),
});

export const ProblemSchema = z.object({
  id: z.string().describe("Short slug, e.g. 'p1'"),
  title: z.string(),
  category: z.string().describe("311 category this problem maps to"),
  description: z.string().describe("Plain-language explanation of what keeps happening and why it matters"),
  occurrences: z.number().int().describe("Number of distinct reports after removing duplicates"),
  duplicates_removed: z.number().int(),
  open_count: z.number().int(),
  closed_count: z.number().int(),
  case_ids: z.array(z.string()).describe("Representative 311 case IDs (not duplicates)"),
  location: GeoPointSchema.extend({ label: z.string().describe("Nearest street or landmark") }),
  recurring_since: z.string().nullable().describe("ISO date of the earliest report, or null"),
});

export const InterventionSchema = z.object({
  title: z.string(),
  rationale: z.string().describe("Why this is the most useful single intervention for this neighborhood"),
  steps: z.array(z.string()).min(1),
  who_to_contact: z.string().describe("Agency / supervisor office / community org"),
  estimated_impact: z.enum(["low", "medium", "high"]),
});

export const ObjectiveSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(["visit", "photo", "verify", "report", "propose"]),
  target_problem_id: z.string().nullable(),
  xp: z.number().int().min(10).max(500),
});

export const QuestSchema = z.object({
  title: z.string().describe("Playful quest name"),
  neighborhood: z.string(),
  summary: z.string().describe("2-3 sentence mission briefing"),
  center: GeoPointSchema,
  radius_m: z.number(),
  problems: z.array(ProblemSchema).min(1).max(3),
  intervention: InterventionSchema,
  objectives: z.array(ObjectiveSchema).min(1),
  total_xp: z.number().int(),
});

export type Quest = z.infer<typeof QuestSchema>;
export type Problem = z.infer<typeof ProblemSchema>;
export type Objective = z.infer<typeof ObjectiveSchema>;

/** Request body for POST /api/quest */
export const QuestRequestSchema = z.object({
  lat: z.number().min(37.6).max(37.9),
  lon: z.number().min(-122.6).max(-122.3),
  /** 15-minute walk ≈ 1.2 km */
  radius_m: z.number().min(100).max(3000).default(1200),
  /** Only consider reports from the last N days */
  days: z.number().int().min(1).max(365).default(90),
  neighborhood_hint: z.string().optional(),
});
export type QuestRequest = z.infer<typeof QuestRequestSchema>;

/** Trace of what the agent did, returned alongside the quest for transparency / debugging. */
export interface AgentStep {
  tool: string;
  args: unknown;
  result_summary: string;
  ms: number;
  /** Full tool output; only populated by agents that opt in (dev agent). */
  result?: unknown;
}

export interface QuestResponse {
  quest: Quest;
  trace: AgentStep[];
  model: string;
  mock?: boolean;
}
