import { getEnv } from "@/lib/env";
import { normalizeSodaRow, sfWallClock } from "./normalize";
import type { SF311Case, SodaRow } from "./types";

export const SF311_DATASET_ID = "vw6y-z8j6";
// data.sfgov.org now 301-redirects here.
const SODA_BASE = `https://data.sf.gov/resource/${SF311_DATASET_ID}.json`;

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

async function fetchPage(params: URLSearchParams, token?: string): Promise<SodaRow[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${SODA_BASE}?${params}`, { headers: token ? { "X-App-Token": token } : {} });
    if (res.ok) return (await res.json()) as SodaRow[];
    if (attempt >= 4) throw new Error(`SODA request failed: ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

/**
 * Pull 311 cases from SF Open Data (Socrata SODA 2.1 API), newest first.
 * Uses keyset pagination on (requested_datetime, service_request_id) instead of
 * a growing $offset, so deep pages stay fast.
 * Docs: https://dev.socrata.com/foundry/data.sfgov.org/vw6y-z8j6
 */
export async function* iterateSodaCases(
  opts: FetchCasesOptions = {},
): AsyncGenerator<SF311Case[], void, void> {
  const { days = 30, limit = 5000, pageSize = 5000, center } = opts;
  const { SF_OPEN_DATA_APP_TOKEN } = getEnv();

  // SODA timestamps are SF wall-clock time, so compare against SF wall-clock too.
  const since = sfWallClock(new Date(Date.now() - days * 86_400_000));

  const base: string[] = [`requested_datetime > '${since}'`, "lat IS NOT NULL"];
  if (center) {
    base.push(`within_circle(point, ${center.lat}, ${center.lon}, ${center.radiusM})`);
  }

  let fetched = 0;
  let cursor: { ts: string; id: string } | null = null;
  while (fetched < limit) {
    const size = Math.min(pageSize, limit - fetched);
    const where = [...base];
    if (cursor) {
      where.push(
        `(requested_datetime < '${cursor.ts}' OR (requested_datetime = '${cursor.ts}' AND service_request_id < '${cursor.id}'))`,
      );
    }
    const params = new URLSearchParams({
      $where: where.join(" AND "),
      $order: "requested_datetime DESC, service_request_id DESC",
      $limit: String(size),
    });
    const rows = await fetchPage(params, SF_OPEN_DATA_APP_TOKEN);
    if (rows.length === 0) break;

    const last = rows[rows.length - 1];
    cursor = { ts: last.requested_datetime ?? "", id: last.service_request_id };
    fetched += rows.length;
    opts.onPage?.(fetched);
    yield rows.map(normalizeSodaRow).filter((c): c is SF311Case => c !== null);

    if (rows.length < size) break;
  }
}
