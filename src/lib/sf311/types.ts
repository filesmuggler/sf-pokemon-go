/**
 * Normalized SF 311 case as stored in Elasticsearch.
 * Source dataset: https://data.sfgov.org/City-Infrastructure/311-Cases/vw6y-z8j6
 */
export type CaseStatus = "open" | "closed";

export interface SF311Case {
  /** Socrata `service_request_id` */
  id: string;
  requested_at: string; // ISO date
  updated_at?: string;
  closed_at?: string;
  status: CaseStatus;
  status_notes?: string;

  agency?: string;
  /** Top-level category, e.g. "Street and Sidewalk Cleaning" */
  category: string;
  /** Finer category, e.g. "Bulky Items" */
  subtype?: string;
  details?: string;

  address?: string;
  street?: string;
  neighborhood?: string;
  supervisor_district?: string;
  police_district?: string;

  location?: { lat: number; lon: number };
  source?: string;
  media_url?: string;

  /** Concatenated text used for full-text and more_like_this queries. */
  description: string;
}

/** Raw row shape from the Socrata (SODA) API. Only fields we read. */
export interface SodaRow {
  service_request_id: string;
  requested_datetime?: string;
  closed_date?: string;
  updated_datetime?: string;
  status_description?: string;
  status_notes?: string;
  agency_responsible?: string;
  service_name?: string;
  service_subtype?: string;
  service_details?: string;
  address?: string;
  street?: string;
  supervisor_district?: string;
  neighborhoods_sffind_boundaries?: string;
  police_district?: string;
  lat?: string;
  long?: string;
  source?: string;
  media_url?: { url?: string } | string;
}
