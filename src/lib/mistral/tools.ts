import { z } from "zod";
import type { Tool } from "@mistralai/mistralai/models/components";
import {
  aggregateNearbyCategories,
  clusterDuplicates,
  findSimilarCases,
  getCaseStatuses,
  searchNearbyCases,
  type NearbyCase,
} from "@/lib/elastic/queries";
import { OSM_FEATURE_KEYS, OSM_FEATURES } from "@/lib/osm/features";
import { queryOsmFeatures } from "@/lib/osm/overpass";
import { priorKnowledge } from "@/lib/challenge/service";

/**
 * Tools the Mistral agents can call. The 311 tools are backed by
 * Elasticsearch queries over the indexed cases; the challenge agent also gets
 * OpenStreetMap lookups and the loop's own observation history. Keep results
 * compact — they go back into the model's context.
 */

const geoArgs = {
  lat: z.number().describe("Latitude of the search center"),
  lon: z.number().describe("Longitude of the search center"),
  radius_m: z.number().int().min(50).max(3000).describe("Search radius in meters"),
  days: z.number().int().min(1).max(365).optional().describe("Only reports from the last N days"),
};

export const toolSchemas = {
  aggregate_issue_categories: z.object({
    ...geoArgs,
  }),
  search_issues: z.object({
    ...geoArgs,
    query: z.string().optional().describe("Free-text query, e.g. 'overflowing trash can'"),
    category: z.string().optional().describe("Exact 311 category, from aggregate_issue_categories"),
    subtype: z.string().optional().describe("Exact 311 subtype"),
    status: z.enum(["open", "closed"]).optional(),
    size: z.number().int().min(1).max(50).optional().describe("Max results (default 25)"),
    dedupe: z.boolean().optional().describe("Collapse likely duplicates (default true)"),
  }),
  find_duplicate_reports: z.object({
    case_id: z.string().describe("Anchor 311 case ID"),
    radius_m: z.number().int().min(10).max(500).optional().describe("Default 75 m"),
  }),
  check_case_status: z.object({
    case_ids: z.array(z.string()).min(1).max(50),
  }),
  query_osm_features: z.object({
    lat: z.number(),
    lon: z.number(),
    radius_m: z.number().int().min(10).max(500).describe("Small radius — a corner or a block (30–150 m)"),
    feature: z.enum(OSM_FEATURE_KEYS).describe("Map feature type to look for"),
  }),
  get_prior_observations: z.object({
    ...geoArgs,
  }),
} as const;

export type ToolName = keyof typeof toolSchemas;

/** Which tools each agent sees. */
export const QUEST_TOOLS: ToolName[] = ["aggregate_issue_categories", "search_issues", "find_duplicate_reports", "check_case_status"];
export const CHALLENGE_TOOLS: ToolName[] = [...QUEST_TOOLS, "get_prior_observations", "query_osm_features"];

const featureList = OSM_FEATURE_KEYS.map((k) => `${k} (${OSM_FEATURES[k].label}; relevant to ${OSM_FEATURES[k].related_311.join("/")})`).join(", ");

const descriptions: Record<ToolName, string> = {
  aggregate_issue_categories:
    "Overview of what gets reported to 311 within a radius: counts per category, open vs closed, first/last report date, and the geographic centroid. Call this first.",
  search_issues:
    "List individual 311 cases within a radius, optionally filtered by text, category, subtype or status. Duplicates are collapsed by default and reported as duplicate_ids.",
  find_duplicate_reports:
    "Given one case ID, find other reports of the same category nearby with similar text — i.e. likely duplicates of the same underlying problem.",
  check_case_status:
    "Confirm whether specific cases are currently open or closed, with closure notes if any.",
  query_osm_features: `Look up what OpenStreetMap already has mapped near a point: count and positions of a feature type. Use it to test whether a 311 trend is explained by missing infrastructure (e.g. many trash reports but no waste_basket mapped). If available=false the lookup failed and coverage is UNKNOWN — do not treat that as "nothing mapped". Feature types: ${featureList}.`,
  get_prior_observations:
    "Ground truth collected by players in this area from earlier challenges: resolved challenges with outcomes, still-open challenges, and recent observations with derived OSM-style tags. Call this before designing challenges so you do not repeat a settled question and can build on confirmed facts (e.g. a bin confirmed absent → escalate; an issue confirmed resolved → drop it).",
};

export function getToolDefinitions(names: ToolName[] = Object.keys(toolSchemas) as ToolName[]): Tool[] {
  return names.map((name) => ({
    type: "function",
    function: {
      name,
      description: descriptions[name],
      parameters: z.toJSONSchema(toolSchemas[name]),
    },
  }));
}

function compactCase(c: NearbyCase) {
  return {
    id: c.id,
    status: c.status,
    category: c.category,
    subtype: c.subtype,
    details: c.details?.slice(0, 160),
    address: c.address,
    requested_at: c.requested_at?.slice(0, 10),
    closed_at: c.closed_at?.slice(0, 10),
    lat: c.location?.lat,
    lon: c.location?.lon,
    distance_m: c.distance_m,
  };
}

export async function executeTool(name: ToolName, rawArgs: unknown): Promise<unknown> {
  switch (name) {
    case "aggregate_issue_categories": {
      const a = toolSchemas.aggregate_issue_categories.parse(rawArgs);
      return aggregateNearbyCategories({ lat: a.lat, lon: a.lon, radiusM: a.radius_m, days: a.days });
    }
    case "search_issues": {
      const a = toolSchemas.search_issues.parse(rawArgs);
      const { total, cases } = await searchNearbyCases({
        lat: a.lat,
        lon: a.lon,
        radiusM: a.radius_m,
        days: a.days,
        query: a.query,
        category: a.category,
        subtype: a.subtype,
        status: a.status,
        size: a.size ?? 25,
      });
      if (a.dedupe === false) {
        return { total, cases: cases.map(compactCase) };
      }
      const clusters = clusterDuplicates(cases);
      return {
        total_matching: total,
        returned: cases.length,
        unique_problems: clusters.length,
        problems: clusters.map((cl) => ({
          ...compactCase(cl.representative),
          report_count: cl.count,
          open: cl.open,
          closed: cl.closed,
          duplicate_ids: cl.duplicate_ids,
        })),
      };
    }
    case "find_duplicate_reports": {
      const a = toolSchemas.find_duplicate_reports.parse(rawArgs);
      const { anchor, similar } = await findSimilarCases({ caseId: a.case_id, radiusM: a.radius_m });
      return {
        anchor: anchor ? compactCase(anchor) : null,
        duplicates: similar.map(compactCase),
      };
    }
    case "check_case_status": {
      const a = toolSchemas.check_case_status.parse(rawArgs);
      return getCaseStatuses(a.case_ids);
    }
    case "query_osm_features": {
      const a = toolSchemas.query_osm_features.parse(rawArgs);
      const r = await queryOsmFeatures({ lat: a.lat, lon: a.lon, radiusM: a.radius_m, feature: a.feature, limit: 25 });
      return {
        available: r.available,
        feature: r.feature,
        label: r.label,
        osm_tags: r.tags,
        count: r.count,
        features: r.features.slice(0, 15).map((f) => ({ osm_id: f.osm_id, lat: f.lat, lon: f.lon, distance_m: f.distance_m, name: f.name, ...f.tags })),
        error: r.error,
      };
    }
    case "get_prior_observations": {
      const a = toolSchemas.get_prior_observations.parse(rawArgs);
      return priorKnowledge({ lat: a.lat, lon: a.lon, radiusM: a.radius_m, days: a.days ?? 60 });
    }
  }
}

export function isToolName(name: string): name is ToolName {
  return name in toolSchemas;
}

/** One-line summary for the trace UI. */
export function summarizeToolResult(name: ToolName, result: unknown): string {
  const r = result as Record<string, unknown>;
  switch (name) {
    case "aggregate_issue_categories":
      return `${r.total} reports across ${(r.categories as unknown[]).length} categories`;
    case "search_issues":
      return "problems" in r
        ? `${r.unique_problems} unique problems from ${r.returned}/${r.total_matching} reports`
        : `${(r.cases as unknown[]).length} cases`;
    case "find_duplicate_reports":
      return `${(r.duplicates as unknown[]).length} likely duplicates`;
    case "check_case_status": {
      const list = result as { status?: string }[];
      const open = list.filter((x) => x.status === "open").length;
      return `${open} open / ${list.length - open} closed`;
    }
    case "query_osm_features":
      return r.available ? `${r.count} ${r.feature} mapped in OSM nearby` : `OSM lookup unavailable (${String(r.error).slice(0, 60)})`;
    case "get_prior_observations":
      return `${(r.resolved_challenges as unknown[]).length} resolved, ${(r.open_challenges as unknown[]).length} open, ${(r.recent_observations as unknown[]).length} observations`;
  }
}
