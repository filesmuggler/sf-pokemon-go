import { featureTagStrings, OSM_FEATURES } from "@/lib/osm/features";
import { haversineM } from "@/lib/osm/overpass";
import type { Answer, Challenge, Observation, ObservationInput, Resolution } from "./schema";

/**
 * Pure functions that close the loop: turn a player's answer into an
 * Observation (with OSM-style tags) and, when enough observations exist,
 * into a Resolution on the Challenge.
 */

export function validateAnswer(challenge: Challenge, answer: Answer): string | null {
  switch (challenge.answer_type) {
    case "yes_no":
      return typeof answer.yes_no === "boolean" ? null : "answer.yes_no (boolean) is required for this challenge";
    case "count":
      return typeof answer.count === "number" ? null : "answer.count (integer) is required for this challenge";
    case "choice":
      if (typeof answer.choice !== "string") return "answer.choice is required for this challenge";
      return challenge.choices.includes(answer.choice) ? null : `answer.choice must be one of: ${challenge.choices.join(", ")}`;
  }
}

/** Tags a single observation supports. Only positive sightings produce feature tags. */
export function deriveTags(challenge: Challenge, answer: Answer): string[] {
  const tags: string[] = [];
  const feature = challenge.osm.feature;

  if (challenge.type === "verify_feature" && feature) {
    if (answer.yes_no === true) tags.push(...featureTagStrings(feature));
    else if (answer.yes_no === false) tags.push(`absent:${featureTagStrings(feature)[0]}`);
  }
  if (challenge.type === "count_features" && feature && typeof answer.count === "number") {
    tags.push(`count:${feature}=${answer.count}`);
  }
  if (challenge.type === "confirm_issue" && challenge.trigger.category) {
    const cat = challenge.trigger.category.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    tags.push(`sf311:${cat}=${answer.yes_no ? "present" : "not_present"}`);
  }
  if (challenge.type === "rate_condition" && answer.choice) {
    tags.push(`condition=${answer.choice.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
  }
  return tags;
}

export function buildObservation(
  challenge: Challenge,
  input: ObservationInput,
  id: string,
  now = new Date(),
): Observation {
  const location = input.location ?? { lat: challenge.location.lat, lon: challenge.location.lon };
  return {
    id,
    challenge_id: challenge.id,
    batch_id: challenge.batch_id,
    submitted_at: now.toISOString(),
    challenge_type: challenge.type,
    osm_feature: challenge.osm.feature,
    category: challenge.trigger.category,
    case_ids: challenge.trigger.case_ids,
    answer: {
      yes_no: input.answer.yes_no ?? null,
      count: input.answer.count ?? null,
      choice: input.answer.choice ?? null,
    },
    note: input.note?.trim() || null,
    photo_url: input.photo_url ?? null,
    player: input.player?.trim() || null,
    location,
    distance_from_target_m: input.location ? haversineM(input.location, challenge.location) : null,
    derived_tags: deriveTags(challenge, input.answer),
    source: "sf-side-quest",
  };
}

/** Majority / aggregate over all observations for a challenge. */
export function resolveChallenge(challenge: Challenge, observations: Observation[], now = new Date()): Resolution {
  const resolved_at = now.toISOString();
  const label = challenge.osm.feature ? OSM_FEATURES[challenge.osm.feature].label : "feature";
  const where = challenge.location.label;

  if (observations.length === 0) {
    return { outcome: "inconclusive", summary: "No observations yet.", derived_tags: [], resolved_at };
  }

  const yes = observations.filter((o) => o.answer.yes_no === true).length;
  const no = observations.filter((o) => o.answer.yes_no === false).length;
  const tagUnion = [...new Set(observations.flatMap((o) => o.derived_tags))];

  switch (challenge.type) {
    case "verify_feature": {
      if (yes === no) return { outcome: "inconclusive", summary: `Players disagree (${yes} yes / ${no} no) on whether there is a ${label} at ${where}.`, derived_tags: [], resolved_at };
      const present = yes > no;
      return {
        outcome: present ? "feature_present" : "feature_absent",
        summary: present
          ? `${yes}/${observations.length} players confirmed a ${label} at ${where}. OSM had ${challenge.osm.mapped_nearby} mapped within ${challenge.radius_m} m — ${challenge.osm.mapped_nearby === 0 ? "candidate for adding to the map" : "already mapped"}.`
          : `${no}/${observations.length} players found no ${label} at ${where}. Supports the case for adding one (${challenge.trigger.report_count} related 311 reports).`,
        derived_tags: tagUnion.filter((t) => (present ? !t.startsWith("absent:") : t.startsWith("absent:"))),
        resolved_at,
      };
    }
    case "confirm_issue": {
      if (yes === no) return { outcome: "inconclusive", summary: `Mixed reports (${yes} present / ${no} not) on whether the issue at ${where} persists.`, derived_tags: [], resolved_at };
      const persists = yes > no;
      return {
        outcome: persists ? "issue_persists" : "issue_resolved",
        summary: persists
          ? `Issue at ${where} is still present per ${yes}/${observations.length} players despite ${challenge.trigger.case_ids.length} 311 case(s).`
          : `Issue at ${where} appears resolved on the ground (${no}/${observations.length} players).`,
        derived_tags: tagUnion.filter((t) => t.endsWith(persists ? "=present" : "=not_present")),
        resolved_at,
      };
    }
    case "count_features": {
      const counts = observations.map((o) => o.answer.count).filter((c): c is number => typeof c === "number");
      const median = counts.length ? [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)] : null;
      return {
        outcome: median === null ? "inconclusive" : "count_recorded",
        summary:
          median === null
            ? "No numeric answers recorded."
            : `Players counted ${median} ${label}(s) around ${where} (OSM had ${challenge.osm.mapped_nearby} mapped).`,
        derived_tags: challenge.osm.feature && median !== null ? [`count:${challenge.osm.feature}=${median}`] : [],
        resolved_at,
      };
    }
    case "rate_condition": {
      const tally = new Map<string, number>();
      for (const o of observations) if (o.answer.choice) tally.set(o.answer.choice, (tally.get(o.answer.choice) ?? 0) + 1);
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        outcome: top ? "condition_rated" : "inconclusive",
        summary: top ? `Condition at ${where} rated "${top[0]}" by ${top[1]}/${observations.length} players.` : "No ratings recorded.",
        derived_tags: top ? [`condition=${top[0].toLowerCase().replace(/[^a-z0-9]+/g, "_")}`] : [],
        resolved_at,
      };
    }
  }
}

export function isExpired(challenge: Challenge, now = new Date()): boolean {
  return new Date(challenge.expires_at).getTime() < now.getTime();
}
