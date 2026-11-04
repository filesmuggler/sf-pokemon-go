import type { SF311Case, SodaRow } from "./types";

const SF_TZ = "America/Los_Angeles";

/** Minutes SF is offset from UTC at a given instant (e.g. -420 in summer). */
function sfOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: SF_TZ, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** A Date as SF wall-clock "YYYY-MM-DDTHH:mm:ss" (the format SODA compares against). */
export function sfWallClock(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: SF_TZ }).replace(" ", "T");
}

/**
 * SODA timestamps are "floating" (no zone) and mean SF local time. `new Date(value)`
 * would read them in the server's zone, which is wrong on UTC hosts like Vercel.
 */
function toIso(value?: string): string | undefined {
  if (!value) return undefined;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const asUtc = new Date(`${value}Z`);
  if (Number.isNaN(asUtc.getTime())) return undefined;
  return new Date(asUtc.getTime() - sfOffsetMinutes(asUtc) * 60_000).toISOString();
}

export function normalizeSodaRow(row: SodaRow): SF311Case | null {
  if (!row.service_request_id) return null;

  const lat = row.lat ? Number(row.lat) : NaN;
  const lon = row.long ? Number(row.long) : NaN;
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lon);

  const requested_at = toIso(row.requested_datetime);
  if (!requested_at) return null;

  const status: SF311Case["status"] =
    (row.status_description ?? "").toLowerCase().startsWith("closed") ? "closed" : "open";

  const category = row.service_name?.trim() || "Uncategorized";
  const subtype = row.service_subtype?.trim() || undefined;
  const details = row.service_details?.trim() || undefined;
  const status_notes = row.status_notes?.trim() || undefined;

  const media_url =
    typeof row.media_url === "string" ? row.media_url : row.media_url?.url ?? undefined;

  return {
    id: row.service_request_id,
    requested_at,
    updated_at: toIso(row.updated_datetime),
    closed_at: toIso(row.closed_date),
    status,
    status_notes,
    agency: row.agency_responsible?.trim() || undefined,
    category,
    subtype,
    details,
    address: row.address?.trim() || undefined,
    street: row.street?.trim() || undefined,
    neighborhood: row.neighborhoods_sffind_boundaries?.trim() || undefined,
    supervisor_district: row.supervisor_district?.trim() || undefined,
    police_district: row.police_district?.trim() || undefined,
    location: hasLocation ? { lat, lon } : undefined,
    source: row.source?.trim() || undefined,
    media_url,
    description: [category, subtype, details, status_notes].filter(Boolean).join(" — "),
  };
}
