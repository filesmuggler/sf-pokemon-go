import { connection, NextResponse } from "next/server";
import { getElasticClient, getIndexName } from "@/lib/elastic/client";
import { getEnv } from "@/lib/env";

/**
 * GET /api/health — checks env + Elasticsearch connectivity and index doc count.
 */
export async function GET() {
  await connection(); // always run at request time

  const env = getEnv();
  const health: Record<string, unknown> = {
    mistral: { configured: Boolean(env.MISTRAL_API_KEY), model: env.MISTRAL_MODEL },
    mock: env.QUEST_MOCK,
    elasticsearch: { url: env.ELASTICSEARCH_URL, index: getIndexName(), ok: false },
  };

  try {
    const es = getElasticClient();
    const [info, exists] = await Promise.all([es.info(), es.indices.exists({ index: getIndexName() })]);
    const count = exists ? (await es.count({ index: getIndexName() })).count : 0;
    health.elasticsearch = {
      ...(health.elasticsearch as object),
      ok: true,
      version: info.version.number,
      index_exists: exists,
      doc_count: count,
    };
  } catch (err) {
    health.elasticsearch = {
      ...(health.elasticsearch as object),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const ok = (health.elasticsearch as { ok: boolean }).ok || env.QUEST_MOCK;
  return NextResponse.json(health, { status: ok ? 200 : 503 });
}
