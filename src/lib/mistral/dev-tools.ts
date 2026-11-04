import { z } from "zod";
import type { Tool } from "@mistralai/mistralai/models/components";
import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { getDevElasticClient } from "@/lib/elastic/dev-client";

/**
 * Read-only, index-agnostic tools for the dev "chat with the data" agent.
 * The model constructs Elasticsearch Query DSL / aggregations / ES|QL itself;
 * these tools validate, cap and execute. Nothing here can write.
 */

const MAX_HITS = 50;
const MAX_RESULT_CHARS = 12_000;

const indexArg = z
  .string()
  .min(1)
  .describe("Index name or pattern (e.g. 'sample_products' or 'sf311-*'). System indices (starting with '.') are not allowed.");

export const devToolSchemas = {
  list_indices: z.object({}),
  get_mapping: z.object({ index: indexArg }),
  sample_documents: z.object({
    index: indexArg,
    size: z.number().int().min(1).max(10).optional().describe("Default 3"),
  }),
  search: z.object({
    index: indexArg,
    query: z.record(z.string(), z.unknown()).describe("Elasticsearch Query DSL object, e.g. {\"match\": {\"description\": \"wireless\"}} or a bool query"),
    size: z.number().int().min(0).max(MAX_HITS).optional().describe("Default 10"),
    sort: z.array(z.unknown()).optional().describe("ES sort clause, e.g. [{\"price\": \"desc\"}]"),
    _source: z.array(z.string()).optional().describe("Fields to return; omit for all"),
  }),
  aggregate: z.object({
    index: indexArg,
    aggs: z.record(z.string(), z.unknown()).describe("Elasticsearch aggregations object, e.g. {\"by_cat\": {\"terms\": {\"field\": \"category\"}, \"aggs\": {\"avg_price\": {\"avg\": {\"field\": \"price\"}}}}}"),
    query: z.record(z.string(), z.unknown()).optional().describe("Optional Query DSL filter applied before aggregating"),
  }),
  esql: z.object({
    query: z
      .string()
      .min(5)
      .describe("ES|QL query starting with FROM, e.g. 'FROM sample_products | STATS avg_price = AVG(price) BY category | SORT avg_price DESC | LIMIT 10'"),
  }),
} as const;

export type DevToolName = keyof typeof devToolSchemas;

const descriptions: Record<DevToolName, string> = {
  list_indices: "List the indices available in the dev Elasticsearch project with document counts and sizes. Call this first if you do not know what data exists.",
  get_mapping: "Field names and types for an index. Needed before writing queries: 'text' fields are for full-text match, 'keyword' fields for exact terms/aggregations, numbers/dates for ranges and stats.",
  sample_documents: "Return a few raw documents from an index to understand real values and shapes.",
  search: "Run a Query DSL search. Returns total hit count and documents (capped at 50). Prefer _source to keep results small.",
  aggregate: "Run aggregations (terms, avg, sum, min/max, date_histogram, geo_centroid, etc.) with size=0. Use for counts, breakdowns and statistics.",
  esql: [
    "Run a read-only ES|QL query (FROM … | WHERE … | STATS … BY … | SORT … | LIMIT … | KEEP …). Often the fastest way to answer analytical questions; results come back as columns + rows.",
    "Aggregation functions that exist: COUNT(*), COUNT(x), COUNT_DISTINCT(x), SUM, AVG, MIN, MAX, MEDIAN, PERCENTILE(x, p), TOP(x, n, \"asc\"|\"desc\"), VALUES(x), ST_CENTROID_AGG(geo).",
    "There is no MAX_BY/MIN_BY/ARG_MAX: to get 'the row with the highest X', use `| SORT x DESC | LIMIT 1 | KEEP …`. Full-text fields of type 'text' cannot be grouped on — use the `.keyword` sub-field. Use `| STATS … BY BUCKET(date_field, 1 day)` for time histograms. Dates compare with strings like \"2026-10-01\".",
  ].join(" "),
};

export function getDevToolDefinitions(): Tool[] {
  return (Object.keys(devToolSchemas) as DevToolName[]).map((name) => ({
    type: "function",
    function: { name, description: descriptions[name], parameters: z.toJSONSchema(devToolSchemas[name]) },
  }));
}

export function isDevToolName(name: string): name is DevToolName {
  return name in devToolSchemas;
}

function assertSafeIndex(index: string): void {
  for (const part of index.split(",")) {
    const p = part.trim();
    if (!p || p.startsWith(".") || p === "*" || p === "_all") {
      throw new Error(`Index pattern "${p}" is not allowed (system indices and wildcard-all are blocked).`);
    }
  }
}

const ESQL_FORBIDDEN = /\b(DROP\s+INDEX|DELETE|UPDATE|INSERT|PUT|POST|CREATE|ALTER)\b/i;
function assertSafeEsql(q: string): void {
  const trimmed = q.trim();
  if (!/^FROM\s/i.test(trimmed) && !/^ROW\s/i.test(trimmed) && !/^SHOW\s/i.test(trimmed)) {
    throw new Error("ES|QL query must start with FROM, ROW or SHOW.");
  }
  if (ESQL_FORBIDDEN.test(trimmed)) throw new Error("Only read-only ES|QL is allowed.");
  const from = /^FROM\s+([^|]+)/i.exec(trimmed);
  if (from) assertSafeIndex(from[1].trim());
}

/** Flatten a mapping into "path: type" pairs so the model gets a compact field list. */
function flattenMapping(props: Record<string, MappingProperty> | undefined, prefix = ""): { field: string; type: string }[] {
  if (!props) return [];
  const out: { field: string; type: string }[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const p = prop as MappingProperty & { properties?: Record<string, MappingProperty>; fields?: Record<string, MappingProperty> };
    const type = (p as { type?: string }).type ?? (p.properties ? "object" : "unknown");
    out.push({ field: path, type });
    if (p.fields) for (const [sub, f] of Object.entries(p.fields)) out.push({ field: `${path}.${sub}`, type: (f as { type?: string }).type ?? "unknown" });
    if (p.properties) out.push(...flattenMapping(p.properties, path));
  }
  return out;
}

/** Keep tool output within a budget so it fits in the model context. */
export function truncateResult(result: unknown): unknown {
  const text = JSON.stringify(result);
  if (text.length <= MAX_RESULT_CHARS) return result;
  return { truncated: true, note: `Result was ${text.length} chars; showing the first ${MAX_RESULT_CHARS}.`, preview: text.slice(0, MAX_RESULT_CHARS) };
}

export async function executeDevTool(name: DevToolName, rawArgs: unknown): Promise<unknown> {
  const es = getDevElasticClient();
  switch (name) {
    case "list_indices": {
      devToolSchemas.list_indices.parse(rawArgs ?? {});
      const rows = await es.cat.indices({ format: "json", h: "index,docs.count,store.size,health,status" });
      return {
        indices: rows
          .filter((r) => r.index && !r.index.startsWith("."))
          .map((r) => ({ index: r.index, docs: Number(r["docs.count"] ?? 0), size: r["store.size"], health: r.health, status: r.status }))
          .sort((a, b) => (a.index ?? "").localeCompare(b.index ?? "")),
      };
    }
    case "get_mapping": {
      const a = devToolSchemas.get_mapping.parse(rawArgs);
      assertSafeIndex(a.index);
      const res = await es.indices.getMapping({ index: a.index });
      return Object.fromEntries(Object.entries(res).map(([idx, m]) => [idx, flattenMapping(m.mappings.properties)]));
    }
    case "sample_documents": {
      const a = devToolSchemas.sample_documents.parse(rawArgs);
      assertSafeIndex(a.index);
      const res = await es.search({ index: a.index, size: a.size ?? 3, query: { match_all: {} } });
      return { total: hitsTotal(res.hits.total), documents: res.hits.hits.map((h) => ({ _id: h._id, _index: h._index, ...(h._source as object) })) };
    }
    case "search": {
      const a = devToolSchemas.search.parse(rawArgs);
      assertSafeIndex(a.index);
      const res = await es.search({
        index: a.index,
        size: a.size ?? 10,
        query: a.query as never,
        sort: a.sort as never,
        _source: a._source,
        track_total_hits: true,
      });
      return {
        took_ms: res.took,
        total: hitsTotal(res.hits.total),
        hits: res.hits.hits.map((h) => ({ _id: h._id, _score: h._score, ...(h._source as object) })),
      };
    }
    case "aggregate": {
      const a = devToolSchemas.aggregate.parse(rawArgs);
      assertSafeIndex(a.index);
      const res = await es.search({
        index: a.index,
        size: 0,
        query: (a.query ?? { match_all: {} }) as never,
        aggs: a.aggs as never,
        track_total_hits: true,
      });
      return { took_ms: res.took, matched: hitsTotal(res.hits.total), aggregations: res.aggregations };
    }
    case "esql": {
      const a = devToolSchemas.esql.parse(rawArgs);
      assertSafeEsql(a.query);
      const res = (await es.esql.query({ query: a.query, format: "json" })) as unknown as {
        columns: { name: string; type: string }[];
        values: unknown[][];
        took?: number;
      };
      const rows = res.values.slice(0, MAX_HITS);
      return {
        took_ms: res.took,
        columns: res.columns,
        rows: rows.map((r) => Object.fromEntries(res.columns.map((c, i) => [c.name, r[i]]))),
        row_count: res.values.length,
      };
    }
  }
}

function hitsTotal(total: number | { value: number; relation?: string } | undefined): number {
  return typeof total === "number" ? total : (total?.value ?? 0);
}

export function summarizeDevToolResult(name: DevToolName, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (r && "error" in r) return `error: ${String(r.error)}`;
  switch (name) {
    case "list_indices":
      return `${(r.indices as unknown[]).length} indices`;
    case "get_mapping":
      return `${Object.values(r as Record<string, unknown[]>).reduce((n, f) => n + f.length, 0)} fields`;
    case "sample_documents":
      return `${(r.documents as unknown[]).length} of ${r.total} docs`;
    case "search":
      return `${r.total} hits, ${(r.hits as unknown[]).length} returned`;
    case "aggregate":
      return `${Object.keys((r.aggregations as object) ?? {}).join(", ")} over ${r.matched} docs`;
    case "esql":
      return `${r.row_count} rows × ${(r.columns as unknown[]).length} cols`;
  }
}
