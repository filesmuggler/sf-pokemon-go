import { Client } from "@elastic/elasticsearch";
import { getEnv } from "@/lib/env";

/**
 * Client for the *dev* Elastic project (ELASTIC_DEV_ENDPOINT / ELASTIC_DEV_API_KEY).
 * Kept separate from `getElasticClient()` so the production 311 index config
 * and the exploratory dataset never get mixed up.
 */
let client: Client | null = null;

export function hasDevElastic(): boolean {
  const env = getEnv();
  return Boolean(env.ELASTIC_DEV_ENDPOINT && env.ELASTIC_DEV_API_KEY);
}

export function getDevElasticClient(): Client {
  if (client) return client;
  const env = getEnv();
  if (!env.ELASTIC_DEV_ENDPOINT || !env.ELASTIC_DEV_API_KEY) {
    throw new Error("ELASTIC_DEV_ENDPOINT and ELASTIC_DEV_API_KEY must be set for the dev agent.");
  }
  client = new Client({
    node: env.ELASTIC_DEV_ENDPOINT,
    auth: { apiKey: env.ELASTIC_DEV_API_KEY },
    serverMode: "serverless",
  });
  return client;
}

/** Host only — safe to show in the UI. */
export function devElasticHost(): string | null {
  const url = getEnv().ELASTIC_DEV_ENDPOINT;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
