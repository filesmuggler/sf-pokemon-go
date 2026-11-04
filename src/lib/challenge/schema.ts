import { z } from "zod";
import { GeoPointSchema, type AgentStep } from "@/lib/quest/schema";
import { OSM_FEATURE_KEYS } from "@/lib/osm/features";

/**
 * Closed-loop "map challenges".
 *
 *   trend (311 + OSM + prior observations)
 *     → agent creates a Challenge
 *     → player does it on the ground and submits an Observation
 *     → server resolves the challenge and derives OSM-style tags
 *     → the next agent run reads those observations as ground truth.
 */

export const ChallengeTypeSchema = z.enum([
  /** "OSM shows no trash can here, 311 says trash piles up. Is there one?" */
  "verify_feature",
  /** "311 case X says dumping at Y. Is it still there?" */
  "confirm_issue",
  /** "How many street lamps on this block?" */
  "count_features",
  /** "Rate the sidewalk condition on this block." */
  "rate_condition",
]);
export type ChallengeType = z.infer<typeof ChallengeTypeSchema>;

export const AnswerTypeSchema = z.enum(["yes_no", "count", "choice"]);
export type AnswerType = z.infer<typeof AnswerTypeSchema>;

export const OsmFeatureKeySchema = z.enum(OSM_FEATURE_KEYS);
export type OsmFeatureKey = z.infer<typeof OsmFeatureKeySchema>;

export const ChallengeStatusSchema = z.enum(["open", "completed", "expired"]);
export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>;

/** What the agent emits. Everything here must be derivable from tool results. */
export const ChallengeDraftSchema = z.object({
  title: z.string().describe("Short, game-like title"),
  instructions: z.string().describe("Exactly what the player should do and look for on the ground (1-3 sentences)"),
  type: ChallengeTypeSchema,
  answer_type: AnswerTypeSchema,
  choices: z.array(z.string()).describe("Options when answer_type is 'choice'; otherwise empty"),
  location: GeoPointSchema.extend({ label: z.string().describe("Street corner or landmark") }),
  radius_m: z.number().int().min(10).max(300).describe("How close the player must be / how big the area to inspect"),
  trigger: z.object({
    summary: z.string().describe("The trend that motivated this challenge, in one sentence, with numbers"),
    category: z.string().nullable().describe("311 category, if any"),
    case_ids: z.array(z.string()).describe("Real 311 case IDs behind this trend"),
    report_count: z.number().int(),
    prior_observation_ids: z.array(z.string()).describe("IDs of earlier player observations this builds on, if any"),
  }),
  osm: z.object({
    feature: OsmFeatureKeySchema.nullable().describe("Map feature this challenge is about, if any"),
    mapped_nearby: z.number().int().describe("How many such features OSM already has within radius_m (from query_osm_features)"),
    coverage_known: z.boolean().describe("false if the OSM lookup failed and coverage is unknown"),
  }),
  hypothesis: z.string().describe("What each answer would mean, e.g. 'No bin → supports requesting one; bin present → it is undersized or emptied too rarely'"),
  xp: z.number().int().min(10).max(300),
  expires_in_days: z.number().int().min(1).max(60),
});
export type ChallengeDraft = z.infer<typeof ChallengeDraftSchema>;

export const ChallengeBatchSchema = z.object({
  neighborhood: z.string(),
  briefing: z.string().describe("2-3 sentences: what trend the agent saw and what the challenges will settle"),
  challenges: z.array(ChallengeDraftSchema).min(1).max(4),
});
export type ChallengeBatch = z.infer<typeof ChallengeBatchSchema>;

/** Outcome once observations arrive. */
export const ResolutionSchema = z.object({
  outcome: z.enum([
    "feature_present",
    "feature_absent",
    "issue_persists",
    "issue_resolved",
    "count_recorded",
    "condition_rated",
    "inconclusive",
  ]),
  summary: z.string(),
  /** OSM-style tags derived from the observation(s), e.g. ["amenity=waste_basket"]. */
  derived_tags: z.array(z.string()),
  resolved_at: z.string(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

/** Stored challenge = draft + server-managed fields. */
export const ChallengeSchema = ChallengeDraftSchema.extend({
  id: z.string(),
  batch_id: z.string(),
  neighborhood: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  status: ChallengeStatusSchema,
  required_observations: z.number().int().min(1),
  observation_count: z.number().int(),
  resolution: ResolutionSchema.nullable(),
  model: z.string(),
});
export type Challenge = z.infer<typeof ChallengeSchema>;

/** Player feedback. */
export const AnswerSchema = z.object({
  yes_no: z.boolean().nullable().optional(),
  count: z.number().int().min(0).nullable().optional(),
  choice: z.string().nullable().optional(),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const ObservationInputSchema = z.object({
  answer: AnswerSchema,
  note: z.string().max(1000).optional(),
  /** Where the player actually was. Falls back to the challenge location. */
  location: GeoPointSchema.optional(),
  photo_url: z.string().url().optional(),
  player: z.string().max(64).optional(),
});
export type ObservationInput = z.infer<typeof ObservationInputSchema>;

export const ObservationSchema = z.object({
  id: z.string(),
  challenge_id: z.string(),
  batch_id: z.string(),
  submitted_at: z.string(),
  challenge_type: ChallengeTypeSchema,
  osm_feature: OsmFeatureKeySchema.nullable(),
  category: z.string().nullable(),
  case_ids: z.array(z.string()),
  answer: AnswerSchema,
  note: z.string().nullable(),
  photo_url: z.string().nullable(),
  player: z.string().nullable(),
  location: GeoPointSchema,
  /** Distance between the player and the challenge spot, if the player shared location. */
  distance_from_target_m: z.number().nullable(),
  /** OSM-style tags this observation supports, e.g. ["amenity=waste_basket"]. */
  derived_tags: z.array(z.string()),
  source: z.literal("sf-side-quest"),
});
export type Observation = z.infer<typeof ObservationSchema>;

/** POST /api/challenges */
export const ChallengeRequestSchema = z.object({
  lat: z.number().min(37.6).max(37.9),
  lon: z.number().min(-122.6).max(-122.3),
  radius_m: z.number().min(100).max(3000).default(1200),
  days: z.number().int().min(1).max(365).default(90),
  neighborhood_hint: z.string().optional(),
});
export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;

export interface ChallengeBatchResponse {
  batch_id: string;
  neighborhood: string;
  briefing: string;
  challenges: Challenge[];
  trace: AgentStep[];
  model: string;
  mock?: boolean;
}

export interface ObservationResponse {
  observation: Observation;
  challenge: Challenge;
  /** True when this observation completed the challenge. */
  closed_loop: boolean;
  mock?: boolean;
}
