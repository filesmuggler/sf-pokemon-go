import type {
  AggregationsMultiBucketAggregateBase,
  AggregationsStringTermsBucket,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { getElasticClient, getIndexName } from "./client";
import type { CaseStatus, SF311Case } from "@/lib/sf311/types";
import { getEnv } from "@/lib/env";

/** Keyword match, plus ELSER semantic match when an inference endpoint is configured. */
function textQuery(query: string): QueryDslQueryContainer {
  const keyword: QueryDslQueryContainer = {
    multi_match: { query, fields: ["description^2", "details", "status_notes"] },
  };
  if (!getEnv().ELASTICSEARCH_INFERENCE_ID) return keyword;
  return { bool: { should: [keyword, { semantic: { field: "description_semantic", query } }] } };
}

export interface GeoCenter {
  lat: number;
  lon: number;
}

export interface NearbyQuery extends GeoCenter {
  radiusM: number;
  /** Free-text search over `description`. */
  query?: string;
  status?: CaseStatus;
  category?: string;
  subtype?: string;
  /** Only cases requested in the last N days. */
  days?: number;
  size?: number;
}

export interface NearbyCase extends SF311Case {
  distance_m?: number;
}

function baseFilters(q: {
  lat: number;
  lon: number;
  radiusM: number;
  status?: CaseStatus;
  category?: string;
  subtype?: string;
  days?: number;
}): QueryDslQueryContainer[] {
  const filters: QueryDslQueryContainer[] = [
    {
      geo_distance: {
        distance: `${Math.round(q.radiusM)}m`,
        location: { lat: q.lat, lon: q.lon },
      },
    },
  ];
  if (q.status) filters.push({ term: { status: q.status } });
  if (q.category) filters.push({ term: { category: q.category } });
  if (q.subtype) filters.push({ term: { subtype: q.subtype } });
  if (q.days) filters.push({ range: { requested_at: { gte: `now-${q.days}d/d` } } });
  return filters;
}

/** Geo-filtered search for cases, ranked by relevance (if `query`) then distance. */
export async function searchNearbyCases(q: NearbyQuery): Promise<{ total: number; cases: NearbyCase[] }> {
  const es = getElasticClient();
  const res = await es.search<SF311Case>({
    index: getIndexName(),
    size: q.size ?? 25,
    query: {
      bool: {
        filter: baseFilters(q),
        must: q.query ? [textQuery(q.query)] : undefined,
      },
    },
    sort: q.query
      ? ["_score", { _geo_distance: { location: { lat: q.lat, lon: q.lon }, order: "asc", unit: "m" } }]
      : [{ _geo_distance: { location: { lat: q.lat, lon: q.lon }, order: "asc", unit: "m" } }],
  });

  const total = typeof res.hits.total === "number" ? res.hits.total : res.hits.total?.value ?? 0;
  const cases: NearbyCase[] = res.hits.hits
    .filter((h) => h._source)
    .map((h) => {
      const sortValues = (h.sort ?? []) as unknown[];
      const distance = sortValues.find((v) => typeof v === "number" && v >= 0 && v < 1e7);
      return { ...(h._source as SF311Case), distance_m: typeof distance === "number" ? Math.round(distance) : undefined };
    });

  return { total, cases };
}

export interface CategoryBucket {
  category: string;
  total: number;
  open: number;
  closed: number;
  first_reported?: string;
  last_reported?: string;
  centroid?: GeoCenter;
  subtypes: { subtype: string; count: number }[];
}

/**
 * "What keeps getting reported around here?" — grouped by category with
 * open/closed split, time span and geographic centroid.
 */
export async function aggregateNearbyCategories(q: {
  lat: number;
  lon: number;
  radiusM: number;
  days?: number;
  size?: number;
}): Promise<{ total: number; categories: CategoryBucket[] }> {
  const es = getElasticClient();
  const res = await es.search({
    index: getIndexName(),
    size: 0,
    query: { bool: { filter: baseFilters(q) } },
    aggs: {
      by_category: {
        terms: { field: "category", size: q.size ?? 10 },
        aggs: {
          by_status: { terms: { field: "status", size: 2 } },
          by_subtype: { terms: { field: "subtype", size: 5 } },
          first_reported: { min: { field: "requested_at" } },
          last_reported: { max: { field: "requested_at" } },
          centroid: { geo_centroid: { field: "location" } },
        },
      },
    },
  });

  type Bucket = AggregationsStringTermsBucket & {
    by_status: AggregationsMultiBucketAggregateBase<AggregationsStringTermsBucket>;
    by_subtype: AggregationsMultiBucketAggregateBase<AggregationsStringTermsBucket>;
    first_reported: { value_as_string?: string };
    last_reported: { value_as_string?: string };
    centroid: { location?: GeoCenter };
  };

  const agg = res.aggregations?.by_category as AggregationsMultiBucketAggregateBase<Bucket> | undefined;
  const buckets = (Array.isArray(agg?.buckets) ? agg.buckets : []) as Bucket[];
  const total = typeof res.hits.total === "number" ? res.hits.total : res.hits.total?.value ?? 0;

  const statusCount = (b: Bucket, s: CaseStatus) => {
    const list = Array.isArray(b.by_status.buckets) ? b.by_status.buckets : [];
    return list.find((x) => x.key === s)?.doc_count ?? 0;
  };

  return {
    total,
    categories: buckets.map((b) => ({
      category: String(b.key),
      total: b.doc_count,
      open: statusCount(b, "open"),
      closed: statusCount(b, "closed"),
      first_reported: b.first_reported.value_as_string,
      last_reported: b.last_reported.value_as_string,
      centroid: b.centroid.location,
      subtypes: (Array.isArray(b.by_subtype.buckets) ? b.by_subtype.buckets : []).map((s) => ({
        subtype: String(s.key),
        count: s.doc_count,
      })),
    })),
  };
}

/**
 * Likely duplicates of a given case: same category, textually similar,
 * reported within `radiusM` of it. Used to collapse repeat reports.
 */
export async function findSimilarCases(opts: {
  caseId: string;
  radiusM?: number;
  size?: number;
}): Promise<{ anchor: SF311Case | null; similar: NearbyCase[] }> {
  const es = getElasticClient();
  const index = getIndexName();

  const anchorRes = await es.get<SF311Case>({ index, id: opts.caseId }, { ignore: [404] });
  const anchor = anchorRes.found ? (anchorRes._source ?? null) : null;
  if (!anchor?.location) return { anchor, similar: [] };

  const radiusM = opts.radiusM ?? 75;
  const res = await es.search<SF311Case>({
    index,
    size: opts.size ?? 10,
    query: {
      bool: {
        must_not: [{ ids: { values: [anchor.id] } }],
        filter: [
          { term: { category: anchor.category } },
          { geo_distance: { distance: `${radiusM}m`, location: anchor.location } },
        ],
        should: [
          {
            more_like_this: {
              fields: ["description"],
              like: anchor.description,
              min_term_freq: 1,
              min_doc_freq: 1,
            },
          },
        ],
      },
    },
    sort: [{ _geo_distance: { location: anchor.location, order: "asc", unit: "m" } }],
  });

  return {
    anchor,
    similar: res.hits.hits
      .filter((h) => h._source)
      .map((h) => ({
        ...(h._source as SF311Case),
        distance_m: typeof h.sort?.[0] === "number" ? Math.round(h.sort[0]) : undefined,
      })),
  };
}

/** Current open/closed status for a batch of case IDs. */
export async function getCaseStatuses(
  ids: string[],
): Promise<{ id: string; found: boolean; status?: CaseStatus; closed_at?: string; status_notes?: string }[]> {
  if (ids.length === 0) return [];
  const es = getElasticClient();
  const res = await es.mget<SF311Case>({
    index: getIndexName(),
    ids,
    _source_includes: ["id", "status", "closed_at", "status_notes"],
  });
  return res.docs.map((d) => {
    if ("found" in d && d.found && d._source) {
      return {
        id: d._id,
        found: true,
        status: d._source.status,
        closed_at: d._source.closed_at,
        status_notes: d._source.status_notes,
      };
    }
    return { id: d._id, found: false };
  });
}

export interface CaseCluster {
  key: string;
  representative: NearbyCase;
  duplicate_ids: string[];
  count: number;
  open: number;
  closed: number;
}

/**
 * Cheap in-memory dedupe: cases with the same category + subtype within ~55 m
 * (4-decimal lat/lon rounding) are treated as one recurring problem.
 */
export function clusterDuplicates(cases: NearbyCase[]): CaseCluster[] {
  const clusters = new Map<string, CaseCluster>();
  for (const c of cases) {
    const lat = c.location ? c.location.lat.toFixed(3) : "na";
    const lon = c.location ? c.location.lon.toFixed(3) : "na";
    const key = [c.category, c.subtype ?? "", lat, lon].join("|");
    const existing = clusters.get(key);
    if (!existing) {
      clusters.set(key, {
        key,
        representative: c,
        duplicate_ids: [],
        count: 1,
        open: c.status === "open" ? 1 : 0,
        closed: c.status === "closed" ? 1 : 0,
      });
    } else {
      existing.duplicate_ids.push(c.id);
      existing.count += 1;
      if (c.status === "open") existing.open += 1;
      else existing.closed += 1;
      // Prefer an open case as the representative.
      if (existing.representative.status === "closed" && c.status === "open") {
        existing.duplicate_ids.push(existing.representative.id);
        existing.duplicate_ids = existing.duplicate_ids.filter((id) => id !== c.id);
        existing.representative = c;
      }
    }
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count);
}
