import { getEnv } from "@/lib/env";
import { OSM_FEATURES, overpassFilter, type OsmFeatureKeyName } from "./features";

/**
 * Minimal Overpass API client. Public Overpass endpoints are rate-limited and
 * frequently at capacity, so we fail over across endpoints and degrade to
 * `available: false` instead of throwing — the agent then treats OSM coverage
 * as unknown rather than as "nothing mapped".
 */

export interface OsmFeature {
  osm_id: string; // "node/123" | "way/456"
  lat: number;
  lon: number;
  distance_m: number;
  name?: string;
  tags: Record<string, string>;
}

export interface OsmFeatureQuery {
  lat: number;
  lon: number;
  radiusM: number;
  feature: OsmFeatureKeyName;
  limit?: number;
}

export interface OsmFeatureResult {
  available: boolean;
  feature: OsmFeatureKeyName;
  label: string;
  tags: Record<string, string>;
  count: number;
  features: OsmFeature[];
  endpoint?: string;
  error?: string;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const USER_AGENT = "sf-side-quest/0.1 (civic map challenges; dev)";
const TAG_KEEP = ["name", "operator", "waste", "material", "capacity", "lit", "crossing", "backrest", "covered", "ref"];

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export function buildOverpassQuery(q: OsmFeatureQuery): string {
  const filter = overpassFilter(q.feature);
  const around = `(around:${Math.round(q.radiusM)},${q.lat},${q.lon})`;
  return `[out:json][timeout:20];(node${around}${filter};way${around}${filter};);out center ${q.limit ?? 50};`;
}

function endpoints(): string[] {
  return getEnv()
    .OVERPASS_URL.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchOverpass(endpoint: string, query: string, timeoutMs: number): Promise<OverpassElement[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
    let json: { elements?: OverpassElement[] };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response from ${endpoint}`);
    }
    return json.elements ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export async function queryOsmFeatures(q: OsmFeatureQuery): Promise<OsmFeatureResult> {
  const def = OSM_FEATURES[q.feature];
  const base = { feature: q.feature, label: def.label, tags: def.tags };
  const query = buildOverpassQuery(q);
  const errors: string[] = [];

  for (const endpoint of endpoints()) {
    try {
      const elements = await fetchOverpass(endpoint, query, 25_000);
      const features = elements
        .map((el): OsmFeature | null => {
          const lat = el.lat ?? el.center?.lat;
          const lon = el.lon ?? el.center?.lon;
          if (lat == null || lon == null) return null;
          const tags = Object.fromEntries(Object.entries(el.tags ?? {}).filter(([k]) => TAG_KEEP.includes(k)));
          return {
            osm_id: `${el.type}/${el.id}`,
            lat,
            lon,
            distance_m: haversineM({ lat, lon }, q),
            name: el.tags?.name,
            tags,
          };
        })
        .filter((f): f is OsmFeature => f !== null)
        .sort((a, b) => a.distance_m - b.distance_m);
      return { ...base, available: true, count: features.length, features, endpoint };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { ...base, available: false, count: 0, features: [], error: errors.join(" | ") };
}
