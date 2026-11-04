import "./load-env";
import { ensureIndex } from "@/lib/elastic/index";
import { ensureChallengeIndices } from "@/lib/elastic/challenges";
import { getElasticClient, getIndexName } from "@/lib/elastic/client";
import { getEnv } from "@/lib/env";

/**
 * Create (or recreate with --recreate) the 311 cases index plus the
 * closed-loop challenge/observation indices.
 * Usage: npm run es:setup [-- --recreate]
 */
async function main() {
  const recreate = process.argv.includes("--recreate");
  const es = getElasticClient();
  const info = await es.info();
  console.log(`Connected to Elasticsearch ${info.version.number} at ${info.cluster_name}`);

  await ensureIndex({ recreate });
  console.log(`Index "${getIndexName()}" is ready${recreate ? " (recreated)" : ""}.`);

  await ensureChallengeIndices({ recreate });
  const env = getEnv();
  console.log(`Indices "${env.ELASTICSEARCH_CHALLENGES_INDEX}" and "${env.ELASTICSEARCH_OBSERVATIONS_INDEX}" are ready.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
