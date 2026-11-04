import { getEnv } from "@/lib/env";
import { normalizeSodaRow } from "./normalize";
import type { SF311Case, SodaRow } from "./types";

export const SF311_DATASET_ID = "vw6y-z8j6";
const SODA_BASE = `https://data.sfgov.org/resource/${SF311_DATASET_ID}.json`;

export interface FetchCasesOptions {
  /** Only cases requested within the last N days. */
  days?: number;
  /** Max rows to pull in total (paged in chunks of `pageSize`). */
  limit?: number;
  pageSize?: number;
  /** Optional geo filter: center + radius in meters. */
  center?: { lat: number; lon: number; radiusM: number };
  onPage?: (fetched: number) => void;
}

/**
 * Pull 311 cases from SF Open Data (Socrata SODA 2.1 API).
 * Docs: https://dev.socrata.com/foundry/data.sfgov.org/vw6y-z8j6
 */
export async function* iterateSodaCases(
  opts: FetchCasesOptions = {},
): AsyncGenerator<SF311Case[], void, void> {
  const { days = 30, limit = 5000, pageSize = 1000, center } = opts;
  const { SF_OPEN_DATA_APP_TOKEN } = getEnv();

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "");

  const where: string[] = [`requested_datetime > '${since}'`, "lat IS NOT NULL"];
  if (center) {
    where.push(`within_circle(point, ${center.lat}, ${center.lon}, ${center.radiusM})`);
  }

  let offset = 0;
  let fetched = 0;
  while (fetched < limit) {
    const size = Math.min(pageSize, limit - fetched);
    const params = new URLSearchParams({
      $where: where.join(" AND "),
      $order: "requested_datetime DESC",
      $limit: String(size),
      $offset: String(offset),
    });
    const res = await fetch(`${SODA_BASE}?${params}`, {
      headers: SF_OPEN_DATA_APP_TOKEN ? { "X-App-Token": SF_OPEN_DATA_APP_TOKEN } : {},
    });
    if (!res.ok) {
      throw new Error(`SODA request failed: ${res.status} ${await res.text()}`);
    }
    const rows = (await res.json()) as SodaRow[];
    if (rows.length === 0) break;

    const cases = rows.map(normalizeSodaRow).filter((c): c is SF311Case => c !== null);
    fetched += rows.length;
    offset += rows.length;
    opts.onPage?.(fetched);
    yield cases;

    if (rows.length < size) break;
  }
}
