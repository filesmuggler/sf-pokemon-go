import type { IndicesIndexSettings, MappingTypeMapping } from "@elastic/elasticsearch/lib/api/types";
import type { Client } from "@elastic/elasticsearch";
import { getElasticClient, getIndexName } from "./client";
import { getEnv } from "@/lib/env";
import type { SF311Case } from "@/lib/sf311/types";

export const CASE_MAPPINGS: MappingTypeMapping = {
  dynamic: "strict",
  properties: {
    id: { type: "keyword" },
    requested_at: { type: "date" },
    updated_at: { type: "date" },
    closed_at: { type: "date" },
    status: { type: "keyword" },
    status_notes: { type: "text" },

    agency: { type: "keyword" },
    category: { type: "keyword" },
    subtype: { type: "keyword" },
    details: { type: "text" },

    address: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 256 } } },
    street: { type: "keyword" },
    neighborhood: { type: "keyword" },
    supervisor_district: { type: "keyword" },
    police_district: { type: "keyword" },

    location: { type: "geo_point" },
    source: { type: "keyword" },
    media_url: { type: "keyword", index: false },

    description: { type: "text", analyzer: "english" },
  },
};

export const CASE_SETTINGS: IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
};

/** Elastic Serverless rejects shard/replica settings, so only send them to self-managed clusters. */
export async function indexSettings(es: Client): Promise<IndicesIndexSettings | undefined> {
  const info = await es.info();
  return info.version.build_flavor === "serverless" ? undefined : CASE_SETTINGS;
}

/**
 * With ELASTICSEARCH_INFERENCE_ID set (e.g. ".elser-2-elastic"), `description` is also
 * copied into a `semantic_text` field so searches can match by meaning, not just keywords.
 */
export function caseMappings(): MappingTypeMapping {
  const inferenceId = getEnv().ELASTICSEARCH_INFERENCE_ID;
  if (!inferenceId) return CASE_MAPPINGS;
  return {
    ...CASE_MAPPINGS,
    properties: {
      ...CASE_MAPPINGS.properties,
      description: { type: "text", analyzer: "english", copy_to: "description_semantic" },
      description_semantic: { type: "semantic_text", inference_id: inferenceId },
    },
  };
}

export async function ensureIndex(opts: { recreate?: boolean } = {}): Promise<void> {
  const es = getElasticClient();
  const index = getIndexName();
  const exists = await es.indices.exists({ index });

  if (exists && opts.recreate) {
    await es.indices.delete({ index });
  }
  if (!exists || opts.recreate) {
    await es.indices.create({ index, settings: await indexSettings(es), mappings: caseMappings() });
  }
}

export async function bulkIndexCases(cases: SF311Case[]): Promise<{ indexed: number; failed: number }> {
  if (cases.length === 0) return { indexed: 0, failed: 0 };
  const es = getElasticClient();
  const index = getIndexName();

  let failed = 0;
  const result = await es.helpers.bulk<SF311Case>({
    datasource: cases,
    onDocument: (doc) => ({ index: { _index: index, _id: doc.id } }),
    onDrop: () => {
      failed += 1;
    },
    refreshOnCompletion: true,
  });

  return { indexed: result.successful, failed };
}
